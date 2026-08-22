import { Injectable } from '@nestjs/common';
import { AvailabilityConfidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Super Admin dashboard rollup.
 *
 * Every figure here is an aggregate over a real table. Where the platform has
 * no source for a panel the dashboard asks for, this service says so — see
 * `unavailable` — instead of returning a plausible number. A governance console
 * that invents its own telemetry is worse than one with visible gaps: the fake
 * figure is indistinguishable from a measured one, and someone will act on it.
 *
 * Kept separate from AdminService.overview(), which is the plain entity-count
 * endpoint several other admin screens already depend on.
 */

/** Freshness SLA the dashboard reports against. */
const FRESHNESS_SLA_HOURS = 6;
/** Points in a KPI sparkline — one per day, matching the existing card design. */
const SPARK_DAYS = 12;
/** Months of history in the shortage series. */
const SHORTAGE_MONTHS = 12;

/** A metric the platform cannot currently measure, and why. */
export interface Gap {
  available: false;
  reason: string;
  requires: string;
}

const gap = (reason: string, requires: string): Gap => ({
  available: false,
  reason,
  requires,
});

@Injectable()
export class DashboardOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    // Day boundaries are UTC throughout. Prisma stores timestamps as UTC and
    // Postgres date_trunc reads them as such, so bucketing in local time would
    // shift every series by the server's offset — which is exactly what made
    // the sparklines land a day out.
    const startOfToday = utcMidnight(now);
    const startOfYesterday = addDays(startOfToday, -1);
    const sparkFrom = addDays(startOfToday, -(SPARK_DAYS - 1));
    const freshnessCutoff = new Date(now.getTime() - FRESHNESS_SLA_HOURS * 3600_000);

    const [
      totalPharmacies,
      verifiedPharmacies,
      pendingVerifications,
      activeUsers,
      totalMedicines,
      regionsLive,
      searchesToday,
      searchesYesterday,
      confidenceRows,
      freshSignals,
      totalSignals,
      confirmationEvents,
      restockEvents,
    ] = await Promise.all([
      this.prisma.pharmacy.count(),
      this.prisma.pharmacy.count({ where: { verificationStatus: 'VERIFIED' } }),
      this.prisma.verificationRequest.count({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'ESCALATED'] } },
      }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.medicineEntity.count(),
      this.prisma.jurisdiction.count(),
      this.prisma.searchHistory.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.searchHistory.count({
        where: { createdAt: { gte: startOfYesterday, lt: startOfToday } },
      }),
      this.prisma.availabilitySignal.groupBy({
        by: ['confidence'],
        _count: { _all: true },
      }),
      this.prisma.availabilitySignal.count({
        where: { computedAt: { gte: freshnessCutoff } },
      }),
      this.prisma.availabilitySignal.count(),
      this.prisma.signalEvent.count({ where: { type: 'CONFIRMATION' } }),
      this.prisma.signalEvent.count({ where: { type: 'RESTOCK' } }),
    ]);

    const [searchSpark, pharmacySpark, userSpark, medicineSpark, shortage, categories] =
      await Promise.all([
        this.dailySearches(sparkFrom, startOfToday),
        this.cumulativeByDay('Pharmacy', sparkFrom, startOfToday),
        this.cumulativeByDay('User', sparkFrom, startOfToday),
        this.cumulativeByDay('MedicineEntity', sparkFrom, startOfToday),
        this.shortageSeries(),
        this.medicineCategories(),
      ]);

    const confidence = this.confidenceBands(confidenceRows);

    return {
      generatedAt: now.toISOString(),

      // Jurisdictions with a configured region. Zero is a real answer: the
      // Jurisdiction table is the source, and it is currently empty.
      regionsLive,

      kpis: {
        totalPharmacies: { value: totalPharmacies, spark: pharmacySpark },
        verifiedPharmacies: {
          value: verifiedPharmacies,
          // Share of the estate that is certified — a ratio of two live counts.
          shareOfTotal: pct(verifiedPharmacies, totalPharmacies),
        },
        pendingVerifications: { value: pendingVerifications },
        // NOTE: "active" here means the account is enabled (User.isActive), not
        // weekly-active. There is no session or last-seen column to measure
        // engagement from; see `unavailable.weeklyActiveUsers`.
        activeUsers: { value: activeUsers, spark: userSpark },
        totalMedicines: { value: totalMedicines, spark: medicineSpark },
        searchesToday: {
          value: searchesToday,
          previous: searchesYesterday,
          changePct: delta(searchesToday, searchesYesterday),
          spark: searchSpark,
        },
        // Confirmation events are ingested by ZoikoSignal but none have been
        // recorded, so the rate has no denominator to divide by.
        confirmationRate:
          confirmationEvents + restockEvents > 0
            ? {
                value: pct(confirmationEvents, confirmationEvents + restockEvents),
                sample: confirmationEvents + restockEvents,
              }
            : gap(
                'No CONFIRMATION signal events have been recorded.',
                'SignalEvent rows of type CONFIRMATION (SignalIngestService.recordConfirmation).',
              ),
        apiRequestsToday: gap(
          'The platform does not record per-request telemetry.',
          'A request-metering store. UsageEvent exists for billing but is empty and is not wired to API traffic.',
        ),
        systemHealth: gap(
          'No uptime or health-probe data is collected.',
          'An uptime/monitoring source (probe results or an external status provider).',
        ),
        activeIntegrations: gap(
          'There is no integration or connector model in the schema.',
          'An Integration/Connector model recording configured ERP connections.',
        ),
      },

      // Live confidence mix across every availability signal.
      confidence,

      // Share of availability signals recomputed inside the SLA window.
      freshness: {
        slaHours: FRESHNESS_SLA_HOURS,
        withinSla: freshSignals,
        total: totalSignals,
        pct: pct(freshSignals, totalSignals),
      },

      // Unmet demand over time: ZERO_RESULT searches against total searches.
      shortage,

      // Therapeutic class from the ATC code's anatomical main group.
      categories,

      /**
       * Panels the dashboard renders for which no source exists. The frontend
       * shows each chart's container with an unavailable state rather than a
       * fabricated series.
       */
      unavailable: {
        availabilityTrend: gap(
          'Availability confidence is stored as a current value, never versioned.',
          'A periodic snapshot of AvailabilitySignal confidence/coverage, or a history table.',
        ),
        signalFreshnessTimeline: gap(
          'Only the latest computedAt per signal is kept, so freshness has no history.',
          'A periodic snapshot of the within-SLA share. The current share is returned in `freshness`.',
        ),
        regionalRisk: gap(
          'No regional access-risk metric is computed, and none is retained per period.',
          'A regional risk model plus period-over-period retention.',
        ),
        jurisdictionComparison: gap(
          'The Jurisdiction table is empty, so no jurisdiction has coverage or preparedness data.',
          'Jurisdiction records, plus coverage/preparedness metrics per jurisdiction.',
        ),
        apiUsage: gap(
          'No request telemetry is recorded for production or sandbox traffic.',
          'A request-metering store split by environment.',
        ),
        partnerParticipation: gap(
          'There is no partner organization model.',
          'A Partner/Organization model with type and joined-at, for a trailing series.',
        ),
        availabilityMap: gap(
          'Pharmacies carry a country but no macro-region, coverage or access-risk metric.',
          'A region mapping plus per-region coverage and access-risk metrics.',
        ),
        weeklyActiveUsers: gap(
          'User records have no last-seen or session history.',
          'A lastSeenAt column or a session/activity log. `activeUsers` counts enabled accounts.',
        ),
      },
    };
  }

  /** Searches per day over the sparkline window, zero-filled. */
  private async dailySearches(from: Date, startOfToday: Date) {
    const rows = await this.prisma.$queryRaw<{ day: Date; count: number }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM "SearchHistory"
      WHERE "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
    return this.zeroFill(rows, from, startOfToday);
  }

  /**
   * Running total of a table's rows at the end of each day in the window —
   * what the KPI sparkline under a count is actually showing.
   *
   * The table name is a fixed literal chosen by the caller, never user input.
   */
  private async cumulativeByDay(
    table: 'Pharmacy' | 'User' | 'MedicineEntity',
    from: Date,
    to: Date,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<{ total: number }[]>(
      `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, '1 day')::date AS day
      )
      SELECT (
        SELECT COUNT(*)::int FROM "${table}" t
        WHERE t."createdAt" < d.day + INTERVAL '1 day'
      ) AS total
      FROM days d
      ORDER BY d.day
      `,
      dayKey(from),
      dayKey(to),
    );
    return rows.map((r) => Number(r.total));
  }

  /** Zero-filled daily counts across the window. */
  private zeroFill(rows: { day: Date; count: number }[], from: Date, to: Date) {
    const byDay = new Map(rows.map((r) => [dayKey(new Date(r.day)), Number(r.count)]));
    const out: number[] = [];
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      out.push(byDay.get(dayKey(cursor)) ?? 0);
    }
    return out;
  }

  /** Confidence mix, with every band present even at zero. */
  private confidenceBands(rows: { confidence: AvailabilityConfidence; _count: { _all: number } }[]) {
    const count = (...states: AvailabilityConfidence[]) =>
      rows
        .filter((r) => states.includes(r.confidence))
        .reduce((n, r) => n + r._count._all, 0);

    const high = count('HIGH');
    const moderate = count('MODERATE');
    const low = count('LOW');
    // SUPPRESSED carries no usable confidence, so it reads as unknown — the
    // same mapping the patient surfaces use.
    const unknown = count('UNKNOWN', 'SUPPRESSED');
    const total = high + moderate + low + unknown;

    return { high, moderate, low, unknown, total };
  }

  /**
   * Monthly unmet-demand series: ZERO_RESULT events against all searches.
   *
   * This is a real shortage-pressure proxy — searches the catalog could not
   * answer — not a modelled index. Months with no events are omitted rather
   * than back-filled, so the series never implies history that was not
   * recorded.
   */
  private async shortageSeries() {
    const from = new Date();
    from.setMonth(from.getMonth() - (SHORTAGE_MONTHS - 1));
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const rows = await this.prisma.$queryRaw<
      { month: Date; searches: number; zeroResults: number }[]
    >`
      SELECT
        date_trunc('month', "occurredAt") AS month,
        COUNT(*) FILTER (WHERE type = 'SEARCH')::int AS searches,
        COUNT(*) FILTER (WHERE type = 'ZERO_RESULT')::int AS "zeroResults"
      FROM "SignalEvent"
      WHERE "occurredAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((r) => {
      const searches = Number(r.searches);
      const zeroResults = Number(r.zeroResults);
      return {
        month: new Date(r.month).toISOString().slice(0, 7),
        searches,
        zeroResults,
        // Percentage of demand the catalog could not answer.
        unmetPct: pct(zeroResults, searches + zeroResults),
      };
    });
  }

  /**
   * Therapeutic categories from the ATC anatomical main group (the code's first
   * character). Only medicines carrying an ATC code can be classified, so the
   * response reports how much of the catalog the figures actually cover.
   */
  private async medicineCategories() {
    const [rows, classified, total] = await Promise.all([
      this.prisma.$queryRaw<{ group: string; count: number }[]>`
        SELECT upper(left(btrim("atcCode"), 1)) AS group, COUNT(*)::int AS count
        FROM "MedicineEntity"
        WHERE "atcCode" IS NOT NULL AND btrim("atcCode") <> ''
        GROUP BY 1
        ORDER BY 2 DESC, 1 ASC
      `,
      this.prisma.medicineEntity.count({ where: { NOT: { atcCode: null } } }),
      this.prisma.medicineEntity.count(),
    ]);

    return {
      // How representative the breakdown is — 5 of 54 classified is a very
      // different claim from 54 of 54, and the UI needs to be able to say so.
      classified,
      total,
      items: rows.map((r) => ({
        code: r.group,
        category: ATC_GROUPS[r.group] ?? `ATC ${r.group}`,
        count: Number(r.count),
        share: pct(Number(r.count), classified),
      })),
    };
  }
}

/** UTC midnight on the day of `d`. */
function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `d` shifted by whole days, in UTC. */
function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

/** UTC calendar day as YYYY-MM-DD — the key every daily series is bucketed on. */
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Whole-number percentage, 0 when there is nothing to divide by. */
function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** Percentage change against a previous period; null when there is no baseline. */
function delta(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** ATC level-1 anatomical main groups (WHO ATC classification). */
const ATC_GROUPS: Record<string, string> = {
  A: 'Alimentary & Metabolism',
  B: 'Blood & Blood Forming',
  C: 'Cardiovascular',
  D: 'Dermatologicals',
  G: 'Genito-urinary',
  H: 'Systemic Hormonals',
  J: 'Anti-infectives',
  L: 'Antineoplastic & Immunomodulating',
  M: 'Musculo-skeletal',
  N: 'Nervous System',
  P: 'Antiparasitic',
  R: 'Respiratory',
  S: 'Sensory Organs',
  V: 'Various',
};
