import { Injectable } from '@nestjs/common';
import {
  AggregateBucket,
  Prisma,
  SignalEventType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntelligenceCell, toIntelligenceCell } from './anonymize';
import {
  DEFAULT_INTELLIGENCE_LIMIT,
  MAX_INTELLIGENCE_LIMIT,
  kAnonymityThreshold,
} from './signal.constants';
import { QueryIntelligenceQuery } from './dto/query-intelligence.query';
import { ExportFormat } from './dto/export-intelligence.query';

export interface IntelligenceResult {
  items: IntelligenceCell[];
  meta: {
    bucket: AggregateBucket;
    kAnonymity: number;
    from: string | null;
    to: string | null;
    count: number;
    /** Cells matching the filter that were withheld for being below k. */
    suppressedCellsWithheld: number;
  };
}

/**
 * ZoikoSignal™ — aggregated, anonymized shortage & access intelligence.
 *
 * Operates ONLY on aggregated data. No user-level, patient-level, or exact-stock
 * data is ever exposed. Cells below the k-anonymity threshold are masked before
 * release, and MediBase-suppressed medicine identities are never named. Access
 * to these outputs is governed by contract scope and jurisdiction at the
 * controller boundary.
 */
@Injectable()
export class SignalService {
  constructor(private readonly prisma: PrismaService) {}

  // === Contract-scoped intelligence query ==================================

  /**
   * Time-bucketed, jurisdiction-scoped aggregate cells. Suppressed cells are
   * withheld unless `includeSuppressed` (admin-only) is set, in which case they
   * are returned with masked counts.
   */
  async getIntelligence(
    query: QueryIntelligenceQuery,
    opts: { includeSuppressed?: boolean } = {},
  ): Promise<IntelligenceResult> {
    const bucket = query.bucket ?? AggregateBucket.DAY;
    const limit = Math.min(
      query.limit ?? DEFAULT_INTELLIGENCE_LIMIT,
      MAX_INTELLIGENCE_LIMIT,
    );

    const where: Prisma.SignalAggregateWhereInput = { bucket };
    if (query.medicineId) where.medicineId = query.medicineId;
    if (query.jurisdictionId) where.jurisdictionId = query.jurisdictionId;
    const periodStart = this.periodStartFilter(query.from, query.to);
    if (periodStart) where.periodStart = periodStart;
    if (!opts.includeSuppressed) where.suppressed = false;

    const [rows, suppressedCellsWithheld] = await Promise.all([
      this.prisma.signalAggregate.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        take: limit,
      }),
      // How many cells the caller could NOT see because they were below k.
      opts.includeSuppressed
        ? Promise.resolve(0)
        : this.prisma.signalAggregate.count({
            where: { ...where, suppressed: true },
          }),
    ]);

    const nameById = await this.resolveMedicineNames(rows.map((r) => r.medicineId));
    const items = rows.map((r) =>
      toIntelligenceCell(r, r.medicineId ? nameById.get(r.medicineId) ?? null : null),
    );

    return {
      items,
      meta: {
        bucket,
        kAnonymity: kAnonymityThreshold(),
        from: query.from ?? null,
        to: query.to ?? null,
        count: items.length,
        suppressedCellsWithheld,
      },
    };
  }

  // === Intelligence summary (dashboards / ZoikoSignal page framing) ========

  /**
   * High-level, aggregate-only intelligence over a window (default 30 days):
   * top demand, top shortage pressure, and top unmet-demand search terms.
   * Everything here already respects k-anonymity — suppressed cells and
   * sub-threshold terms are excluded.
   */
  async getSummary(query: {
    jurisdictionId?: string;
    from?: string;
    to?: string;
    bucket?: AggregateBucket;
  }) {
    const bucket = query.bucket ?? AggregateBucket.DAY;
    const from =
      query.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const k = kAnonymityThreshold();

    const where: Prisma.SignalAggregateWhereInput = {
      bucket,
      suppressed: false,
      periodStart: this.periodStartFilter(from, query.to) ?? undefined,
    };
    if (query.jurisdictionId) where.jurisdictionId = query.jurisdictionId;

    const grouped = await this.prisma.signalAggregate.groupBy({
      by: ['medicineId'],
      where: { ...where, medicineId: { not: null } },
      _sum: {
        searchCount: true,
        zeroResultCount: true,
        restockEvents: true,
        confirmationCount: true,
      },
    });

    const nameById = await this.resolveMedicineNames(
      grouped.map((g) => g.medicineId),
    );

    const rows = grouped.map((g) => {
      const searches = g._sum.searchCount ?? 0;
      const zeros = g._sum.zeroResultCount ?? 0;
      return {
        medicineId: g.medicineId,
        medicineName: g.medicineId ? nameById.get(g.medicineId) ?? null : null,
        searchCount: searches,
        zeroResultCount: zeros,
        restockEvents: g._sum.restockEvents ?? 0,
        confirmationCount: g._sum.confirmationCount ?? 0,
        shortagePressure:
          searches > 0 ? Math.round((zeros / searches) * 100) / 100 : null,
      };
    });

    const topDemand = [...rows]
      .sort((a, b) => b.searchCount - a.searchCount)
      .slice(0, 10);

    const topShortagePressure = rows
      .filter((r) => r.shortagePressure != null && r.searchCount >= k)
      .sort((a, b) => (b.shortagePressure ?? 0) - (a.shortagePressure ?? 0))
      .slice(0, 10);

    const totals = rows.reduce(
      (acc, r) => {
        acc.searchCount += r.searchCount;
        acc.zeroResultCount += r.zeroResultCount;
        acc.restockEvents += r.restockEvents;
        acc.confirmationCount += r.confirmationCount;
        return acc;
      },
      { searchCount: 0, zeroResultCount: 0, restockEvents: 0, confirmationCount: 0 },
    );

    return {
      window: { from, to: query.to ?? null, bucket },
      kAnonymity: k,
      totals,
      topDemand,
      topShortagePressure,
      topUnmetDemand: await this.topUnmetDemand(from, query.to, k),
    };
  }

  // === Export pathway ======================================================

  /**
   * Export intelligence for approved enterprise / public-sector consumers.
   * Exports NEVER include masked cells. Returns a body plus the content-type
   * and filename the controller should stream.
   */
  async exportIntelligence(
    query: QueryIntelligenceQuery,
    format: ExportFormat = ExportFormat.JSON,
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const result = await this.getIntelligence(query, { includeSuppressed: false });
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === ExportFormat.CSV) {
      return {
        filename: `zoikosignal-intelligence-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: this.toCsv(result.items),
      };
    }

    return {
      filename: `zoikosignal-intelligence-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(result, null, 2),
    };
  }

  // === Helpers =============================================================

  private periodStartFilter(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const filter: Prisma.DateTimeFilter = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lt = new Date(to);
    return Object.keys(filter).length ? filter : undefined;
  }

  /**
   * Resolve display names for the given medicine ids. MediBase-suppressed
   * identities are deliberately omitted so they are never named downstream.
   */
  private async resolveMedicineNames(
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const medicines = await this.prisma.medicineEntity.findMany({
      where: { id: { in: unique }, isSuppressed: false },
      select: { id: true, canonicalName: true },
    });
    return new Map(medicines.map((m) => [m.id, m.canonicalName]));
  }

  /**
   * Top unmet-demand search terms (zero-results). k-anonymity applied: only
   * terms searched at least k times in the window are surfaced.
   */
  private async topUnmetDemand(from: string, to: string | undefined, k: number) {
    const occurredAt: Prisma.DateTimeFilter = { gte: new Date(from) };
    if (to) occurredAt.lt = new Date(to);

    const grouped = await this.prisma.signalEvent.groupBy({
      by: ['searchTerm'],
      where: {
        type: SignalEventType.ZERO_RESULT,
        searchTerm: { not: null },
        occurredAt,
      },
      _count: { _all: true },
      orderBy: { _count: { searchTerm: 'desc' } },
      take: 50,
    });

    return grouped
      .filter((g) => g.searchTerm != null && g._count._all >= k)
      .slice(0, 10)
      .map((g) => ({ term: g.searchTerm as string, count: g._count._all }));
  }

  private toCsv(items: IntelligenceCell[]): string {
    const header = [
      'medicineId',
      'medicineName',
      'jurisdictionId',
      'bucket',
      'periodStart',
      'periodEnd',
      'searchCount',
      'zeroResultCount',
      'restockEvents',
      'confirmationCount',
      'shortagePressure',
    ];
    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = items.map((i) =>
      [
        i.medicineId,
        i.medicineName,
        i.jurisdictionId,
        i.bucket,
        i.periodStart.toISOString(),
        i.periodEnd.toISOString(),
        i.searchCount,
        i.zeroResultCount,
        i.restockEvents,
        i.confirmationCount,
        i.shortagePressure,
      ]
        .map(escape)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }
}
