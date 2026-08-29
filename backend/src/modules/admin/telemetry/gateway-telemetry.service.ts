import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { GATEWAY_ROUTE_LIST } from './gateway-route-registry';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type HourlyRow = { hour: Date; p50: number | null; p99: number | null; requests: bigint };
type RollupRow = { total: bigint; errors: bigint; p50: number | null; p99: number | null };
type RouteRow = {
  route: string;
  method: string;
  total: bigint;
  errors: bigint;
  p50: number | null;
  p99: number | null;
};

export type EndpointStatus = 'operational' | 'degraded' | 'down' | 'disabled';
export type SecurityStatus = 'ok' | 'attention';

export interface ZoikoAvailTelemetry {
  health: {
    status: EndpointStatus;
    uptime: number | null;
    p50: number | null;
    p99: number | null;
    requests24h: number;
    errorRate: number | null;
    rateCeiling: string;
  };
  responseTime: Array<{ date: string; p50: number | null; p99: number | null }>;
  throughput: Array<{ date: string; requests: number }>;
  endpoints: Array<{
    id: string;
    method: string;
    path: string;
    description: string;
    category: string;
    status: EndpointStatus;
    p50: number | null;
    p99: number | null;
    requests24h: number;
  }>;
  security: Array<{ label: string; detail: string; status: SecurityStatus }>;
}

/** >10% of requests failing in the window reads as degraded; near-total failure reads as down. */
function statusFromErrorRate(total: number, errors: number): EndpointStatus {
  if (total === 0) return 'disabled';
  const rate = errors / total;
  if (rate >= 0.95) return 'down';
  if (rate > 0.1) return 'degraded';
  return 'operational';
}

const round = (n: number | null, places = 0) =>
  n == null ? null : Math.round(n * 10 ** places) / 10 ** places;

@Injectable()
export class GatewayTelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async summary(): Promise<ZoikoAvailTelemetry> {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since30d = new Date(now - 30 * DAY_MS);

    const [hourly, rollup24h, rollup30d, perRoute, security] = await Promise.all([
      this.prisma.$queryRaw<HourlyRow[]>`
        SELECT date_trunc('hour', "createdAt") AS hour,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs") AS p99,
               count(*) AS requests
        FROM "GatewayRequestLog"
        WHERE "createdAt" >= ${since24h}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.$queryRaw<RollupRow[]>`
        SELECT count(*) AS total,
               count(*) FILTER (WHERE "statusCode" >= 500) AS errors,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs") AS p99
        FROM "GatewayRequestLog"
        WHERE "createdAt" >= ${since24h}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint; errors: bigint }>>`
        SELECT count(*) AS total, count(*) FILTER (WHERE "statusCode" >= 500) AS errors
        FROM "GatewayRequestLog"
        WHERE "createdAt" >= ${since30d}
      `,
      this.prisma.$queryRaw<RouteRow[]>`
        SELECT "route", "method",
               count(*) AS total,
               count(*) FILTER (WHERE "statusCode" >= 500) AS errors,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs") AS p99
        FROM "GatewayRequestLog"
        WHERE "createdAt" >= ${since24h}
        GROUP BY "route", "method"
      `,
      this.securityStatus(),
    ]);

    const r24 = rollup24h[0];
    const r30 = rollup30d[0];
    const total24h = Number(r24?.total ?? 0);
    const errors24h = Number(r24?.errors ?? 0);
    const total30d = Number(r30?.total ?? 0);
    const errors30d = Number(r30?.errors ?? 0);

    const byRoute = new Map(perRoute.map((row) => [`${row.method} ${row.route}`, row]));

    return {
      health: {
        status: statusFromErrorRate(total24h, errors24h),
        uptime: total30d > 0 ? round((1 - errors30d / total30d) * 100, 2) : null,
        p50: round(r24?.p50 ?? null),
        p99: round(r24?.p99 ?? null),
        requests24h: total24h,
        errorRate: total24h > 0 ? round((errors24h / total24h) * 100, 2) : null,
        rateCeiling: this.rateCeiling(),
      },
      responseTime: hourly.map((row) => ({
        date: this.hourLabel(row.hour),
        p50: round(row.p50),
        p99: round(row.p99),
      })),
      throughput: hourly.map((row) => ({
        date: this.hourLabel(row.hour),
        requests: Number(row.requests),
      })),
      endpoints: GATEWAY_ROUTE_LIST.map((meta, i) => {
        const row = byRoute.get(`${meta.method} ${meta.path}`);
        const total = Number(row?.total ?? 0);
        const errors = Number(row?.errors ?? 0);
        return {
          id: `e${i + 1}`,
          method: meta.method,
          path: meta.path,
          description: meta.description,
          category: meta.category,
          status: statusFromErrorRate(total, errors),
          p50: round(row?.p50 ?? null),
          p99: round(row?.p99 ?? null),
          requests24h: total,
        };
      }),
      security,
    };
  }

  private hourLabel(hour: Date): string {
    return `${String(hour.getUTCHours()).padStart(2, '0')}:00`;
  }

  private rateCeiling(): string {
    const limit = Number(this.config.get('THROTTLE_LIMIT', '100'));
    const ttl = Number(this.config.get('THROTTLE_TTL', '60'));
    return ttl === 60 ? `${limit} req/min` : `${limit} req / ${ttl}s`;
  }

  private async securityStatus(): Promise<ZoikoAvailTelemetry['security']> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS);
    const [activeKeys, staleKeys] = await Promise.all([
      this.prisma.platformApiKey.count({ where: { revokedAt: null } }),
      this.prisma.platformApiKey.count({
        where: { revokedAt: null, createdAt: { lt: ninetyDaysAgo } },
      }),
    ]);

    return [
      {
        label: 'Aggregate-only responses',
        detail:
          'Availability and MediBase reads never return exact stock or patient-level data — enforced in the visibility layer, not just documented.',
        status: 'ok',
      },
      {
        label: 'Partner authentication',
        detail:
          '/signal requires a JWT session with an ENTERPRISE, GOVERNMENT or ADMIN role. /availability and /medibase/* are unauthenticated reads today — there is no OAuth2 client-credentials or mTLS gateway in front of them yet.',
        status: 'attention',
      },
      {
        label: 'Scoped API keys',
        detail:
          activeKeys > 0
            ? `${activeKeys} scoped key(s) issued (availability | medibase | signal), but no route validates a presented key yet — issuance exists, enforcement does not.`
            : 'No scoped keys have been issued yet, and no route validates one — issuance exists, enforcement does not.',
        status: 'attention',
      },
      {
        label: 'Key rotation',
        detail:
          staleKeys > 0
            ? `${staleKeys} active key(s) are older than the 90-day rotation policy.`
            : 'No active key is older than the 90-day rotation policy.',
        status: staleKeys > 0 ? 'attention' : 'ok',
      },
      {
        label: 'Rate limiting',
        detail: `Every request is capped at ${this.rateCeiling()}, enforced globally by a single ThrottlerGuard tier — not yet split by plan.`,
        status: 'ok',
      },
      {
        label: 'IP allowlist',
        detail:
          'A workspace-wide IP allowlist guard is registered; it only restricts traffic once ranges are added and switched on in Settings.',
        status: 'ok',
      },
    ];
  }
}
