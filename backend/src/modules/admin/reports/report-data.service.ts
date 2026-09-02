import { Injectable } from '@nestjs/common';
import {
  AvailabilityConfidence,
  Report,
  ReportScope,
  ReportType,
  SignalEventType,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PUBLIC_SIGNAL_WHERE } from '../../availability/availability.visibility';
import { reportPurpose } from './report-purpose';

/**
 * The aggregate figures a generated report actually states.
 *
 * Every number here is a count, a min or a max of rows that exist. Nothing is
 * modelled, scored, projected or rounded into a headline: a governance console
 * that prints a plausible figure is worse than one that prints nothing, because
 * the reader cannot tell which they are looking at. Where a figure has no
 * source the section is omitted and the report says so.
 *
 * The freshness target is the same six hours the Super Admin dashboard already
 * measures against, so the two surfaces cannot disagree about what "stale"
 * means.
 */

/** Hours before an availability signal counts as stale. Matches the dashboard. */
export const FRESHNESS_SLA_HOURS = 6;

export interface ReportMetric {
  label: string;
  value: string;
}

export interface ReportSection {
  heading: string;
  metrics: ReportMetric[];
}

export interface ReportContent {
  purpose: string[];
  /** Deterministic prose built only from the figures below it. */
  summary: string[];
  /** The handful of figures that lead the report. */
  keyMetrics: ReportMetric[];
  sections: ReportSection[];
  /**
   * Set when the report type has no analytics source at all. The export is then
   * a metadata and governance record, and says as much.
   */
  unavailable?: string;
}

const nf = new Intl.NumberFormat('en-GB');
const count = (n: number) => nf.format(n);

/** A figure and what it is out of, when the denominator is itself real. */
function share(part: number, total: number): string {
  if (total <= 0) return count(part);
  return `${count(part)} of ${count(total)} (${Math.round((part / total) * 100)}%)`;
}

const stamp = (d: Date | null) =>
  d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'None recorded';

@Injectable()
export class ReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build everything a report states about itself beyond its stored row.
   *
   * Which sections a report carries follows from its type and scope, because
   * those are the two fields that decide what it is about. A scope narrows the
   * blocks a type would otherwise include rather than adding to them.
   */
  async build(report: Report): Promise<ReportContent> {
    const purpose = reportPurpose(report.type, report.scope);

    // Forecasting is offered as a report type and nothing in the platform
    // produces a projection — no model, no service, no column. Saying so is the
    // honest export; filling the section with a modelled number the reader
    // would take for a measurement is not.
    if (report.type === ReportType.FORECAST) {
      return {
        purpose,
        summary: [
          'Detailed analytics for this report type are not currently available. The platform does not yet produce demand or shortage projections, so this export records the request and the rules it was made under.',
        ],
        keyMetrics: [],
        sections: [],
        unavailable:
          'Detailed analytics for this report type are not currently available. No projection data is produced by the platform, and none has been substituted here.',
      };
    }

    const blocks = this.blocksFor(report.type, report.scope);
    const sections: ReportSection[] = [];
    for (const block of blocks) {
      const section = await block();
      // A block whose source holds nothing at all is dropped rather than
      // printed as a row of zeroes with no explanation.
      if (section) sections.push(section);
    }

    const { keyMetrics, summary } = await this.headline(report);

    return { purpose, summary, keyMetrics, sections };
  }

  /** Which aggregate blocks this type and scope calls for. */
  private blocksFor(
    type: ReportType,
    scope: ReportScope,
  ): Array<() => Promise<ReportSection | null>> {
    const signal = [
      () => this.signalOverview(),
      () => this.confidenceDistribution(),
      () => this.signalFreshness(),
    ];
    const catalog = [() => this.catalogCoverage()];
    const network = [() => this.networkParticipation()];
    const region = [() => this.jurisdictionCoverage()];
    const demand = [() => this.demandSignals()];
    const governance = [() => this.governanceActivity()];

    // The scope is the narrower answer, so it wins where it applies.
    if (scope === ReportScope.SIGNAL) {
      return type === ReportType.DATA_QUALITY ? [...signal, ...catalog] : signal;
    }
    if (scope === ReportScope.NETWORK) {
      return [...network, () => this.signalOverview()];
    }
    if (scope === ReportScope.JURISDICTION) {
      return [...region, ...catalog];
    }

    // Scope ALL — the type decides.
    switch (type) {
      case ReportType.DATA_QUALITY:
        return [...signal, ...catalog, ...network];
      case ReportType.OPERATIONS:
        return [() => this.signalOverview(), () => this.signalFreshness(), ...network];
      case ReportType.NETWORK_REPORT:
        return [...network, () => this.signalOverview()];
      case ReportType.REGIONAL_DIGEST:
        return [...region, ...demand];
      case ReportType.GOVERNANCE_EXPORT:
        return [...governance, () => this.signalOverview()];
      case ReportType.EXECUTIVE_BRIEFING:
      default:
        return [() => this.signalOverview(), ...network, ...demand];
    }
  }

  /**
   * The figures that lead the report, and the sentences built from them.
   *
   * The summary is assembled from these same numbers rather than written
   * alongside them, so the prose cannot claim something the figures do not say.
   * A clause is only included when the value it describes exists.
   */
  private async headline(
    report: Report,
  ): Promise<{ keyMetrics: ReportMetric[]; summary: string[] }> {
    const [signals, visible, medicinesWithSignals, contributing, participating] =
      await Promise.all([
        this.prisma.availabilitySignal.count(),
        this.prisma.availabilitySignal.count({ where: PUBLIC_SIGNAL_WHERE }),
        this.distinct('medicineId'),
        this.distinct('pharmacyId'),
        this.prisma.pharmacy.count({
          where: { verificationStatus: VerificationStatus.VERIFIED, isParticipating: true },
        }),
      ]);

    const keyMetrics: ReportMetric[] = [
      { label: 'Availability signals on record', value: count(signals) },
      { label: 'Signals visible to patients', value: share(visible, signals) },
      { label: 'Medicine identities with a signal', value: count(medicinesWithSignals) },
      { label: 'Pharmacies contributing signals', value: count(contributing) },
      { label: 'Verified, participating pharmacies', value: count(participating) },
    ];

    const summary: string[] = [];
    if (signals === 0) {
      summary.push(
        `The ${humanScope(report.scope)} ${humanType(report.type)} report found no availability signals on record. The sections below state the counts as they are rather than omitting them.`,
      );
    } else {
      summary.push(
        `This report covers ${count(signals)} availability ${plural(signals, 'signal')} across ${count(medicinesWithSignals)} medicine ${plural(medicinesWithSignals, 'identity', 'identities')} and ${count(contributing)} contributing ${plural(contributing, 'pharmacy', 'pharmacies')}, of which ${count(visible)} ${signals === 1 ? 'is' : 'are'} currently visible to patients.`,
      );
    }

    const suppressed = await this.prisma.availabilitySignal.count({
      where: { confidence: AvailabilityConfidence.SUPPRESSED },
    });
    if (suppressed > 0) {
      summary.push(
        `${count(suppressed)} ${plural(suppressed, 'signal')} ${suppressed === 1 ? 'is' : 'are'} suppressed and therefore withheld from patients.`,
      );
    }

    const stale = await this.prisma.availabilitySignal.count({
      where: { computedAt: { lt: this.freshnessCutoff() } },
    });
    if (stale > 0) {
      summary.push(
        `${count(stale)} ${plural(stale, 'signal')} ${stale === 1 ? 'has' : 'have'} not been recomputed within the ${FRESHNESS_SLA_HOURS}-hour freshness target.`,
      );
    }

    return { keyMetrics, summary };
  }

  // === Aggregate blocks ====================================================

  /** How many signals there are, and how many of them reach a patient. */
  private async signalOverview(): Promise<ReportSection> {
    const [total, visible, suppressed, unknown, awaiting, medicines, pharmacies] =
      await Promise.all([
        this.prisma.availabilitySignal.count(),
        this.prisma.availabilitySignal.count({ where: PUBLIC_SIGNAL_WHERE }),
        this.prisma.availabilitySignal.count({
          where: { confidence: AvailabilityConfidence.SUPPRESSED },
        }),
        this.prisma.availabilitySignal.count({
          where: { confidence: AvailabilityConfidence.UNKNOWN },
        }),
        this.prisma.availabilitySignal.count({ where: { requiresConfirmation: true } }),
        this.distinct('medicineId'),
        this.distinct('pharmacyId'),
      ]);

    return {
      heading: 'Signal overview',
      metrics: [
        { label: 'Total signal records', value: count(total) },
        { label: 'Visible to patients', value: share(visible, total) },
        { label: 'Withheld from patients', value: share(total - visible, total) },
        { label: 'Suppressed', value: count(suppressed) },
        { label: 'No usable confidence recorded', value: count(unknown) },
        { label: 'Awaiting pharmacy confirmation', value: count(awaiting) },
        { label: 'Medicines with at least one signal', value: count(medicines) },
        { label: 'Pharmacies contributing signals', value: count(pharmacies) },
      ],
    };
  }

  /** The confidence bands, as the platform stores them. */
  private async confidenceDistribution(): Promise<ReportSection> {
    const rows = await this.prisma.availabilitySignal.groupBy({
      by: ['confidence'],
      _count: { _all: true },
    });
    const of = (band: AvailabilityConfidence) =>
      rows.find((r) => r.confidence === band)?._count._all ?? 0;
    const total = rows.reduce((n, r) => n + r._count._all, 0);

    return {
      heading: 'Confidence distribution',
      metrics: [
        { label: 'High', value: share(of(AvailabilityConfidence.HIGH), total) },
        { label: 'Moderate', value: share(of(AvailabilityConfidence.MODERATE), total) },
        { label: 'Low', value: share(of(AvailabilityConfidence.LOW), total) },
        { label: 'Unknown', value: share(of(AvailabilityConfidence.UNKNOWN), total) },
        { label: 'Suppressed', value: share(of(AvailabilityConfidence.SUPPRESSED), total) },
      ],
    };
  }

  /** How current the signals are, against the platform's own target. */
  private async signalFreshness(): Promise<ReportSection> {
    const cutoff = this.freshnessCutoff();
    const [total, fresh, extremes] = await Promise.all([
      this.prisma.availabilitySignal.count(),
      this.prisma.availabilitySignal.count({ where: { computedAt: { gte: cutoff } } }),
      this.prisma.availabilitySignal.aggregate({
        _min: { computedAt: true },
        _max: { computedAt: true },
      }),
    ]);

    return {
      heading: 'Freshness',
      metrics: [
        { label: `Freshness target`, value: `${FRESHNESS_SLA_HOURS} hours` },
        { label: 'Recomputed within target', value: share(fresh, total) },
        { label: 'Stale against target', value: share(total - fresh, total) },
        { label: 'Oldest signal', value: stamp(extremes._min.computedAt) },
        { label: 'Most recent signal', value: stamp(extremes._max.computedAt) },
      ],
    };
  }

  /** How much of the catalog the signals actually cover. */
  private async catalogCoverage(): Promise<ReportSection> {
    const [medicines, suppressedMedicines, unGoverned, withSignals] = await Promise.all([
      this.prisma.medicineEntity.count(),
      this.prisma.medicineEntity.count({ where: { isSuppressed: true } }),
      this.prisma.medicineEntity.count({ where: { jurisdictionId: null } }),
      this.distinct('medicineId'),
    ]);

    return {
      heading: 'Catalog coverage and quality',
      metrics: [
        { label: 'Medicine identities in MediBase', value: count(medicines) },
        { label: 'With at least one availability signal', value: share(withSignals, medicines) },
        {
          label: 'With no availability signal',
          value: share(Math.max(0, medicines - withSignals), medicines),
        },
        { label: 'Withheld from patients (suppressed)', value: count(suppressedMedicines) },
        { label: 'Not assigned to a jurisdiction', value: share(unGoverned, medicines) },
      ],
    };
  }

  /** The state of the pharmacy network behind the signals. */
  private async networkParticipation(): Promise<ReportSection> {
    const [total, verified, participating, pendingReview, contributing] = await Promise.all([
      this.prisma.pharmacy.count(),
      this.prisma.pharmacy.count({
        where: { verificationStatus: VerificationStatus.VERIFIED },
      }),
      this.prisma.pharmacy.count({
        where: { verificationStatus: VerificationStatus.VERIFIED, isParticipating: true },
      }),
      this.prisma.verificationRequest.count({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'ESCALATED', 'REQUEST_INFO'] } },
      }),
      this.distinct('pharmacyId'),
    ]);

    return {
      heading: 'Network participation',
      metrics: [
        { label: 'Pharmacy records', value: count(total) },
        { label: 'Verified', value: share(verified, total) },
        { label: 'Verified and participating', value: share(participating, total) },
        { label: 'Contributing availability signals', value: share(contributing, total) },
        { label: 'Verification requests awaiting review', value: count(pendingReview) },
      ],
    };
  }

  /**
   * Jurisdiction coverage.
   *
   * Zero configured jurisdictions is a real reading of an empty table, not a
   * missing figure, and the report states it as such — the same answer the
   * dashboard gives for the same source.
   */
  private async jurisdictionCoverage(): Promise<ReportSection> {
    const [jurisdictions, medicines, governed] = await Promise.all([
      this.prisma.jurisdiction.count(),
      this.prisma.medicineEntity.count(),
      this.prisma.medicineEntity.count({ where: { jurisdictionId: { not: null } } }),
    ]);

    return {
      heading: 'Jurisdiction coverage',
      metrics: [
        { label: 'Jurisdictions configured', value: count(jurisdictions) },
        { label: 'Medicine identities governed by one', value: share(governed, medicines) },
        {
          label: 'Medicine identities with none',
          value: share(Math.max(0, medicines - governed), medicines),
        },
      ],
    };
  }

  /**
   * Recorded demand events.
   *
   * These are the anonymised SignalEvent rows — what happened and which
   * governed identity it concerned, never who caused it.
   */
  private async demandSignals(): Promise<ReportSection | null> {
    const rows = await this.prisma.signalEvent.groupBy({
      by: ['type'],
      _count: { _all: true },
    });
    if (rows.length === 0) return null;

    const of = (type: SignalEventType) =>
      rows.find((r) => r.type === type)?._count._all ?? 0;
    const searches = of(SignalEventType.SEARCH);
    const zero = of(SignalEventType.ZERO_RESULT);

    return {
      heading: 'Recorded demand',
      metrics: [
        { label: 'Medicine searches', value: count(searches) },
        { label: 'Searches the catalog could not answer', value: share(zero, searches) },
        { label: 'Restock reports', value: count(of(SignalEventType.RESTOCK)) },
        { label: 'Availability confirmations', value: count(of(SignalEventType.CONFIRMATION)) },
      ],
    };
  }

  /** What the platform has recorded about its own governed activity. */
  private async governanceActivity(): Promise<ReportSection> {
    const [auditEntries, reports, exportsThisMonth] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.report.count(),
      this.prisma.report.count({ where: { createdAt: { gte: startOfMonth() } } }),
    ]);

    return {
      heading: 'Governed activity',
      metrics: [
        { label: 'Audit log entries', value: count(auditEntries) },
        { label: 'Saved reports', value: count(reports) },
        { label: 'Reports created this month', value: count(exportsThisMonth) },
      ],
    };
  }

  // === Helpers =============================================================

  /** Distinct values of a signal column, counted without loading the rows. */
  private async distinct(field: 'medicineId' | 'pharmacyId'): Promise<number> {
    const rows = await this.prisma.availabilitySignal.groupBy({
      by: [field],
      _count: { _all: true },
    });
    return rows.length;
  }

  private freshnessCutoff(): Date {
    return new Date(Date.now() - FRESHNESS_SLA_HOURS * 3600_000);
  }
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function humanType(type: ReportType): string {
  return type.toLowerCase().split('_').join(' ');
}

function humanScope(scope: ReportScope): string {
  return scope === ReportScope.ALL ? 'all-intelligence' : scope.toLowerCase();
}
