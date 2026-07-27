import { listNotifications as listAdminNotifications } from './admin-api'
import { listNotifications as listSignalNotifications, markRead as markSignalRead, markAllRead as markAllSignalRead } from './signal-api'

const READ_BROADCASTS_KEY = 'zoiko_patient_read_broadcasts'

function getReadBroadcastIds() {
  try {
    const raw = localStorage.getItem(READ_BROADCASTS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function saveReadBroadcastId(id) {
  try {
    const set = getReadBroadcastIds()
    set.add(id)
    localStorage.setItem(READ_BROADCASTS_KEY, JSON.stringify([...set]))
  } catch {
    // Ignore localStorage errors
  }
}

function saveAllReadBroadcastIds(ids) {
  try {
    const set = getReadBroadcastIds()
    ids.forEach((id) => set.add(id))
    localStorage.setItem(READ_BROADCASTS_KEY, JSON.stringify([...set]))
  } catch {
    // Ignore localStorage errors
  }
}

export const getPatientNotifications = async () => {
  const readBroadcasts = getReadBroadcastIds()
  let broadcasts = []
  let signals = []

  // 1. Fetch Super Admin Dispatched Broadcasts from the exact same endpoint as Pharmacy Portal
  try {
    const rawAdmin = await listAdminNotifications()
    broadcasts = (rawAdmin || [])
      .filter((n) => {
        if (n.status === 'DRAFT') return false
        const target = (n.target || 'ALL_USERS').toUpperCase().replace(/\s+/g, '_')
        return (
          target === 'ALL_USERS' ||
          target === 'PATIENTS' ||
          target === 'PATIENT_PORTAL' ||
          target === 'REGISTERED_PATIENTS'
        )
      })
      .map((n) => {
        let type = 'announcement'
        if (n.type === 'EMERGENCY_ALERT') type = 'safety'
        else if (n.type === 'MAINTENANCE') type = 'system'
        else if (n.type === 'PLATFORM_UPDATE') type = 'announcement'

        const isRead = readBroadcasts.has(`broadcast-${n.id}`)
        const timestamp = n.date ? new Date(n.date).getTime() : Date.now()

        return {
          id: `broadcast-${n.id}`,
          rawId: n.id,
          isBroadcast: true,
          type,
          title: n.title,
          message: n.message,
          when: n.date ? new Date(n.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Just now',
          rawDate: timestamp,
          unread: !isRead,
          action: { label: 'Read Announcement', kind: 'announcement' },
        }
      })
  } catch {
    // Fail gracefully
  }

  // Set of titles from admin broadcasts to prevent duplicates
  const broadcastTitles = new Set(broadcasts.map((b) => b.title.trim().toLowerCase()))

  // 2. Fetch Patient Signal Notifications (Back-in-stock, low-stock, safety alerts)
  try {
    const rawSignals = await listSignalNotifications()
    signals = (rawSignals || [])
      .filter((n) => {
        // Skip signal if it duplicates an admin broadcast
        if (n.title && broadcastTitles.has(n.title.trim().toLowerCase())) {
          return false
        }
        return true
      })
      .map((n) => {
        let category = 'stock'
        if (n.type === 'recall' || n.type === 'safety') category = 'safety'
        else if (
          n.type === 'back-in-stock' ||
          n.type === 'running-low' ||
          n.type === 'nearby-restock' ||
          n.type === 'limited'
        )
          category = 'stock'
        else category = 'system'

        return {
          id: n.id,
          isBroadcast: false,
          type: category,
          subType: n.type,
          medicine: n.medicine,
          title: n.title,
          message: n.description,
          when: n.time || 'Recently',
          rawDate: Date.now() - 1000,
          unread: !n.read,
          action: n.action,
        }
      })
  } catch {
    // Fail gracefully
  }

  // Merge and sort newest first by rawDate
  const combined = [...broadcasts, ...signals]
  return combined.sort((a, b) => b.rawDate - a.rawDate)
}

export const markPatientNotificationRead = async (item) => {
  if (!item) return
  if (item.isBroadcast) {
    saveReadBroadcastId(item.id)
  } else {
    try {
      await markSignalRead(item.id)
    } catch {
      // Ignore API errors
    }
  }
}

export const markAllPatientNotificationsRead = async (items = []) => {
  const broadcastIds = items.filter((n) => n.isBroadcast).map((n) => n.id)
  saveAllReadBroadcastIds(broadcastIds)

  try {
    await markAllSignalRead()
  } catch {
    // Ignore API errors
  }
}
