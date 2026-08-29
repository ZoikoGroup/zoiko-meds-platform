import { GatewayTelemetryService } from './gateway-telemetry.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

/**
 * MSA-36 — the admin ZoikoAvail console rendered fixed fixtures (99.98%
 * uptime, 84ms p50…) with nothing behind them. This is the aggregation layer
 * that replaced those with real numbers off GatewayRequestLog.
 */
describe('GatewayTelemetryService', () => {
  let queryRaw: jest.Mock;
  let count: jest.Mock;
  let service: GatewayTelemetryService;

  const configGet = (_key: string, fallback?: unknown) => fallback;

  beforeEach(() => {
    queryRaw = jest.fn();
    count = jest.fn();
    const prisma = {
      $queryRaw: queryRaw,
      platformApiKey: { count },
    } as unknown as PrismaService;
    const config = { get: jest.fn(configGet) } as unknown as ConfigService;
    service = new GatewayTelemetryService(prisma, config);
  });

  it('reports no uptime and disabled endpoints when there is no traffic yet', async () => {
    queryRaw
      .mockResolvedValueOnce([]) // hourly
      .mockResolvedValueOnce([{ total: 0n, errors: 0n, p50: null, p99: null }]) // 24h rollup
      .mockResolvedValueOnce([{ total: 0n, errors: 0n }]) // 30d rollup
      .mockResolvedValueOnce([]); // per-route
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.summary();

    expect(result.health.uptime).toBeNull();
    expect(result.health.errorRate).toBeNull();
    expect(result.health.requests24h).toBe(0);
    expect(result.health.status).toBe('disabled');
    expect(result.endpoints.every((e) => e.status === 'disabled')).toBe(true);
    expect(result.responseTime).toEqual([]);
  });

  it('computes uptime, error rate and per-endpoint status from real rows', async () => {
    queryRaw
      .mockResolvedValueOnce([
        { hour: new Date('2026-08-29T10:00:00Z'), p50: 80, p99: 200, requests: 12n },
      ])
      .mockResolvedValueOnce([{ total: 100n, errors: 20n, p50: 85.4, p99: 210.9 }])
      .mockResolvedValueOnce([{ total: 1000n, errors: 5n }])
      .mockResolvedValueOnce([
        { route: '/availability', method: 'GET', total: 60n, errors: 0n, p50: 70, p99: 150 },
        { route: '/signal/intelligence', method: 'GET', total: 40n, errors: 20n, p50: 90, p99: 300 },
      ]);
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const result = await service.summary();

    expect(result.health.uptime).toBeCloseTo(99.5, 5); // 1 - 5/1000
    expect(result.health.errorRate).toBeCloseTo(20, 5); // 20/100 * 100
    expect(result.health.p50).toBe(85); // rounded to whole ms for display
    expect(result.health.status).toBe('degraded'); // 20% > 10% threshold
    expect(result.responseTime).toEqual([{ date: '10:00', p50: 80, p99: 200 }]);
    expect(result.throughput).toEqual([{ date: '10:00', requests: 12 }]);

    const availability = result.endpoints.find((e) => e.path === '/availability');
    expect(availability?.status).toBe('operational');
    const signal = result.endpoints.find((e) => e.path === '/signal/intelligence');
    expect(signal?.status).toBe('degraded'); // 20/40 = 50% errors

    const medibaseMatch = result.endpoints.find((e) => e.path === '/medibase/match');
    expect(medibaseMatch?.status).toBe('disabled'); // no rows this window

    const keyRotation = result.security.find((s) => s.label === 'Key rotation');
    expect(keyRotation?.detail).toContain('1 active key');
    expect(keyRotation?.status).toBe('attention');
  });

  it('formats the rate ceiling from throttler config', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0n, errors: 0n, p50: null, p99: null }])
      .mockResolvedValueOnce([{ total: 0n, errors: 0n }])
      .mockResolvedValueOnce([]);
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.summary();

    expect(result.health.rateCeiling).toBe('100 req/min');
  });
});
