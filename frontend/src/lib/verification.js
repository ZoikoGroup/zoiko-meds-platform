// Shared vocabulary for the pharmacy verification flow, used by both sides of
// it: the Verification Center (the review queue) and Pharmacy Management (the
// resulting pharmacy records).
//
// Two distinct enums are in play and they are easy to confuse:
//   • VerificationRequestStatus — the review request's own state
//   • VerificationStatus        — the pharmacy record's compliance state
// The backend moves the second whenever the first is decided, so the UI should
// always show them as two views of one flow, never as unrelated fields.

// --- Verification request (review queue) ----------------------------------

export const REQUEST_STATUS_LABEL = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under Review',
  ESCALATED: 'Escalated',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REQUEST_INFO: 'Information Requested',
}

export const REQUEST_STATUS_VARIANT = {
  PENDING: 'secondary',
  UNDER_REVIEW: 'info',
  ESCALATED: 'destructive',
  APPROVED: 'success',
  REJECTED: 'destructive',
  REQUEST_INFO: 'warning',
}

/** Requests still awaiting a decision — the reviewer's working set. */
export const OPEN_REQUEST_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'ESCALATED',
  'REQUEST_INFO',
]

/** True while a request still needs a decision from a reviewer. */
export function isOpenRequest(status) {
  return OPEN_REQUEST_STATUSES.includes(status)
}

/** Queue tab that will actually show a request with this status. */
export function queueTabFor(status) {
  if (status === 'APPROVED') return 'APPROVED'
  if (status === 'REJECTED') return 'REJECTED'
  return 'PENDING'
}

// --- Pharmacy record (governance table) -----------------------------------

export const PHARMACY_STATUS_LABEL = {
  VERIFIED: 'Verified',
  INFO_REQUESTED: 'Information Requested',
  PENDING: 'Pending',
  SUSPENDED: 'Suspended',
  UNVERIFIED: 'Unverified',
  REJECTED: 'Rejected',
}

export const PHARMACY_STATUS_VARIANT = {
  VERIFIED: 'success',
  INFO_REQUESTED: 'warning',
  PENDING: 'secondary',
  SUSPENDED: 'destructive',
  UNVERIFIED: 'outline',
  REJECTED: 'destructive',
}

// --- Cross-page deep links ------------------------------------------------
// Each page consumes its param on arrival and strips it, so a later background
// refresh cannot re-trigger the jump.

/** Verification Center, focused on one request. */
export function verificationRequestPath(requestId) {
  return `/admin/verification?request=${encodeURIComponent(requestId)}`
}

/** Pharmacy Management, focused on one pharmacy record. */
export function pharmacyRecordPath(pharmacyId) {
  return `/admin/pharmacies?pharmacy=${encodeURIComponent(pharmacyId)}`
}

/**
 * Latest request per pharmacy, keyed by pharmacy id.
 *
 * The API returns requests newest-first, so the first one seen for a pharmacy
 * is the current one; older rows for the same pharmacy are history.
 */
export function indexRequestsByPharmacy(requests = []) {
  const map = new Map()
  for (const request of requests) {
    if (request.pharmacyId && !map.has(request.pharmacyId)) {
      map.set(request.pharmacyId, request)
    }
  }
  return map
}
