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

/**
 * Save a medicine.
 *
 * Accepts a bare MediBase id, or `{ id, name }` for a medicine the catalog does
 * not hold yet — those are stored by name and linked to a governed identity the
 * first time a verified pharmacy stocks them.
 */
export const saveMedicine = (medicine) => {
  const body =
    typeof medicine === 'string'
      ? { medicineId: medicine }
      : { medicineId: medicine?.id ?? undefined, name: medicine?.name }
  return apiFetch('/me/saved', { method: 'POST', body })
}

export const updateSavedMedicineAlerts = (medicineId, alertsEnabled) =>
  apiFetch(`/me/saved/${encodeURIComponent(medicineId)}/alerts`, {
    method: 'PATCH',
    body: { alertsEnabled },
  })

/** `key` is a MediBase id, or the medicine name for an off-catalog save. */
export const unsaveMedicine = (key) =>
  apiFetch(`/me/saved/${encodeURIComponent(key)}`, { method: 'DELETE' })

// --- Alert preferences ---------------------------------------------------
export const getAlertPreferences = () => apiFetch('/me/alerts')

export const updateAlertPreferences = (body) =>
  apiFetch('/me/alerts', { method: 'PATCH', body })
