// Enterprise inquiry intake — the pathway behind "Request Security &
// Procurement Review" and the enterprise briefing CTAs.
//
// POST /enterprise/inquiries is deliberately unauthenticated on the API: the
// same form serves prospects who have no account. apiFetch still attaches a
// bearer token when one is present, which is harmless and means a request sent
// from inside the console carries the sender's session.

import { apiFetch } from '@/lib/api-client'

/**
 * Inquiry types the API accepts (InquiryType on the backend). SECURITY_REVIEW
 * is routed server-side to the security-procurement queue — the client does not
 * choose the queue, only says what it is asking for.
 */
export const INQUIRY_TYPE = {
  MEDIBASE_BRIEFING: 'MEDIBASE_BRIEFING',
  API_ACCESS: 'API_ACCESS',
  DATA_LICENSING: 'DATA_LICENSING',
  SECURITY_REVIEW: 'SECURITY_REVIEW',
  IMPLEMENTATION_WORKSHOP: 'IMPLEMENTATION_WORKSHOP',
  GENERAL: 'GENERAL',
}

/**
 * File an enterprise inquiry.
 *
 * Governance: this form must never carry patient identifiers, prescription
 * detail, exact stock or API secrets — the DTO says so on the API side, and the
 * fields collected by the caller are what keeps it true here.
 */
export const submitEnterpriseInquiry = (inquiry) =>
  apiFetch('/enterprise/inquiries', { method: 'POST', body: inquiry })
