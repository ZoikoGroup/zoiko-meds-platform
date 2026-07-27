// Pharmacy Portal service layer.
//
// Inventory endpoints hit the real NestJS backend at /pharmacies/inventory.
// Other surfaces (dashboard, notifications, participation, etc.) still use
// demo data until their backend counterparts are implemented.

import { apiFetch } from '@/lib/api-client'
import {
  RECENT_UPDATES, PENDING_UPDATES, NOTIFICATIONS,
  PARTICIPATION, INTEGRATION, PROFILE, REPORTS, INVENTORY,
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
  return [...announcements, ...NOTIFICATIONS]
}
export const getParticipation = () => settle(PARTICIPATION)
export const getIntegration = () => settle(INTEGRATION)
// TODO(backend): POST /pharmacy/integration/sync
export const triggerSync = () => settle({ ...INTEGRATION, lastSync: 'just now' })
export const getProfile = () => settle(PROFILE)
// TODO(backend): PATCH /pharmacy/me
export const updateProfile = (patch) => settle({ ...PROFILE, ...patch })
export const getReports = () => settle(REPORTS)
