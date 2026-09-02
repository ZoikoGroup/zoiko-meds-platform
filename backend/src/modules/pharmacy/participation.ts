import { VerificationStatus } from '@prisma/client';

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
