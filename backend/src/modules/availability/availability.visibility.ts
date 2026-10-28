import {
  AvailabilityConfidence,
  CommercialClassification,
  Prisma,
  SubscriptionState,
  UserRole,
  VerificationStatus,
} from '@prisma/client';
import {
  COMMERCIALLY_AUTHORISED_CLASSIFICATIONS,
  VISIBILITY_ENTITLING_STATES,
} from '../commercial/commercial.doctrine';

/**
 * ZoikoAvail™ — the single rule that decides which availability records a
 * patient may be shown.
 *
 * Every public surface (medicine search, medicine detail, saved medicines,
 * ZoikoSignal) reads the SAME AvailabilitySignal rows the pharmacy portal
 * writes, so they must also agree on which of those rows count. When the rule
 * was copied per service they drifted: /availability hid non-participating
 * pharmacies and suppressed signals while /me/search still listed them, so the
 * same pharmacy could be "stocking" a medicine on one screen and absent on
 * another.
 *
 * The identity a signal is attached to is always its `medicineId` — the MediBase
 * identity — never a medicine name. Names are for resolving the patient's query
 * into identities; availability is only ever looked up by identity id.
 */

/**
 * Classifications that mean somebody runs this pharmacy on ZoikoMeds.
 *
 * An allowlist rather than a list of exclusions: the enum gains values over
 * time, and a new one — another sandbox, another billing state — should have to
 * be named here before patients are shown it, not become visible by default.
 *
 * Left out on purpose:
 *   DIRECTORY_UNCLAIMED     preloaded record; nobody has claimed it
 *   CLAIMED_PENDING         claimed, but the claimant's authority is unproven
 *   VERIFICATION_IN_REVIEW  still being decided
 *   INTERNAL / DEMO / QA / STAGING / PARTNER_SANDBOX   not a real pharmacy
 *   SUSPENDED_COMPLIANCE / REJECTED / CLOSED           no longer trading here
 */
export const PATIENT_VISIBLE_CLASSIFICATIONS: CommercialClassification[] = [
  CommercialClassification.VERIFIED_NETWORK_CORE,
  CommercialClassification.PRO_EVALUATION,
  CommercialClassification.PRO_ACTIVE,
  CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
  CommercialClassification.PILOT_NON_BILLABLE,
];

/**
 * The roles that operate a pharmacy on ZoikoMeds.
 *
 * Staff as well as admins: a branch run day to day by a staff account is still
 * being run by somebody, and hiding it because the admin seat is empty would
 * take a working pharmacy off patient search.
 */
export const PHARMACY_OPERATOR_ROLES: UserRole[] = [
  UserRole.PHARMACY_ADMIN,
  UserRole.PHARMACY_STAFF,
];

/**
 * Somebody is actually running this pharmacy.
 *
 * The classification allowlist above already says patients are only shown
 * pharmacies somebody runs — that is what excludes DIRECTORY_UNCLAIMED, and it
 * is the whole point of MSA-54: approving a licence says the pharmacy is real,
 * not that anyone stands behind the stock levels it reports.
 *
 * But a classification only records that somebody claimed the pharmacy once. It
 * cannot express the operator going away. Once promoted to VERIFIED_NETWORK_CORE
 * a record kept that standing forever, so delinking the last manager account
 * left the pharmacy — and every medicine it had reported — in patient search
 * with nobody answering for any of it. Being claimed is a fact about the past;
 * being managed is a fact about now, and patients are shown the second one.
 *
 * Derived rather than stored, deliberately. A flag recomputed on delink is a
 * flag that goes stale the moment somebody relinks through a path that forgot
 * to recompute it — the exact failure the classification promotion was written
 * to end. Asking the relation means a relink restores visibility immediately
 * and needs no inventory re-upload, and there is no third copy of the truth.
 */
export const ACTIVE_PHARMACY_MANAGER_WHERE: Prisma.PharmacyWhereInput = {
  users: { some: { isActive: true, role: { in: PHARMACY_OPERATOR_ROLES } } },
};

/**
 * The safety gates: everything about a pharmacy that is true regardless of what
 * it pays.
 *
 * Kept as a plain constant, and kept separate from commercial eligibility on
 * purpose. These clauses have no notion of "now" and never will, so they stay
 * comparable, spreadable and testable on their own — and the separation makes
 * the invariant in `publicPharmacyWhere` legible: paying is added to these, it
 * never replaces one of them.
 */
export const PUBLIC_PHARMACY_WHERE: Prisma.PharmacyWhereInput = {
  // Not yet verified, rejected or suspended: not part of the verified network,
  // so it must never be presented as one.
  verificationStatus: VerificationStatus.VERIFIED,
  // A pharmacy that has left the network keeps its rows (it may come back) but
  // stops speaking to patients — otherwise its last signal reads as current.
  isParticipating: true,
  // Claiming and verification answer different questions, and this rule needs
  // both. Approving a licence says the pharmacy is real; it does not say anyone
  // has taken responsibility for what it reports. A preloaded directory record
  // that a reviewer approved was appearing in patient search as though its
  // operator were standing behind the stock levels, when nobody had claimed it
  // at all (MSA-54). Approval deliberately does not promote the classification,
  // so the claim has to happen on its own.
  commercialClassification: { in: PATIENT_VISIBLE_CLASSIFICATIONS },
  // And somebody has to still be running it. See ACTIVE_PHARMACY_MANAGER_WHERE:
  // the classification records a claim that was made, this records an operator
  // who is there now, and a delinked pharmacy has the first without the second.
  ...ACTIVE_PHARMACY_MANAGER_WHERE,
};

/**
 * Commercial eligibility, as a query clause.
 *
 * A function rather than a constant because it compares against `now`: a trial
 * is live until its own end date, and a constant captured at module load would
 * freeze that comparison at process start. The dates are asked of the database
 * on every query, so a trial that lapses one second ago stops being visible on
 * the next search — not when a background job next happens to run.
 *
 * The classification is deliberately NOT consulted for evaluations here. It is
 * written by `expireEvaluations`, so between a trial lapsing and that job
 * running the pharmacy still reads PRO_EVALUATION; trusting the string would
 * grant free visibility for as long as the scheduler was behind or down.
 */
export function commerciallyEligibleWhere(now: Date = new Date()): Prisma.PharmacyWhereInput {
  return {
    OR: [
      // Invoiced outside the provider, or deliberately non-billable: no
      // self-serve subscription row is expected to exist. See
      // COMMERCIALLY_AUTHORISED_CLASSIFICATIONS.
      { commercialClassification: { in: [...COMMERCIALLY_AUTHORISED_CLASSIFICATIONS] } },
      // A live trial, or a paid term that has not yet run out of grace.
      {
        subscriptionLocations: {
          some: {
            releasedAt: null,
            subscription: {
              OR: [
                { state: SubscriptionState.EVALUATION, evaluationEndsAt: { gt: now } },
                { state: { in: [...VISIBILITY_ENTITLING_STATES] } },
              ],
            },
          },
        },
      },
    ],
  };
}

/**
 * The whole rule: a pharmacy whose signals may be shown publicly.
 *
 * Safety AND commerce, in that order and both required. Payment is additive —
 * it can never satisfy verification, participation, a claimed classification or
 * an operator account, so a paying pharmacy whose licence lapses disappears
 * exactly as an unpaid one does.
 */
export function publicPharmacyWhere(now: Date = new Date()): Prisma.PharmacyWhereInput {
  // The commercial clause is an OR, and object spread keeps only one key of a
  // name: spread at the top level, a caller adding its own `OR` beside this —
  // `{ ...publicPharmacyWhere(), OR: [...] }` — would silently replace it and
  // list every unpaid pharmacy. Inside `AND` it cannot collide with a caller's
  // OR. The safety clauses stay flat so they remain readable and comparable.
  // A caller that needs its own AND should compose rather than spread:
  // `{ AND: [publicPharmacyWhere(), extra] }`.
  return { ...PUBLIC_PHARMACY_WHERE, AND: [commerciallyEligibleWhere(now)] };
}

/**
 * The same rule as `publicPharmacyWhere`, asked of a row already in hand.
 *
 * The where-clause decides which pharmacies a patient query returns. This
 * answers whether one particular pharmacy is among them — which is what the
 * pharmacy's own portal has to know before it can tell an operator that
 * patients can see them. Re-deriving the rule there would let the two drift,
 * and the failure is silent and in the worst direction: a portal cheerfully
 * reporting "visible to users" about a pharmacy no search returns.
 *
 * Built from the same constants, not a second copy of the lists, so a
 * classification added to or removed from either allowlist moves both at once.
 */
export function isPatientVisible(pharmacy: {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  /**
   * Whether an active PHARMACY_ADMIN or PHARMACY_STAFF account is linked.
   *
   * Required rather than optional, and required for a reason: the caller that
   * forgets it is the caller that tells an operator "patients can see you"
   * about a pharmacy no patient query returns. A default would make that
   * mistake silent, so the type asks the question out loud.
   */
  hasActiveManager: boolean;
  /**
   * Whether a live trial, a paid term still within its grace period, or an
   * authorised enterprise/pilot standing covers this pharmacy right now.
   *
   * Required for the same reason as `hasActiveManager`, and the newer of the
   * two mistakes: a caller that omits it is a caller that tells an unpaid
   * pharmacy patients can find it. Compute it with
   * `isCommerciallyEligibleForVisibility`, from subscription rows — never from
   * the classification string alone, and never from anything the browser said.
   */
  commerciallyEligible: boolean;
}): boolean {
  return (
    pharmacy.verificationStatus === VerificationStatus.VERIFIED &&
    pharmacy.isParticipating === true &&
    PATIENT_VISIBLE_CLASSIFICATIONS.includes(pharmacy.commercialClassification) &&
    pharmacy.hasActiveManager === true &&
    pharmacy.commerciallyEligible === true
  );
}

/**
 * A signal that may be shown publicly, for queries already scoped to a public
 * pharmacy (e.g. an include on a Pharmacy row that publicPharmacyWhere
 * selected).
 */
export const VISIBLE_SIGNAL_WHERE: Prisma.AvailabilitySignalWhereInput = {
  // SUPPRESSED is the governed "do not publish this signal" state.
  confidence: { not: AvailabilityConfidence.SUPPRESSED },
};

/** A signal that may be shown publicly, pharmacy standing included. */
export function publicSignalWhere(now: Date = new Date()): Prisma.AvailabilitySignalWhereInput {
  return { ...VISIBLE_SIGNAL_WHERE, pharmacy: publicPharmacyWhere(now) };
}

/**
 * Publicly visible signals with their pharmacy, for `include` on a
 * MedicineEntity or SavedMedicine query.
 */
export function publicSignalsInclude(now: Date = new Date()) {
  return { where: publicSignalWhere(now), include: { pharmacy: true } };
}

/**
 * Age of a signal in minutes.
 *
 * `freshnessMinutes` is a stored, optional snapshot; when it was never written
 * the age still follows from `computedAt`, which every row has. Public surfaces
 * quote the same age as the pharmacy portal rather than "no recent signal" for a
 * signal that plainly has a timestamp.
 */
export function signalAgeMinutes(
  stored: number | null | undefined,
  computedAt: Date,
): number {
  if (stored != null) return stored;
  return Math.max(0, Math.round((Date.now() - computedAt.getTime()) / 60000));
}
