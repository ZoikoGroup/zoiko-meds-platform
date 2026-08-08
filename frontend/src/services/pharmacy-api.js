// Pharmacy Portal service layer.
//
// Inventory endpoints hit the real NestJS backend at /pharmacies/inventory.
// Other surfaces (dashboard, notifications, participation, etc.) still use
// demo data until their backend counterparts are implemented.

import { apiFetch } from '@/lib/api-client'
import {
  RECENT_UPDATES, PENDING_UPDATES, NOTIFICATIONS,
  PARTICIPATION, INTEGRATION, REPORTS, INVENTORY,
} from './pharmacy-data'

// Resolve a (deep-cloned) value after a short latency so skeletons are exercised.
const settle = (value, ms = 300) =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))

// Marker for "this account has no pharmacy linked yet". The API answers 403 with
// this wording from PharmacyService.resolvePharmacyId. It is a real state with a
// real remedy — finish the pharmacy profile — not a transport failure, so pages
// must not paper over it with demo stock that looks like the operator's own.
export class PharmacyNotLinkedError extends Error {
  constructor(message) {
    super(message || 'Your account is not linked to a pharmacy yet.')
    this.name = 'PharmacyNotLinkedError'
    this.notLinked = true
  }
}

const isNotLinked = (err) => /not linked to a pharmacy/i.test(err?.message || '')

// --- Inventory (REAL API) ---------------------------------------------------
export const getInventory = async () => {
  try {
    return await apiFetch('/pharmacies/inventory')
  } catch (err) {
    if (isNotLinked(err)) throw new PharmacyNotLinkedError(err.message)
    // Fallback to demo data if backend is unreachable or user is unauthenticated
    console.warn('[pharmacy-api] Inventory API failed, using demo data')
    return structuredClone(INVENTORY)
  }
}

export const addMedicine = (medicine) =>
  apiFetch('/pharmacies/inventory', {
    method: 'POST',
    body: medicine,
  })

export const updateAvailability = (id, status) =>
  apiFetch(`/pharmacies/inventory/${id}`, {
    method: 'PATCH',
    body: { status },
  })

export const deleteMedicine = (id) =>
  apiFetch(`/pharmacies/inventory/${id}`, {
    method: 'DELETE',
  })

export const importCsv = (rows, mode = 'merge') =>
  apiFetch('/pharmacies/inventory/import', {
    method: 'POST',
    body: { rows, mode },
  })

export const getDashboard = async () => {
  try {
    return await apiFetch('/pharmacies/dashboard')
  } catch (err) {
    if (isNotLinked(err)) throw new PharmacyNotLinkedError(err.message)
    console.warn('[pharmacy-api] Dashboard API failed, fallback to live inventory calculation')
    const inv = await getInventory()
    const available = inv.filter((m) => m.status === 'available').length
    const limited = inv.filter((m) => m.status === 'limited').length
    const outOfStock = inv.filter((m) => m.status === 'out-of-stock').length
    return {
      stats: {
        total: inv.length,
        available,
        limited,
        outOfStock,
        pending: outOfStock + limited,
      },
      recentUpdates: inv.slice(0, 5).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        when: r.updated || 'Just now',
        by: 'Staff update',
      })),
      pendingUpdates: inv.filter((r) => r.status !== 'available').slice(0, 5).map((r) => ({
        id: r.id,
        name: r.name,
        reason: r.status === 'out-of-stock' ? 'Marked out of stock — update if restocked' : 'Limited stock — confirm quantity band',
      })),
      notifications: NOTIFICATIONS.slice(0, 4),
    }
  }
}

import { listNotifications } from './admin-api'

export const getNotifications = async () => {
  let userNotifications = []
  try {
    const res = await apiFetch('/pharmacies/notifications')
    // Guard against a 200 with an empty body — spreading a null below throws.
    userNotifications = Array.isArray(res) ? res : []
  } catch {
    userNotifications = []
  }

  // Platform broadcasts. listNotifications() hits /admin/notifications, which is
  // SUPER_ADMIN-only — a pharmacy account gets 403 here every load, so this only
  // ever resolves for an admin browsing the pharmacy portal. Reaching real
  // broadcasts for pharmacy accounts needs a pharmacy-facing endpoint;
  // TODO(backend): GET /pharmacies/announcements.
  let announcements = []
  try {
    const raw = await listNotifications()
    announcements = (raw || [])
      .filter(
        (n) => n.target === 'ALL_USERS' || n.target === 'PHARMACY_MANAGERS' || !n.target
      )
      .map((n) => ({
        id: `broadcast-${n.id}`,
        type: n.type === 'MAINTENANCE' ? 'system' : n.type === 'EMERGENCY_ALERT' ? 'verification' : 'system',
        title: n.title,
        message: n.message,
        when: n.date ? new Date(n.date).toLocaleDateString() : 'Just now',
        unread: true,
      }))
  } catch {
    // Not reachable for pharmacy roles — leave broadcasts empty rather than
    // substituting samples.
  }

  // Demo NOTIFICATIONS used to be appended unconditionally, so a fully verified
  // pharmacy still saw fabricated alerts mixed in with its real ones — including
  // invented verification messages that contradicted its actual status.
  return [...userNotifications, ...announcements]
}
export const getParticipation = () => settle(PARTICIPATION)
export const getIntegration = () => settle(INTEGRATION)
// TODO(backend): POST /pharmacy/integration/sync
export const triggerSync = () => settle({ ...INTEGRATION, lastSync: 'just now' })

// Shape a raw Pharmacy row (GET /pharmacies/:id) like the /pharmacies/me
// payload, so the profile page renders identically from either source.
const toProfile = (row, email) => ({
  id: row.id,
  isDraft: false,
  name: row.name || '',
  licenseNumber: row.licenseNumber || '',
  verificationStatus: row.verificationStatus || 'UNVERIFIED',
  isParticipating: !!row.isParticipating,
  phone: row.phone || '',
  email: email || '',
  addressLine1: row.addressLine1 || '',
  addressLine2: row.addressLine2 || '',
  city: row.city || '',
  region: row.region || '',
  country: row.country || '',
  postalCode: row.postalCode || '',
  reliabilityScore: Math.round((row.reliabilityScore || 0) * 100),
  // Reviewer correspondence lives behind /pharmacies/me only.
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
})

const emptyDraft = (email) => ({
  id: null,
  isDraft: true,
  name: '',
  licenseNumber: '',
  verificationStatus: 'UNVERIFIED',
  isParticipating: false,
  phone: '',
  email: email || '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  country: '',
  postalCode: '',
  reliabilityScore: 0,
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
})

// Read the pharmacy's own record straight from Pharmacy Management using the
// account's pharmacy link. This is the compatibility path for a deployed API
// that predates /pharmacies/me: that build answers the aggregate route with an
// empty 200 (it falls through to GET /pharmacies/:id), but the underlying
// pharmacy row and /auth/me are both still available, so the operator's real
// details can be shown rather than an error. Retires itself the moment
// /pharmacies/me responds properly.
const getProfileViaPharmacyRecord = async () => {
  const me = await apiFetch('/auth/me')
  if (!me?.pharmacyId) return emptyDraft(me?.email)

  const row = await apiFetch(`/pharmacies/${me.pharmacyId}`)
  if (!row || typeof row !== 'object') return emptyDraft(me?.email)
  return toProfile(row, me.email)
}

// The pharmacy's own identity, licence and address. Deliberately has NO demo
// fallback: this is the operator's real record, and quietly substituting another
// pharmacy's sample details would read as their own saved data.
export const getProfile = async () => {
  const profile = await apiFetch('/pharmacies/me')
  if (profile && typeof profile === 'object') return profile

  // An empty 200 means the request never reached the profile handler. Fall back
  // to the pharmacy record itself. Note this is only reached for that specific
  // signature — a 401/403 still propagates, so a genuine authorization failure
  // is never masked by the fallback.
  console.warn('[pharmacy-api] /pharmacies/me returned no payload, reading the pharmacy record directly')
  return getProfileViaPharmacyRecord()
}

// Fields the pharmacy may edit — mirrors UpdatePharmacyProfileDto on the API.
// The global ValidationPipe runs with forbidNonWhitelisted, so posting the whole
// profile object back (id, verificationStatus, notes, …) is rejected with a 400.
const EDITABLE_FIELDS = [
  'name', 'licenseNumber', 'phone',
  'addressLine1', 'addressLine2', 'city', 'region', 'country', 'postalCode',
]

export const updateProfile = async (patch) => {
  const body = {}
  for (const key of EDITABLE_FIELDS) {
    if (patch?.[key] !== undefined && patch[key] !== null) body[key] = patch[key]
  }

  let res
  try {
    res = await apiFetch('/pharmacies/me', { method: 'PATCH', body })
  } catch (err) {
    // There is no read-only fallback for writing: an API build without
    // PATCH /pharmacies/me answers "Cannot PATCH /api/pharmacies/me". Say the
    // save did not happen rather than leaking the router message, and never
    // report success for a write that never landed.
    if (/cannot patch/i.test(err.message || '')) {
      console.warn('[pharmacy-api] PATCH /pharmacies/me is missing on this API build', err)
      throw new Error(
        'Saving is unavailable right now — your changes were not saved. Please try again later or contact ZoikoMeds support.',
      )
    }
    throw err
  }

  window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
  return res
}

export const getReports = async () => {
  try {
    const reports = await apiFetch('/pharmacies/reports')
    if (!reports || typeof reports !== 'object') {
      throw new Error('Reports endpoint returned an empty response')
    }
    return reports
  } catch (err) {
    console.warn('[pharmacy-api] Get reports API failed', err)
    return settle(REPORTS)
  }
}
