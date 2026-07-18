// ZoikoSignal™ — patient medicine-availability notification service.
//
// Backed by the real API (backend: modules/me/signal). Notifications are
// generated server-side from the patient's saved-medicine availability signals
// and dispatched platform broadcasts; read / dismissed / archived state and
// notification settings persist per-user. The exported shapes match what the
// ZoikoSignal page, home widget and cards render.

import { apiFetch } from '@/lib/api-client'

// Which notification types count as "safety" for the filter tab.
export const SAFETY_TYPES = ['recall', 'safety']

// ---------------------------------------------------------------------------
// Read APIs
// ---------------------------------------------------------------------------
export function listSavedStatus() {
  return apiFetch('/me/signal/saved-status')
}

export function listNotifications() {
  return apiFetch('/me/signal/notifications')
}

// Prominent, actionable alerts shown as cards at the top of the page.
export function listActiveAlerts() {
  return apiFetch('/me/signal/alerts')
}

export function getSignalSummary() {
  return apiFetch('/me/signal/summary')
}

// Lightweight, fast summary for the sidebar unread badge + home widget.
export function getSignalDigest() {
  return apiFetch('/me/signal/digest')
}

export function getNotificationSettings() {
  return apiFetch('/me/signal/settings')
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function updateNotificationSettings(patch) {
  return apiFetch('/me/signal/settings', { method: 'PATCH', body: patch })
}

export function markRead(id) {
  return apiFetch(`/me/signal/notifications/${id}/read`, { method: 'POST' })
}

export function markAllRead() {
  return apiFetch('/me/signal/notifications/read-all', { method: 'POST' })
}

export function dismissNotification(id) {
  return apiFetch(`/me/signal/notifications/${id}/dismiss`, { method: 'POST' })
}

export function archiveNotification(id) {
  return apiFetch(`/me/signal/notifications/${id}/archive`, { method: 'POST' })
}

export function setMedicinePriority(id, priority) {
  return apiFetch(`/me/signal/saved/${id}/priority`, {
    method: 'POST',
    body: { priority: String(priority).toUpperCase() },
  })
}
