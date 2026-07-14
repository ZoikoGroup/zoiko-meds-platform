// ZoikoSignal™ — patient medicine-availability notification service.
//
// There is no backend endpoint for personalized signal data yet, so this
// module is a self-contained mock that mirrors the async shape of
// services/user-api.js (every call returns a Promise) — a real API can be
// dropped in later without touching the UI. Mutable state (read / dismissed /
// archived notifications, settings, medicine priority) persists to
// localStorage so the experience survives reloads.

const LS = {
  settings: 'zoiko-signal-settings',
  read: 'zoiko-signal-read',
  dismissed: 'zoiko-signal-dismissed',
  archived: 'zoiko-signal-archived',
  priority: 'zoiko-signal-priority',
}

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore storage errors */
  }
}

// Simulated network latency so loading skeletons are exercised.
const settle = (value, ms = 260) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// ---------------------------------------------------------------------------
// Base fixtures (a real API would return these scoped to the patient).
// status ∈ available | limited | running-low | out-of-stock
// ---------------------------------------------------------------------------
const SAVED_MEDICINES = [
  {
    id: 'dolo650',
    name: 'Dolo 650',
    generic: 'Paracetamol',
    strength: '650 mg',
    status: 'running-low',
    priority: 'high',
    updated: '8 minutes ago',
    nearest: { name: 'Apollo Pharmacy', distance: 1.2, open: true, is24x7: true },
    estDuration: '2–3 days',
    alternatives: ['Calpol 650', 'Paracip 650'],
  },
  {
    id: 'metformin500',
    name: 'Metformin 500',
    generic: 'Metformin',
    strength: '500 mg',
    status: 'available',
    priority: 'medium',
    updated: 'just now',
    nearest: { name: 'MedPlus', distance: 0.8, open: true, is24x7: false },
    estDuration: '2+ weeks',
    alternatives: [],
  },
  {
    id: 'thyronorm75',
    name: 'Thyronorm 75',
    generic: 'Thyroxine',
    strength: '75 mcg',
    status: 'limited',
    priority: 'high',
    updated: '22 minutes ago',
    nearest: { name: 'Wellness Forever', distance: 2.1, open: true, is24x7: false },
    estDuration: '4–5 days',
    alternatives: ['Eltroxin 75', 'Thyrox 75'],
  },
  {
    id: 'augmentin625',
    name: 'Augmentin 625',
    generic: 'Amoxicillin + Clavulanate',
    strength: '625 mg',
    status: 'out-of-stock',
    priority: 'medium',
    updated: '1 hour ago',
    nearest: null,
    estDuration: null,
    alternatives: ['Clavam 625', 'Moxikind-CV 625'],
  },
  {
    id: 'pan40',
    name: 'Pantoprazole 40',
    generic: 'Pantoprazole',
    strength: '40 mg',
    status: 'available',
    priority: 'low',
    updated: '35 minutes ago',
    nearest: { name: 'Netmeds Store', distance: 1.6, open: false, is24x7: false },
    estDuration: '2+ weeks',
    alternatives: [],
  },
]

// type ∈ running-low | back-in-stock | limited | nearby-restock | recall | safety
const NOTIFICATIONS = [
  {
    id: 'n1',
    type: 'running-low',
    medicine: 'Dolo 650',
    title: 'Dolo 650 is running low',
    description:
      'Availability is decreasing near your location. Purchase soon before nearby pharmacies run out.',
    time: '8 minutes ago',
    action: { label: 'Find Pharmacy', kind: 'find', query: 'Dolo 650' },
  },
  {
    id: 'n2',
    type: 'back-in-stock',
    medicine: 'Metformin 500',
    title: 'Metformin 500 is back in stock',
    description: 'This medicine is available again at nearby pharmacies.',
    time: 'Just now',
    action: { label: 'View Pharmacies', kind: 'view', query: 'Metformin 500' },
  },
  {
    id: 'n3',
    type: 'limited',
    medicine: 'Thyronorm 75',
    title: 'Thyronorm 75 has limited availability',
    description: 'Only a few pharmacies currently have this medicine.',
    time: '22 minutes ago',
    action: { label: 'Locate Pharmacy', kind: 'locate', query: 'Thyronorm 75' },
  },
  {
    id: 'n4',
    type: 'nearby-restock',
    medicine: 'Augmentin 625',
    title: 'A nearby pharmacy restocked Augmentin 625',
    description:
      'Apollo Pharmacy (1.2 km) just refreshed its availability signal for this medicine.',
    time: '2 hours ago',
    action: { label: 'View Pharmacies', kind: 'view', query: 'Augmentin 625' },
  },
  {
    id: 'n5',
    type: 'recall',
    medicine: 'Batch #A2231',
    title: 'Recall notice for a related batch',
    description:
      'A manufacturer recall affects certain batches. Please check the batch number on your packaging.',
    time: 'Yesterday',
    action: { label: 'Read advisory', kind: 'read' },
  },
  {
    id: 'n6',
    type: 'safety',
    medicine: 'Thyroid medicines',
    title: 'Government safety advisory',
    description:
      'A national health advisory has been issued for a medicine class you follow. Review the guidance.',
    time: 'Yesterday',
    action: { label: 'Read advisory', kind: 'read' },
  },
]

const DEFAULT_SETTINGS = {
  runningLow: true,
  backInStock: true,
  nearbyRestock: true,
  recall: true,
  safety: true,
  push: true,
  email: false,
  sms: false,
}

// Which notification types count as "safety" for the filter tab.
export const SAFETY_TYPES = ['recall', 'safety']

// ---------------------------------------------------------------------------
// Decorate fixtures with persisted client state.
// ---------------------------------------------------------------------------
function decorateNotifications() {
  const read = readLS(LS.read, [])
  const dismissed = readLS(LS.dismissed, [])
  const archived = readLS(LS.archived, [])
  return NOTIFICATIONS.filter((n) => !dismissed.includes(n.id)).map((n) => ({
    ...n,
    read: read.includes(n.id),
    archived: archived.includes(n.id),
  }))
}

function decorateSaved() {
  const priority = readLS(LS.priority, {})
  return SAVED_MEDICINES.map((m) => ({
    ...m,
    priority: priority[m.id] ?? m.priority,
  }))
}

// ---------------------------------------------------------------------------
// Read APIs
// ---------------------------------------------------------------------------
export function listSavedStatus() {
  return settle(decorateSaved())
}

export function listNotifications() {
  return settle(decorateNotifications().filter((n) => !n.archived))
}

// Prominent, actionable alerts shown as cards at the top of the page.
export function listActiveAlerts() {
  const actionable = ['running-low', 'back-in-stock', 'limited']
  return settle(
    decorateNotifications().filter(
      (n) => !n.archived && actionable.includes(n.type),
    ),
  )
}

export function getSignalSummary() {
  const saved = decorateSaved()
  const notifs = decorateNotifications().filter((n) => !n.archived)
  return settle({
    savedMedicines: saved.length,
    activeAlerts: notifs.filter((n) =>
      ['running-low', 'back-in-stock', 'limited'].includes(n.type),
    ).length,
    runningLow: saved.filter((m) =>
      ['running-low', 'out-of-stock'].includes(m.status),
    ).length,
    backInStockToday: notifs.filter((n) => n.type === 'back-in-stock').length,
    unread: notifs.filter((n) => !n.read).length,
  })
}

// Lightweight, fast summary for the sidebar unread badge + home widget.
export function getSignalDigest() {
  const notifs = decorateNotifications().filter((n) => !n.archived)
  return settle(
    {
      unread: notifs.filter((n) => !n.read).length,
      alerts: notifs
        .filter((n) => ['running-low', 'back-in-stock', 'limited'].includes(n.type))
        .slice(0, 3),
    },
    120,
  )
}

export function getNotificationSettings() {
  return settle({ ...DEFAULT_SETTINGS, ...readLS(LS.settings, {}) })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function updateNotificationSettings(patch) {
  const next = { ...DEFAULT_SETTINGS, ...readLS(LS.settings, {}), ...patch }
  writeLS(LS.settings, next)
  return settle(next, 120)
}

export function markRead(id) {
  const read = readLS(LS.read, [])
  if (!read.includes(id)) writeLS(LS.read, [...read, id])
  return settle(true, 80)
}

export function markAllRead() {
  writeLS(LS.read, NOTIFICATIONS.map((n) => n.id))
  return settle(true, 80)
}

export function dismissNotification(id) {
  const dismissed = readLS(LS.dismissed, [])
  if (!dismissed.includes(id)) writeLS(LS.dismissed, [...dismissed, id])
  return settle(true, 80)
}

export function archiveNotification(id) {
  const archived = readLS(LS.archived, [])
  if (!archived.includes(id)) writeLS(LS.archived, [...archived, id])
  return settle(true, 80)
}

export function setMedicinePriority(id, priority) {
  const map = readLS(LS.priority, {})
  writeLS(LS.priority, { ...map, [id]: priority })
  return settle(true, 80)
}
