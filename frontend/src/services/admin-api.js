import { apiFetch, apiFetchBlob } from '@/lib/api-client'

// SUPER_ADMIN platform administration (backend: modules/admin).

function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v)
  })
  const str = search.toString()
  return str ? `?${str}` : ''
}

export const getOverview = () => apiFetch('/admin/overview')

// External services this deployment actually talks to, with the state the server
// reads from its own configuration. No fixture behind it: the page this feeds used
// to list enterprise systems the platform has never connected to (MSA-39).
export const listIntegrations = () => apiFetch('/admin/integrations')

// This workspace's own profile. The settings page used to render a fixture —
// "Meridian Health Network", "org-meridian", "North America (us-east)" — for
// every deployment, over a Save button with no handler (MSA-40).
export const getOrganization = () => apiFetch('/admin/organization')

export const updateOrganization = (body) =>
  apiFetch('/admin/organization', { method: 'PATCH', body })

// Authentication controls as they actually stand. Read-only by design: every one
// of them is decided by server configuration or by code, so there is nothing here
// for the console to toggle, and a stored flag that nothing enforces is worse
// than no flag at all (MSA-42).
export const getSecurityPosture = () => apiFetch('/admin/security')

// Set the controls this page can actually decide.
export const updateSecurityPolicy = (body) =>
  apiFetch('/admin/security', { method: 'PATCH', body })

// What help this deployment actually publishes. The API reference is mounted
// only outside production, so the console is told when there is nothing to open
// rather than offering a link to a 404 (MSA-43).
export const getHelpResources = () => apiFetch('/admin/help')

export const listUsers = (params) => apiFetch(`/admin/users${qs(params)}`)

export const createUser = (body) =>
  apiFetch('/admin/users', { method: 'POST', body })

export const updateUser = (id, body) =>
  apiFetch(`/admin/users/${id}`, { method: 'PATCH', body })

export const setUserRole = (id, role) =>
  apiFetch(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } })

export const resetPassword = (id, password) =>
  apiFetch(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password },
  })

export const setUserActive = (id, active) =>
  apiFetch(`/admin/users/${id}/${active ? 'activate' : 'deactivate'}`, {
    method: 'POST',
  })

export const deleteUser = (id) =>
  apiFetch(`/admin/users/${id}`, { method: 'DELETE' })

// Derived from the @Roles metadata the guards enforce, by walking the
// controllers — so the matrix cannot claim access a route refuses.
export const getRoleMatrix = () => apiFetch('/admin/roles')

/** Cross-entity quick search for the console search bar (MSA-31). */
export const globalSearch = (q) => apiFetch(`/admin/search${qs({ q })}`)

// --- ZoikoAvail API keys ---------------------------------------------------
//
// There is no "reveal": only the hash is stored, so a key exists in the open
// exactly once, in the response to createApiKey.
export const listApiKeys = () => apiFetch('/admin/api-keys')

export const createApiKey = (body) =>
  apiFetch('/admin/api-keys', { method: 'POST', body })

export const revokeApiKey = (id) =>
  apiFetch(`/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' })

// Real uptime/latency/throughput/endpoint-status off GatewayRequestLog — the
// ZoikoAvail console used to render fixed fixtures with nothing behind them
// (MSA-36).
export const getZoikoAvailTelemetry = () => apiFetch('/admin/zoikoavail/telemetry')

export const listAuditLogs = (params) =>
  apiFetch(`/admin/audit-logs${qs(params)}`)

// --- Pharmacies ----------------------------------------------------------
export const listPharmacies = (params) =>
  apiFetch(`/admin/pharmacies${qs(params)}`)

export const createPharmacy = (body) =>
  apiFetch('/admin/pharmacies', { method: 'POST', body })

export const updatePharmacy = (id, body) =>
  apiFetch(`/admin/pharmacies/${id}`, { method: 'PATCH', body })

/**
 * The licence document attached to a verification request.
 *
 * Streamed from the API behind the same SUPER_ADMIN guard as the rest of the
 * Verification Center — there is no public URL for a pharmacy's licence.
 */
export const getVerificationDocument = (requestId) =>
  apiFetchBlob(`/admin/verification-requests/${requestId}/document`)

export const verifyPharmacy = (id) =>
  apiFetch(`/admin/pharmacies/${id}/verify`, { method: 'POST' })

export const suspendPharmacy = (id) =>
  apiFetch(`/admin/pharmacies/${id}/suspend`, { method: 'POST' })

export const deletePharmacy = (id) =>
  apiFetch(`/admin/pharmacies/${id}`, { method: 'DELETE' })

export const bulkPharmacyStatus = (ids, status) =>
  apiFetch('/admin/pharmacies/bulk-status', {
    method: 'POST',
    body: { ids, status },
  })

// --- Verification requests ----------------------------------------------
export const listVerifications = () =>
  apiFetch('/admin/verification-requests')

export const updateVerification = (id, body) =>
  apiFetch(`/admin/verification-requests/${id}`, { method: 'PATCH', body })

// --- Notifications -------------------------------------------------------
export const listNotifications = () => apiFetch('/admin/notifications')

export const createNotification = (body) =>
  apiFetch('/admin/notifications', { method: 'POST', body })

export const deleteNotification = (id) =>
  apiFetch(`/admin/notifications/${id}`, { method: 'DELETE' })

// --- Reports -------------------------------------------------------------
export const listReports = () => apiFetch('/admin/reports')

export const createReport = (body) =>
  apiFetch('/admin/reports', { method: 'POST', body })

export const duplicateReport = (id) =>
  apiFetch(`/admin/reports/${id}/duplicate`, { method: 'POST' })

export const downloadReport = (id) => apiFetch(`/admin/reports/${id}/download`)

export const deleteReport = (id) =>
  apiFetch(`/admin/reports/${id}`, { method: 'DELETE' })
