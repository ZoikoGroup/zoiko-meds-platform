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

// --- Inventory (REAL API) ---------------------------------------------------
export const getInventory = async () => {
  try {
    return await apiFetch('/pharmacies/inventory')
  } catch {
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
  } catch {
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
    // fallback gracefully
  }
  return [...userNotifications, ...announcements, ...NOTIFICATIONS]
}
export const getParticipation = () => settle(PARTICIPATION)
export const getIntegration = () => settle(INTEGRATION)
// TODO(backend): POST /pharmacy/integration/sync
export const triggerSync = () => settle({ ...INTEGRATION, lastSync: 'just now' })

// The pharmacy's own identity, licence and address. Deliberately has NO demo
// fallback: this is the operator's real record, and quietly substituting another
// pharmacy's sample details would read as their own saved data. Callers surface
// the failure instead.
export const getProfile = async () => {
  const profile = await apiFetch('/pharmacies/me')
  // A 200 with an empty body means the request never reached the profile
  // handler — e.g. an older backend where GET /pharmacies/:id shadows
  // GET /pharmacies/me and resolves to a null pharmacy.
  if (!profile || typeof profile !== 'object') {
    throw new Error('The profile service is unavailable. Please try again shortly.')
  }
  return profile
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

  const res = await apiFetch('/pharmacies/me', { method: 'PATCH', body })
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
