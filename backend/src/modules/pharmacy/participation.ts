import { CommercialClassification, VerificationStatus } from '@prisma/client';
import { isPatientVisible } from '../availability/availability.visibility';

/**
 * Whether a pharmacy may be listed to patients.
 *
 * Verification and publication were one act: approving a licence set
 * `verificationStatus = VERIFIED` and `isParticipating = true` in the same
 * write. They are different judgements. Verification asks whether this is a
 * real, licensed pharmacy — a reviewer reads a document and decides. Listing
 * asks whether the record is complete enough for a patient to act on, and the
 * answer to that does not come from the reviewer at all.
 *
 * Fusing them published pharmacies nobody could find. A verification request
 * that arrives without a pharmacy row creates one with no address and no
 * coordinates, and approving the licence marked it participating: part of the
 * verified network, offered to patients, and returned by no search, because
 * every distance-bounded query drops a row with no pin before it is ranked. The
 * console showed it as healthy and verified. Two such records sat in the
 * production network for weeks.
 *
 * So listing carries the extra condition the reviewer was never asked about: a
 * pharmacy has to be somewhere. A licence stays approved on its own merits and
 * is not revoked by a missing pin — the pharmacy simply waits to be published
 * until it has a location, and is published the moment it gets one.
 *
 * This is not an opt-out switch. Nothing lets a pharmacy or an operator set
 * `isParticipating` directly; it is derived, here, from the two facts above, so
 * that every path which can change either of them lands on the same answer.
 */
export function canParticipate(pharmacy: {
  verificationStatus: VerificationStatus;
  latitude: number | null;
  longitude: number | null;
}): boolean {
  return (
    pharmacy.verificationStatus === VerificationStatus.VERIFIED &&
    pharmacy.latitude != null &&
    pharmacy.longitude != null
  );
}

/**
 * Why a verified pharmacy is not listed, or null when nothing is holding it.
 *
 * Written for a reviewer looking at the record, not for a patient. A blocked
 * listing has to say what would unblock it, or the console shows a pharmacy
 * that is approved and absent with nothing to act on.
 */
export function participationBlockedReason(pharmacy: {
  verificationStatus: VerificationStatus;
  latitude: number | null;
  longitude: number | null;
}): string | null {
  if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) return null;
  if (pharmacy.latitude != null && pharmacy.longitude != null) return null;
  return (
    'Verified, but not listed to patients yet: this pharmacy has no map location, ' +
    'and every patient search is distance-bounded. It is listed automatically as ' +
    'soon as a location is set.'
  );
}

/**
 * Why a pharmacy is not shown to patients, or null when nothing is holding it.
 *
 * `participationBlockedReason` above answers only the location question, which
 * is the one an admin reviewing a record acts on. The pharmacy's own portal has
 * to answer the whole question before it can tell an operator whether patients
 * can see them, and there are three gates, not one: approval, participation and
 * a claimed commercial standing. A verified, located, participating pharmacy
 * whose classification is still CLAIMED_PENDING is returned by no patient
 * search — and used to be told nothing at all, because the location was fine.
 *
 * Ordered as the operator experiences it, and each reason says who acts next:
 * silence, or a sentence that ends in something someone can do.
 */
export function patientListingBlockedReason(pharmacy: {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  hasActiveManager: boolean;
  latitude: number | null;
  longitude: number | null;
}): string | null {
  // Not approved yet: the review notice already says so, and repeating it as a
  // listing problem would read as a second, separate thing to fix.
  if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) return null;
  if (isPatientVisible(pharmacy)) return null;

  // The common case, and the only one the operator can clear themselves.
  const location = participationBlockedReason(pharmacy);
  if (location) return location;

  if (!pharmacy.isParticipating) {
    return (
      'Your licence is approved, but your pharmacy is currently not taking part ' +
      'in the ZoikoMeds network, so patient searches do not include it. Contact ' +
      'support to rejoin.'
    );
  }

  // Nobody is running it. Patients are only shown pharmacies with an operator
  // answering for the stock they report, and this one has none — which happens
  // when the last manager account is unlinked or deactivated.
  if (!pharmacy.hasActiveManager) {
    return (
      'Your licence is approved, but no active pharmacy account is linked to ' +
      'this branch, so patient searches do not include it. Your details and ' +
      'inventory are safe — ask the ZoikoMeds team to link a pharmacy manager ' +
      'account and the branch is listed again straight away.'
    );
  }

  // Approval says the pharmacy is real. It does not say anyone has taken
  // responsibility for what it reports, and patients are only shown pharmacies
  // where someone has.
  return (
    'Your licence is approved. Your pharmacy account is still being set up on ' +
    'the ZoikoMeds network, so patient searches do not include it yet. The ' +
    'ZoikoMeds team completes this step — there is nothing for you to do.'
  );
}

/**
 * Why a pharmacy is not shown to patients, written for a reviewer.
 *
 * The same rule as `patientListingBlockedReason` above, in the other voice.
 * That one addresses the operator — "your licence is approved", "there is
 * nothing for you to do" — and putting those sentences in the Super Admin
 * console would read as instructions to the reviewer, who is usually the person
 * who has to act.
 *
 * The console needs the whole rule and not just the location question. It used
 * to show "Listed to patients" from `isParticipating` alone, so a pharmacy that
 * was verified, participating and returned by no patient search — because its
 * classification was unclaimed, or because nobody is running it any more — was
 * displayed to the reviewer as listed. That is the exact contradiction this
 * audit was opened on: the console said networked, the portal said "you're all
 * set", and patients could not find the pharmacy.
 */
export function reviewerListingBlockedReason(pharmacy: {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  hasActiveManager: boolean;
  latitude: number | null;
  longitude: number | null;
}): string | null {
  // An unapproved pharmacy is not being held back from anything: the queue
  // already says where it stands, and a second notice reads as a second problem.
  if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) return null;
  if (isPatientVisible(pharmacy)) return null;

  // The location question, unchanged and still first — it is the one a reviewer
  // most often has to fix.
  const location = participationBlockedReason(pharmacy);
  if (location) return location;

  if (!pharmacy.isParticipating) {
    return (
      'Verified, but not listed to patients: this pharmacy is not currently ' +
      'taking part in the network.'
    );
  }

  if (!pharmacy.hasActiveManager) {
    return (
      'Verified, but not listed to patients: no active pharmacy account is ' +
      'linked to this record, so nobody is answering for the stock it reports. ' +
      'Its details and inventory are intact — linking a pharmacy account lists ' +
      'it again immediately.'
    );
  }

  return (
    'Verified, but not listed to patients: its commercial standing is ' +
    `${pharmacy.commercialClassification}, which is not one patients are shown.`
  );
}

/**
 * Where a pharmacy stands with patients, as one value.
 *
 * The portal has to choose between four banners, and the choice is not
 * `verificationStatus`: VERIFIED splits into visible and not-visible depending
 * on gates the operator cannot see, and the difference between those two is the
 * difference between "patients can find you" and "patients cannot". Deriving
 * that in React would mean a second copy of the rule maintained by whoever next
 * edits the page, and the failure mode is a page cheerfully telling an operator
 * they are live when no search returns them.
 *
 * So the answer is computed once, here, next to the rule it depends on, and the
 * portal renders it.
 */
export type PharmacyVisibilityState =
  | 'NOT_SUBMITTED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'VERIFIED_VISIBLE'
  | 'VERIFIED_NOT_VISIBLE';

export function pharmacyVisibilityState(pharmacy: {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  hasActiveManager: boolean;
}): PharmacyVisibilityState {
  switch (pharmacy.verificationStatus) {
    case VerificationStatus.VERIFIED:
      // The only branch where the other gates matter, and the only one where
      // being wrong tells the operator something untrue about patients.
      return isPatientVisible(pharmacy) ? 'VERIFIED_VISIBLE' : 'VERIFIED_NOT_VISIBLE';
    case VerificationStatus.REJECTED:
      return 'REJECTED';
    case VerificationStatus.SUSPENDED:
      return 'SUSPENDED';
    case VerificationStatus.PENDING:
    // A reviewer asking for more information is still a review in progress:
    // the pharmacy is in the queue, and nothing about it is visible.
    case VerificationStatus.INFO_REQUESTED:
      return 'PENDING_REVIEW';
    default:
      return 'NOT_SUBMITTED';
  }
}
