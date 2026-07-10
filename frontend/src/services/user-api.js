import { apiFetch } from '@/lib/api-client'

// Patient portal endpoints (backend: modules/me). All require a JWT and are
// scoped to the authenticated user. Availability is a governed confidence band.

function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v)
  })
  const str = search.toString()
  return str ? `?${str}` : ''
}

// --- Search & pharmacies -------------------------------------------------
export const searchMedicines = (params) => apiFetch(`/me/search${qs(params)}`)

export const listNearbyPharmacies = (maxDistance) =>
  apiFetch(`/me/pharmacies${qs({ maxDistance })}`)

// --- Dashboard -----------------------------------------------------------
export const getUserOverview = () => apiFetch('/me/overview')

// --- Saved medicines -----------------------------------------------------
export const listSaved = () => apiFetch('/me/saved')

export const saveMedicine = (medicineId) =>
  apiFetch('/me/saved', { method: 'POST', body: { medicineId } })

export const unsaveMedicine = (medicineId) =>
  apiFetch(`/me/saved/${medicineId}`, { method: 'DELETE' })

// --- Alert preferences ---------------------------------------------------
export const getAlertPreferences = () => apiFetch('/me/alerts')

export const updateAlertPreferences = (body) =>
  apiFetch('/me/alerts', { method: 'PATCH', body })
