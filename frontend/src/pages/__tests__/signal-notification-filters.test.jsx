// @vitest-environment jsdom
//
// ZoikoSignal → Smart Notifications, the "Back in Stock" and "Safety Alerts"
// chips.
//
// The reported symptom was both chips reading 0. The mapping was never the
// fault — the backend emits `back-in-stock`, `recall` and `safety`, and the
// chips consume exactly those strings — so these tests hold the frontend
// contract that made the backend the only remaining suspect: the count and the
// list come from the same predicate over the same array, a recall and a safety
// broadcast both land under one chip, and 0 means 0.
//
// The generation-side defect that actually hid the back-in-stock notifications
// is covered in backend saved-medicine-alerts-gate.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({
    t: (_key, fallback, params) =>
      params
        ? String(fallback).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        : fallback,
  }),
}))

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSignalSavedStatus: () => ({ data: undefined }),
}))

const notificationsMock = vi.fn()

vi.mock('@/services/signal-api', () => ({
  // The real constant, not a copy: a test that redefined it could not catch a
  // mapping drift, which is the whole thing under examination here.
  SAFETY_TYPES: ['recall', 'safety'],
  // One saved medicine, because the page shows an empty state instead of the
  // notification section when the patient follows nothing — the chips only
  // exist for someone with something saved.
  listSavedStatus: () =>
    Promise.resolve([
      { id: 'med_1', name: 'Dolo 650', generic: 'Paracetamol', status: 'available', priority: 'medium' },
    ]),
  listActiveAlerts: () => Promise.resolve([]),
  listNotifications: () => Promise.resolve(notificationsMock()),
  getNotificationSettings: () => Promise.resolve({}),
  updateNotificationSettings: vi.fn(),
  markRead: vi.fn(async () => ({})),
  markAllRead: vi.fn(async () => ({})),
  dismissNotification: vi.fn(async () => ({})),
  archiveNotification: vi.fn(async () => ({})),
  setMedicinePriority: vi.fn(async () => ({})),
}))

const { default: UserSignal } = await import('../UserSignal')

let id = 0
const notif = (type, over = {}) => ({
  id: `n_${++id}`,
  type,
  title: `${type} title`,
  description: `${type} description`,
  medicineName: 'Dolo 650',
  actionLabel: 'Find pharmacy',
  actionKind: 'search',
  read: false,
  occurredAt: new Date().toISOString(),
  ...over,
})

/** The chip button for a filter label, with its count badge. */
const chip = (label) => screen.getByRole('button', { name: new RegExp(`^${label}`) })

/** The number in a chip's badge. */
const countOn = (label) => Number(chip(label).textContent.replace(/\D+/g, ''))

const renderSignal = async (notifications) => {
  notificationsMock.mockReturnValue(notifications)
  render(<UserSignal />)
  await waitFor(() => expect(chip('All')).toBeDefined())
}

beforeEach(() => {
  id = 0
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the counts describe the data that is there', () => {
  it('counts a real back-in-stock notification under Back in Stock', async () => {
    await renderSignal([notif('back-in-stock')])
    expect(countOn('Back in Stock')).toBe(1)
  })

  it('counts a recall under Safety Alerts', async () => {
    await renderSignal([notif('recall')])
    expect(countOn('Safety Alerts')).toBe(1)
  })

  it('counts a safety broadcast under Safety Alerts', async () => {
    await renderSignal([notif('safety')])
    expect(countOn('Safety Alerts')).toBe(1)
  })

  it('groups recall and safety into the one chip', async () => {
    // Two backend types, one operator-facing category.
    await renderSignal([notif('recall'), notif('safety')])
    expect(countOn('Safety Alerts')).toBe(2)
  })

  it('counts every chip off the same list', async () => {
    await renderSignal([
      notif('running-low'),
      notif('back-in-stock'),
      notif('recall'),
      notif('safety'),
      notif('nearby-restock', { read: true }),
    ])

    expect(countOn('All')).toBe(5)
    expect(countOn('Unread')).toBe(4)
    expect(countOn('Running Low')).toBe(1)
    expect(countOn('Back in Stock')).toBe(1)
    expect(countOn('Safety Alerts')).toBe(2)
  })

  it('reads 0 only when nothing matches', async () => {
    await renderSignal([notif('running-low')])
    expect(countOn('Back in Stock')).toBe(0)
    expect(countOn('Safety Alerts')).toBe(0)
  })

  it('never shows a count the list cannot produce', async () => {
    // No stale or hardcoded number: an empty feed is zero everywhere.
    await renderSignal([])
    for (const label of ['All', 'Unread', 'Running Low', 'Back in Stock', 'Safety Alerts']) {
      expect(countOn(label)).toBe(0)
    }
  })
})

describe('clicking a chip shows exactly those notifications', () => {
  const MIXED = () => [
    notif('running-low', { title: 'Dolo 650 is running low' }),
    notif('back-in-stock', { title: 'Dolo 650 is back in stock' }),
    notif('recall', { title: 'Batch recall notice' }),
    notif('safety', { title: 'Government safety advisory' }),
  ]

  it('Back in Stock shows the back-in-stock one and nothing else', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(MIXED())

    await user.click(chip('Back in Stock'))

    // waitFor because the list is wrapped in AnimatePresence: a filtered-out
    // row stays mounted until its exit animation finishes.
    await waitFor(() => {
      expect(screen.queryByText('Dolo 650 is running low')).toBeNull()
      expect(screen.queryByText('Batch recall notice')).toBeNull()
    })
    expect(screen.getByText('Dolo 650 is back in stock')).toBeDefined()
  })

  it('Safety Alerts shows both the recall and the advisory', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(MIXED())

    await user.click(chip('Safety Alerts'))

    await waitFor(() => expect(screen.queryByText('Dolo 650 is back in stock')).toBeNull())
    expect(screen.getByText('Batch recall notice')).toBeDefined()
    expect(screen.getByText('Government safety advisory')).toBeDefined()
  })

  it('shows as many rows as the chip counts', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(MIXED())

    await user.click(chip('Safety Alerts'))

    await waitFor(() => expect(screen.queryByText('Dolo 650 is running low')).toBeNull())
    expect(countOn('Safety Alerts')).toBe(2)
    expect(screen.getAllByText(/recall notice|safety advisory/)).toHaveLength(2)
  })
})

describe('read state still works under a filter', () => {
  it('an already-read back-in-stock still counts in its own chip', async () => {
    // Filtering is by type; only the Unread chip cares about read state.
    await renderSignal([notif('back-in-stock', { read: true })])

    expect(countOn('Back in Stock')).toBe(1)
    expect(countOn('Unread')).toBe(0)
  })

  it('a read safety alert still counts in Safety Alerts', async () => {
    await renderSignal([notif('safety', { read: true })])

    expect(countOn('Safety Alerts')).toBe(1)
    expect(countOn('Unread')).toBe(0)
  })
})
