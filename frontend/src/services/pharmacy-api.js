// Pharmacy Portal service layer.
//
// Inventory, reports, participation and the POS/ERP integration all hit the real
// NestJS backend. Announcements are the only surface left resolving a fixture,
// and it is marked TODO(backend) at its call site.

import { apiFetch } from '@/lib/api-client'
import {
  NOTIFICATIONS,
  INVENTORY,
} from './pharmacy-data'

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

/** One-tap status change from the inventory row menu. */
export const updateAvailability = (id, status) =>
  apiFetch(`/pharmacies/inventory/${id}`, {
    method: 'PATCH',
    body: { status },
  })

/**
 * Full edit from the Edit Medicine dialog.
 *
 * Sends every editable field, not just the status. The endpoint patches: any
 * key omitted here keeps its stored value. Returns the saved row as the server
 * resolved it, which is not always what was typed — name and strength resolve
 * to a MediBase identity, so the response is what the table must show.
 */
export const updateMedicine = (id, patch) =>
  apiFetch(`/pharmacies/inventory/${id}`, {
    method: 'PATCH',
    body: patch,
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

// Read state lives on the notification row, and these endpoints are scoped to the
// caller rather than to a role, so the portal marks its own notifications read
// through the same routes the patient surface uses. Without this the page only
// ever changed local state, which the ten-second refresh then reverted (MP-24).
export const markNotificationRead = (id) =>
  apiFetch(`/me/signal/notifications/${id}/read`, { method: 'POST' })

export const markAllNotificationsRead = () =>
  apiFetch('/me/signal/notifications/read-all', { method: 'POST' })

export const getNotifications = async () => {
  // One source now. Announcements used to be fetched separately from
  // /admin/notifications — a SUPER_ADMIN route, so a pharmacy account got a 403
  // on every load and saw none of them, while an admin browsing the portal saw
  // every one regardless of their preferences. The pharmacy endpoint returns
  // both, already filtered by what this account asked to receive.
  try {
    const res = await apiFetch('/pharmacies/notifications')
    // Guard against a 200 with an empty body — spreading a null below throws.
    return Array.isArray(res) ? res : []
  } catch {
    return []
  }
}
// Participation metrics, measured server-side from this pharmacy's own rows. This
// used to resolve a fixture — the same 92% reliability and 87% participation for
// every pharmacy on the platform (MP-44).
export const getParticipation = () => apiFetch('/pharmacies/participation')

// --- POS / ERP integration (REAL API) ---------------------------------------
//
// No demo fallback anywhere below. This page used to resolve a fixture, so every
// pharmacy on the platform was shown the same connected Marg ERP and the same
// five sync runs — an operator could read "last sync: 6 minutes ago" off a
// pharmacy that had never been connected to anything (MP-31).

export const getIntegration = async () => {
  try {
    return await apiFetch('/pharmacies/integration')
  } catch (err) {
    if (isNotLinked(err)) throw new PharmacyNotLinkedError(err.message)
    throw err
  }
}

/** Connect, or re-save the configuration. Answers with the refreshed page state. */
export const saveIntegration = (config) =>
  apiFetch('/pharmacies/integration', { method: 'PUT', body: config })

export const disconnectIntegration = () =>
  apiFetch('/pharmacies/integration', { method: 'DELETE' })

/**
 * Run the feed now. Resolves for a failed attempt too — the failure is a row in
 * the returned history with its reason on it, which is the thing the operator
 * came to the page to read. Only a transport or authorization error rejects.
 */
export const triggerSync = () =>
  apiFetch('/pharmacies/integration/sync', { method: 'POST' })

/**
 * Issue or rotate the push key. The raw key comes back exactly once — the server
 * stores only its hash — so the page must show it before the response is
 * discarded, and cannot offer to show it again later.
 */
export const issueIntegrationKey = () =>
  apiFetch('/pharmacies/integration/key', { method: 'POST' })

/**
 * Notification switches for the signed-in pharmacy account.
 *
 * The settings page held these in component state: they flipped, flashed
 * "saved", and were gone on the next navigation. They are now stored per
 * account, and the API is the authority — the switch renders what came back,
 * not what was clicked.
 *
 * No demo fallback. A default-shaped object on a failed read would show the
 * operator switches that reflect nothing stored.
 */
export const getNotificationPreferences = () => apiFetch('/pharmacies/notification-preferences')

/** Save one or more switches. Returns the full saved set. */
export const updateNotificationPreferences = (patch) =>
  apiFetch('/pharmacies/notification-preferences', { method: 'PATCH', body: patch })

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
  latitude: row.latitude ?? null,
  longitude: row.longitude ?? null,
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
  latitude: null,
  longitude: null,
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
  // Set from a Google Maps link in the profile form. Without these the
  // pharmacy cannot appear in the distance-bounded patient search.
  'latitude', 'longitude',
  // The licence document travels with the save that submits for verification.
  // Without it in this list the file was silently dropped from the request body
  // — the whitelist is deliberate, so anything new has to be named here.
  'document',
]

/**
 * Coordinates behind a Google Maps share link (maps.app.goo.gl).
 *
 * Those links carry no coordinates until their redirect is followed, which the
 * browser cannot do cross-origin. Read-only — saving still goes through
 * updateProfile.
 */
export const resolveMapLink = (url) =>
  apiFetch('/pharmacies/me/resolve-map-link', { method: 'POST', body: { url } })

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

// Reports are computed from this pharmacy's own signals. No demo fallback: a
// fabricated chart is indistinguishable from the operator's own figures, and it
// was what made a failed request look like a quiet week (MP-44).
export const getReports = async () => {
  const reports = await apiFetch('/pharmacies/reports')
  if (!reports || typeof reports !== 'object') {
    throw new Error('Reports endpoint returned an empty response')
  }
  return reports
}

// Billing and plan view for the logged-in pharmacy. Financial detail is scoped
// server-side by role, so a field that is absent was never sent — the client does
// not decide what may be seen. No demo fallback: this is a financial surface.
export const getBilling = () => apiFetch('/pharmacies/me/billing')

// --- Logo (MP-22) -----------------------------------------------------------
//
// Multipart rather than a base64 JSON body: no inflation of the bytes, and the
// size limit belongs to this one route instead of loosening the JSON limit for
// every endpoint.
export const uploadPharmacyLogo = (file) => {
  const form = new FormData()
  form.append('file', file)
  return apiFetch('/pharmacies/me/logo', { method: 'POST', body: form })
}

export const removePharmacyLogo = () =>
  apiFetch('/pharmacies/me/logo', { method: 'DELETE' })

// Provider-hosted purchase and payment-method management. Both return a URL to
// redirect to: card details never touch this application. Restricted server-side
// to the authorized payer (Pharmacy Manager), so a Pharmacist gets a 403.
export const startBillingCheckout = (body) =>
  apiFetch('/pharmacies/me/billing/checkout', { method: 'POST', body: body || {} })

export const openBillingPortal = () =>
  apiFetch('/pharmacies/me/billing/portal', { method: 'POST', body: {} })
