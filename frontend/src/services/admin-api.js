import { apiFetch } from '@/lib/api-client'

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

export const listAuditLogs = (params) =>
  apiFetch(`/admin/audit-logs${qs(params)}`)

// --- Pharmacies ----------------------------------------------------------
export const listPharmacies = (params) =>
  apiFetch(`/admin/pharmacies${qs(params)}`)

export const createPharmacy = (body) =>
  apiFetch('/admin/pharmacies', { method: 'POST', body })

export const updatePharmacy = (id, body) =>
  apiFetch(`/admin/pharmacies/${id}`, { method: 'PATCH', body })

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
