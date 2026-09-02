// Commercial service layer — ZM-COM-BILL-001.
//
// Talks to /admin/commercial. Deliberately has no demo fallback anywhere: these
// are financial surfaces, and a fabricated price, entitlement or usage figure is
// worse than an error message. Callers surface failures.

import { apiFetch } from '@/lib/api-client'

const qs = (params) => {
  if (!params) return ''
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (entries.length === 0) return ''
  return `?${new URLSearchParams(entries).toString()}`
}

// --- Price catalog (S-21) ---------------------------------------------------

export const listPrices = (params) => apiFetch(`/admin/commercial/prices${qs(params)}`)

export const createPrice = (body) =>
  apiFetch('/admin/commercial/prices', { method: 'POST', body })

/**
 * Resolve the exact amount that would be charged. Fails closed with a 404 when no
 * approved record matches — that is the intended behaviour, not an error to
 * paper over: a published range is never an executable price (S-E2, S-M2).
 */
export const resolvePrice = (params) =>
  apiFetch(`/admin/commercial/prices/resolve${qs(params)}`)

// --- Entitlements ----------------------------------------------------------

export const getEntitlements = (pharmacyId) =>
  apiFetch(`/admin/commercial/entitlements/${pharmacyId}`)

// --- Subscriptions ---------------------------------------------------------

export const startEvaluation = (body) =>
  apiFetch('/admin/commercial/subscriptions/evaluation', { method: 'POST', body })

export const activatePro = (body) =>
  apiFetch('/admin/commercial/subscriptions/pro', { method: 'POST', body })

export const addSubscriptionLocation = (subscriptionId, pharmacyId) =>
  apiFetch(`/admin/commercial/subscriptions/${subscriptionId}/locations/${pharmacyId}`, {
    method: 'POST',
  })

export const releaseSubscriptionLocation = (subscriptionId, pharmacyId) =>
  apiFetch(`/admin/commercial/subscriptions/${subscriptionId}/locations/${pharmacyId}/release`, {
    method: 'POST',
  })

// --- Usage (S-K3) ----------------------------------------------------------

export const getUsageSummary = (billingProfileId, params) =>
  apiFetch(`/admin/commercial/usage/${billingProfileId}${qs(params)}`)

// --- Capabilities (S-22) ---------------------------------------------------

export const getMyCapabilities = () => apiFetch('/admin/commercial/capabilities/me')

export const getUserCapabilities = (userId) =>
  apiFetch(`/admin/commercial/capabilities/${userId}`)

export const grantCapability = (body) =>
  apiFetch('/admin/commercial/capabilities/grant', { method: 'POST', body })

export const revokeCapability = (grantId, reason) =>
  apiFetch(`/admin/commercial/capabilities/${grantId}/revoke`, {
    method: 'POST',
    body: { reason },
  })

// --- Payment provider ------------------------------------------------------

export const getProviderStatus = () => apiFetch('/admin/commercial/provider')

// --- Billing profiles ------------------------------------------------------

export const listBillingProfiles = () => apiFetch('/admin/commercial/billing-profiles')

export const getBillingProfile = (id) => apiFetch(`/admin/commercial/billing-profiles/${id}`)

export const createBillingProfile = (body) =>
  apiFetch('/admin/commercial/billing-profiles', { method: 'POST', body })

// --- Tax (S-M3: never a hard-coded rate) -----------------------------------

export const recordTaxDetermination = (body) =>
  apiFetch('/admin/commercial/tax-determinations', { method: 'POST', body })

export const getLatestTax = (billingProfileId) =>
  apiFetch(`/admin/commercial/tax-determinations/${billingProfileId}`)

// --- Invoices & credit notes -----------------------------------------------

export const listInvoices = (billingProfileId) =>
  apiFetch(`/admin/commercial/invoices/${billingProfileId}`)

export const draftInvoice = (body) =>
  apiFetch('/admin/commercial/invoices', { method: 'POST', body })

export const issueCreditNote = (invoiceId, body) =>
  apiFetch(`/admin/commercial/invoices/${invoiceId}/credit-notes`, { method: 'POST', body })

export const refundPayment = (body) =>
  apiFetch('/admin/commercial/refunds', { method: 'POST', body })
