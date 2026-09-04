import {
  AvailabilityConfidence,
  CommercialClassification,
  Prisma,
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
}): boolean {
  return (
    pharmacy.verificationStatus === VerificationStatus.VERIFIED &&
    pharmacy.isParticipating === true &&
    PATIENT_VISIBLE_CLASSIFICATIONS.includes(pharmacy.commercialClassification)
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
