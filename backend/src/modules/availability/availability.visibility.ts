import {
  AvailabilityConfidence,
  CommercialClassification,
  Prisma,
  UserRole,
  VerificationStatus,
} from '@prisma/client';

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

/** A pharmacy whose signals may be shown publicly. */
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
 * The same rule as `PUBLIC_PHARMACY_WHERE`, asked of a row already in hand.
 *
 * The where-clause decides which pharmacies a patient query returns. This
 * answers whether one particular pharmacy is among them — which is what the
 * pharmacy's own portal has to know before it can tell an operator that
 * patients can see them. Re-deriving the rule there would let the two drift,
 * and the failure is silent and in the worst direction: a portal cheerfully
 * reporting "visible to users" about a pharmacy no search returns.
 *
 * Built from the same constant, not a second copy of the list, so a
 * classification added to or removed from the allowlist moves both at once.
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
}): boolean {
  return (
    pharmacy.verificationStatus === VerificationStatus.VERIFIED &&
    pharmacy.isParticipating === true &&
    PATIENT_VISIBLE_CLASSIFICATIONS.includes(pharmacy.commercialClassification) &&
    pharmacy.hasActiveManager === true
  );
}

/**
 * A signal that may be shown publicly, for queries already scoped to a public
 * pharmacy (e.g. an include on a Pharmacy row that PUBLIC_PHARMACY_WHERE
 * selected).
 */
export const VISIBLE_SIGNAL_WHERE: Prisma.AvailabilitySignalWhereInput = {
  // SUPPRESSED is the governed "do not publish this signal" state.
  confidence: { not: AvailabilityConfidence.SUPPRESSED },
};

/** A signal that may be shown publicly, pharmacy standing included. */
export const PUBLIC_SIGNAL_WHERE: Prisma.AvailabilitySignalWhereInput = {
  ...VISIBLE_SIGNAL_WHERE,
  pharmacy: PUBLIC_PHARMACY_WHERE,
};

/**
 * Publicly visible signals with their pharmacy, for `include` on a
 * MedicineEntity or SavedMedicine query.
 */
export const PUBLIC_SIGNALS_INCLUDE = {
  where: PUBLIC_SIGNAL_WHERE,
  include: { pharmacy: true },
};

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
