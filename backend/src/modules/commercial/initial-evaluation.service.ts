import { Injectable } from '@nestjs/common';
import { CommercialClassification, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { isPatientVisible } from '../availability/availability.visibility';
import { PRO_EVALUATION_DAYS, isCommerciallyEligibleForVisibility } from './commercial.doctrine';
import {
  CommercialStanding,
  INITIAL_EVALUATION_SELECT,
  InitialEvaluationBlock,
  InitialEvaluationOutcome,
  InitialEvaluationRow,
  commercialStanding,
  grantInitialEvaluation,
  initialEvaluationBlockedReason,
} from './initial-evaluation';

/** One verified pharmacy, as the remediation report sees it. */
interface AssessedPharmacy {
  pharmacyId: string;
  name: string;
  classification: CommercialClassification;
  standing: CommercialStanding;
  isParticipating: boolean;
  /** Listed under the safety gates alone: the rule before commercial eligibility. */
  visibleBefore: boolean;
  /** Listed under the current rule, safety and commerce together. */
  visibleAfter: boolean;
  /** Listed if the backfill ran: the current rule, plus a trial for every candidate. */
  visibleAfterBackfill: boolean;
  /** Null when the pharmacy would receive an initial trial. */
  blockedReason: InitialEvaluationBlock | null;
}

export interface RemediationGroup {
  classification: CommercialClassification;
  standing: CommercialStanding;
  pharmacies: number;
  participating: number;
  visibleBefore: number;
  visibleAfter: number;
  visibleAfterBackfill: number;
}

export interface RemediationReport {
  generatedAt: string;
  trialDays: number;
  totals: {
    verified: number;
    verifiedParticipating: number;
    visibleBefore: number;
    visibleAfter: number;
    visibleAfterBackfill: number;
    /** Listed before commercial eligibility existed, not listed now. */
    hiddenByCommercialRule: number;
    /** Would receive an initial trial if the backfill ran. */
    backfillCandidates: number;
  };
  groups: RemediationGroup[];
  candidates: Array<{ pharmacyId: string; name: string }>;
  /**
   * Hidden by the commercial rule and not restored by the backfill: a lapsed
   * trial, an ended term, or a reason the trial cannot be started. Each needs a
   * person to decide, which is why the backfill does not touch them.
   */
  hiddenWithoutBackfill: Array<{
    pharmacyId: string;
    name: string;
    classification: CommercialClassification;
    standing: CommercialStanding;
    reason: InitialEvaluationBlock | null;
  }>;
}

export interface BackfillResult {
  dryRun: boolean;
  candidates: number;
  attempted: number;
  granted: Array<{ pharmacyId: string; subscriptionId: string; evaluationEndsAt: string }>;
  skipped: Array<{ pharmacyId: string; reason: string }>;
}

/**
 * Remediation for pharmacies that joined the network before the initial trial
 * was granted automatically.
 *
 * Deliberately not automatic. The grant on network join covers every pharmacy
 * from here on; for the ones already in the network, starting 30 days of free
 * Pro is a commercial decision with a date attached, so it is made by a person:
 * read the report, then run the backfill — a dry run unless told otherwise.
 *
 * The backfill only ever does what the network-join grant would have done: the
 * same eligibility rule, the same locked transaction, one trial per pharmacy
 * ever. Live trials, paid terms, grace periods, enterprise and pilot pharmacies
 * are never candidates, and a trial that already ran is never restarted. Running
 * it twice grants nothing the second time.
 */
@Injectable()
export class InitialEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /** Read-only. Writes nothing, whatever it finds. */
  async remediationReport(now: Date = new Date()): Promise<RemediationReport> {
    const assessed = await this.assessVerifiedPharmacies(now);

    const groups = new Map<string, RemediationGroup>();
    for (const p of assessed) {
      const key = `${p.classification}|${p.standing}`;
      const group =
        groups.get(key) ??
        ({
          classification: p.classification,
          standing: p.standing,
          pharmacies: 0,
          participating: 0,
          visibleBefore: 0,
          visibleAfter: 0,
          visibleAfterBackfill: 0,
        } satisfies RemediationGroup);
      group.pharmacies += 1;
      if (p.isParticipating) group.participating += 1;
      if (p.visibleBefore) group.visibleBefore += 1;
      if (p.visibleAfter) group.visibleAfter += 1;
      if (p.visibleAfterBackfill) group.visibleAfterBackfill += 1;
      groups.set(key, group);
    }

    const count = (predicate: (p: AssessedPharmacy) => boolean) =>
      assessed.filter(predicate).length;

    return {
      generatedAt: now.toISOString(),
      trialDays: PRO_EVALUATION_DAYS,
      totals: {
        verified: assessed.length,
        verifiedParticipating: count((p) => p.isParticipating),
        visibleBefore: count((p) => p.visibleBefore),
        visibleAfter: count((p) => p.visibleAfter),
        visibleAfterBackfill: count((p) => p.visibleAfterBackfill),
        hiddenByCommercialRule: count((p) => p.visibleBefore && !p.visibleAfter),
        backfillCandidates: count((p) => p.blockedReason === null),
      },
      groups: [...groups.values()].sort(
        (a, b) =>
          a.classification.localeCompare(b.classification) || a.standing.localeCompare(b.standing),
      ),
      candidates: assessed
        .filter((p) => p.blockedReason === null)
        .map((p) => ({ pharmacyId: p.pharmacyId, name: p.name })),
      hiddenWithoutBackfill: assessed
        .filter((p) => p.visibleBefore && !p.visibleAfterBackfill)
        .map((p) => ({
          pharmacyId: p.pharmacyId,
          name: p.name,
          classification: p.classification,
          standing: p.standing,
          reason: p.blockedReason,
        })),
    };
  }

  /**
   * Grant the initial trial to every pharmacy that qualifies for one.
   *
   * A dry run unless `dryRun` is explicitly false: the default does nothing but
   * list who would receive a trial. Each grant re-checks eligibility under the
   * pharmacy's row lock, so a candidate that changed since the list was read —
   * or that a concurrent run already served — is skipped, not served twice.
   */
  async backfill(input: {
    actorId: string | null;
    dryRun?: boolean;
    limit?: number;
    ipAddress?: string;
    now?: Date;
  }): Promise<BackfillResult> {
    const now = input.now ?? new Date();
    const dryRun = input.dryRun !== false;
    const candidates = (await this.assessVerifiedPharmacies(now)).filter(
      (p) => p.blockedReason === null,
    );
    const batch =
      input.limit && input.limit > 0 ? candidates.slice(0, input.limit) : candidates;

    const result: BackfillResult = {
      dryRun,
      candidates: candidates.length,
      attempted: 0,
      granted: [],
      skipped: [],
    };
    if (dryRun) return result;

    for (const candidate of batch) {
      result.attempted += 1;
      const outcome: InitialEvaluationOutcome = await grantInitialEvaluation(
        this.prisma,
        this.audit,
        candidate.pharmacyId,
        { trigger: 'backfill', actorId: input.actorId, ipAddress: input.ipAddress, now },
      );
      if (outcome.granted) {
        result.granted.push({
          pharmacyId: candidate.pharmacyId,
          subscriptionId: outcome.subscriptionId,
          evaluationEndsAt: outcome.evaluationEndsAt.toISOString(),
        });
      } else {
        result.skipped.push({ pharmacyId: candidate.pharmacyId, reason: outcome.reason });
      }
    }

    await this.audit.write(
      input.actorId,
      'commercial.evaluation.backfill',
      'Pharmacy',
      null,
      {
        candidates: result.candidates,
        attempted: result.attempted,
        granted: result.granted.length,
        skipped: result.skipped.length,
      },
      input.ipAddress,
    );
    return result;
  }

  private async assessVerifiedPharmacies(now: Date): Promise<AssessedPharmacy[]> {
    const rows: InitialEvaluationRow[] = await this.prisma.pharmacy.findMany({
      where: { verificationStatus: VerificationStatus.VERIFIED },
      select: INITIAL_EVALUATION_SELECT,
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => {
      const gates = {
        verificationStatus: row.verificationStatus,
        isParticipating: row.isParticipating,
        commercialClassification: row.commercialClassification,
        hasActiveManager: row.users.length > 0,
      };
      const commerciallyEligible = isCommerciallyEligibleForVisibility({
        commercialClassification: row.commercialClassification,
        subscriptions: row.subscriptionLocations
          .filter((link) => link.releasedAt === null)
          .map((link) => link.subscription),
        now,
      });
      const blockedReason = initialEvaluationBlockedReason(row);
      const visibleAfter = isPatientVisible({ ...gates, commerciallyEligible });

      return {
        pharmacyId: row.id,
        name: row.name,
        classification: row.commercialClassification,
        standing: commercialStanding(row.commercialClassification, row.subscriptionLocations, now),
        isParticipating: row.isParticipating,
        visibleBefore: isPatientVisible({ ...gates, commerciallyEligible: true }),
        visibleAfter,
        // A candidate passes every safety gate by definition, and the trial both
        // covers it and moves it to PRO_EVALUATION, which the allowlist admits.
        visibleAfterBackfill: visibleAfter || blockedReason === null,
        blockedReason,
      };
    });
  }
}
