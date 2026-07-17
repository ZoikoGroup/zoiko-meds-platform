// Pharmacy Portal service layer.
//
// Every call returns a Promise so pages get real loading/error lifecycles and
// each function can be swapped for a real fetch with NO page changes. Until the
// backend exposes pharmacy self-service endpoints, these resolve demo data
// from services/pharmacy-data.js.
//
// TODO(backend): add pharmacy-scoped endpoints, e.g.
//   GET    /pharmacy/me                 → profile + verification status
//   PATCH  /pharmacy/me                 → update profile / hours
//   GET    /pharmacy/inventory          → inventory rows
//   POST   /pharmacy/inventory          → add medicine
//   PATCH  /pharmacy/inventory/:id      → edit / update availability
//   DELETE /pharmacy/inventory/:id      → remove medicine
//   POST   /pharmacy/inventory/import   → CSV upload
//   GET    /pharmacy/overview           → dashboard stats
//   GET    /pharmacy/notifications      → notifications feed
//   GET    /pharmacy/participation      → reliability / participation metrics
//   GET    /pharmacy/integration        → sync status + history
//   POST   /pharmacy/integration/sync   → trigger a manual sync
//   GET    /pharmacy/reports            → analytics series
import {
  INVENTORY, RECENT_UPDATES, PENDING_UPDATES, NOTIFICATIONS,
  PARTICIPATION, INTEGRATION, PROFILE, REPORTS,
} from './pharmacy-data'

// Resolve a (deep-cloned) value after a short latency so skeletons are exercised.
const settle = (value, ms = 300) =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))

// --- Inventory -----------------------------------------------------------
export const getInventory = () => settle(INVENTORY)

export const getDashboard = () =>
  settle({
    stats: {
      total: INVENTORY.length,
      available: INVENTORY.filter((m) => m.status === 'available').length,
      limited: INVENTORY.filter((m) => m.status === 'limited').length,
      outOfStock: INVENTORY.filter((m) => m.status === 'out-of-stock').length,
      pending: PENDING_UPDATES.length,
    },
    recentUpdates: RECENT_UPDATES,
    pendingUpdates: PENDING_UPDATES,
    notifications: NOTIFICATIONS.slice(0, 4),
  })

// TODO(backend): PATCH /pharmacy/inventory/:id { status }
export const updateAvailability = (id, status) => settle({ ok: true, id, status })
// TODO(backend): POST /pharmacy/inventory
export const addMedicine = (medicine) => settle({ ok: true, medicine })
// TODO(backend): DELETE /pharmacy/inventory/:id
export const deleteMedicine = (id) => settle({ ok: true, id })
// TODO(backend): POST /pharmacy/inventory/import (multipart CSV)
export const importCsv = (rows) => settle({ imported: (rows || []).length, skipped: 0 })

// --- Other surfaces ------------------------------------------------------
export const getNotifications = () => settle(NOTIFICATIONS)
export const getParticipation = () => settle(PARTICIPATION)
export const getIntegration = () => settle(INTEGRATION)
// TODO(backend): POST /pharmacy/integration/sync
export const triggerSync = () => settle({ ...INTEGRATION, lastSync: 'just now' })
export const getProfile = () => settle(PROFILE)
// TODO(backend): PATCH /pharmacy/me
export const updateProfile = (patch) => settle({ ...PROFILE, ...patch })
export const getReports = () => settle(REPORTS)
