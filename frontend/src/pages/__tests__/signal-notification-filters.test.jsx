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
//
// The list is a server page now — ten cards, with Previous / Next under them —
// so the chips and the rows no longer come from one array in React. That makes
// the contract above worth more, not less: a chip's count describes every
// notification the account has, the rows below it describe ten of them, and the
// only way to keep those two honest is for both to come from the same request.
// `listNotifications` below is therefore a small fake of the endpoint rather
// than a canned array, paging and counting the way the service does.

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

/** Every call to the endpoint, so an extra fetch is visible as one. */
const listCalls = vi.fn()

/** Recall and safety share the one chip, as they do on the server. */
const SAFETY = ['recall', 'safety']

const FILTER_MATCH = {
  all: () => true,
  unread: (n) => !n.read,
  'running-low': (n) => n.type === 'running-low',
  'back-in-stock': (n) => n.type === 'back-in-stock',
  safety: (n) => SAFETY.includes(n.type),
}

/**
 * GET /me/signal/notifications, as it now answers.
 *
 * A page of rows plus counts over the whole set — and, given no query at all,
 * the bare array the nav badge still reads. Faked to that shape rather than to
 * a fixed list because the page's correctness now depends on the difference
 * between the two: what it renders is a slice, and what it labels the chips
 * with is not.
 */
const pageOf = (all, { page = 1, pageSize = 10, filter = 'all' } = {}) => {
  const matching = all.filter(FILTER_MATCH[filter])
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  return {
    items: matching.slice((current - 1) * pageSize, current * pageSize),
    filter,
    page: current,
    pageSize,
    pageCount,
    total: matching.length,
    counts: Object.fromEntries(
      Object.entries(FILTER_MATCH).map(([key, match]) => [key, all.filter(match).length]),
    ),
  }
}

/** Mutate the feed the fake reads, the way the endpoint's writes would. */
const dropFromFeed = (id) => {
  const feed = notificationsMock()
  const at = feed.findIndex((n) => n.id === id)
  if (at >= 0) feed.splice(at, 1)
}

const toggleReadInFeed = (id) => {
  const row = notificationsMock().find((n) => n.id === id)
  if (row) row.read = !row.read
}

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
  NOTIFICATIONS_PAGE_SIZE: 10,
  listNotifications: (query) => {
    listCalls(query)
    return Promise.resolve(query ? pageOf(notificationsMock(), query) : notificationsMock())
  },
  getNotificationSettings: () => Promise.resolve({}),
  updateNotificationSettings: vi.fn(),
  // These write to the feed the fake reads, so the reload an action triggers
  // sees what the action did — which is the whole question for a list that is
  // only ten of the rows.
  markRead: vi.fn(async (id) => { toggleReadInFeed(id); return {} }),
  markAllRead: vi.fn(async () => {
    for (const n of notificationsMock()) n.read = true
    return {}
  }),
  dismissNotification: vi.fn(async (id) => { dropFromFeed(id); return {} }),
  archiveNotification: vi.fn(async (id) => { dropFromFeed(id); return {} }),
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

/**
 * Where the page asked the browser to scroll, and what to.
 *
 * jsdom has no layout, so `scrollIntoView` cannot be observed by reading a
 * scroll offset — the call itself is the behaviour under test. Recorded with
 * its element and its options, because "scrolled somewhere" is not the claim:
 * it has to be the notifications section, and it has to be its start.
 */
let scrollCalls = []
const realScrollIntoView = Element.prototype.scrollIntoView

beforeEach(() => {
  scrollCalls = []
  Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
    scrollCalls.push({ element: this, options })
  })
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = realScrollIntoView
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

describe('the list is one page, not the whole history', () => {
  /** 24 running-low, 3 back-in-stock — 27 rows, numbered so a page is legible. */
  const many = () => [
    ...Array.from({ length: 24 }, (_, i) =>
      notif('running-low', { title: `Low ${String(i + 1).padStart(2, '0')}` }),
    ),
    ...Array.from({ length: 3 }, (_, i) => notif('back-in-stock', { title: `Back ${i + 1}` })),
  ]

  // The card renders its title as a <p>, so the fixture's own titles are the
  // handle: every one of them starts "Low" or "Back" and nothing else does.
  const visibleTitles = () =>
    screen.queryAllByText(/^(Low|Back) \d+$/).map((el) => el.textContent.trim())

  const cardCount = () => visibleTitles().length

  it('shows ten cards for twenty-seven notifications', async () => {
    await renderSignal(many())

    await waitFor(() => expect(cardCount()).toBe(10))
  })

  it('says which page of how many', async () => {
    await renderSignal(many())

    expect(await screen.findByText('Page 1 of 3')).toBeDefined()
  })

  it('counts every chip over all twenty-seven, not the ten on screen', async () => {
    // The reason the counts come from the server: this is the assertion a
    // client-side count could not pass.
    await renderSignal(many())

    expect(countOn('All')).toBe(27)
    expect(countOn('Running Low')).toBe(24)
    expect(countOn('Back in Stock')).toBe(3)
  })

  it('Next shows the following ten, and none of the first ten again', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(cardCount()).toBe(10))
    const first = visibleTitles()

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())
    // The outgoing cards stay mounted through their AnimatePresence exit, so
    // wait for the list to settle before comparing the two pages.
    await waitFor(() => expect(visibleTitles()).toHaveLength(10))
    expect(visibleTitles().some((title) => first.includes(title))).toBe(false)
  })

  it('Previous comes back to exactly the first ten', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(cardCount()).toBe(10))
    const first = visibleTitles()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())
    await user.click(screen.getByRole('button', { name: /previous/i }))

    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeDefined())
    await waitFor(() => expect(visibleTitles()).toEqual(first))
  })

  it('walks every notification exactly once, losing and repeating none', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(cardCount()).toBe(10))

    const seen = [...visibleTitles()]
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())
    await waitFor(() => expect(visibleTitles()).toHaveLength(10))
    seen.push(...visibleTitles())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeDefined())
    await waitFor(() => expect(visibleTitles()).toHaveLength(7))
    seen.push(...visibleTitles())

    expect(seen).toHaveLength(27)
    expect(new Set(seen).size).toBe(27)
  })

  it('stops at the ends', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(cardCount()).toBe(10))

    expect(screen.getByRole('button', { name: /previous/i }).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeDefined())

    expect(screen.getByRole('button', { name: /next/i }).disabled).toBe(true)
  })

  it('offers no pager when everything fits on one page', async () => {
    await renderSignal([notif('running-low'), notif('back-in-stock')])

    await waitFor(() => expect(countOn('All')).toBe(2))
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.queryByText(/Page \d+ of/)).toBeNull()
  })
})

describe('changing a chip starts again at page one', () => {
  const many = () => [
    ...Array.from({ length: 24 }, (_, i) => notif('running-low', { title: `Low ${i + 1}` })),
    ...Array.from({ length: 3 }, (_, i) => notif('back-in-stock', { title: `Back ${i + 1}` })),
  ]

  it('does not land on page 3 of a chip that has one page', async () => {
    // Page 3 of Running Low is not a position in Back in Stock. Keeping the
    // number would show an empty list under a chip whose own count says three.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())

    await user.click(chip('Back in Stock'))

    await waitFor(() => expect(screen.getByText('Back 1')).toBeDefined())
    expect(screen.getByText('Back 3')).toBeDefined()
    expect(screen.queryByText(/Page \d+ of/)).toBeNull()
  })

  it('re-pages the filtered set rather than the whole one', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(countOn('All')).toBe(27))

    await user.click(chip('Running Low'))

    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeDefined())
    // And the chips still describe everything.
    expect(countOn('All')).toBe(27)
    expect(countOn('Back in Stock')).toBe(3)
  })
})

describe('an action leaves the page correct', () => {
  const many = () =>
    Array.from({ length: 12 }, (_, i) =>
      notif('running-low', { title: `Low ${String(i + 1).padStart(2, '0')}` }),
    )

  const visibleTitles = () => screen.queryAllByText(/^Low \d+$/).map((el) => el.textContent.trim())

  it('refills the page from the next one when a card is archived', async () => {
    // Ten cards, one archived, ten cards — not nine. The row that fills the gap
    // has to come from the server, because the client does not hold it.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(visibleTitles()).toHaveLength(10))

    await user.click(screen.getAllByRole('button', { name: /archive/i })[0])

    await waitFor(() => expect(screen.queryByText('Low 01')).toBeNull())
    await waitFor(() => expect(visibleTitles()).toHaveLength(10))
    expect(screen.getByText('Low 11')).toBeDefined()
  })

  it('drops the count when a card is deleted', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(countOn('All')).toBe(12))

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0])

    await waitFor(() => expect(countOn('All')).toBe(11))
  })

  it('moves a card out of the Unread chip once it is read', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(countOn('Unread')).toBe(12))

    await user.click(screen.getAllByRole('button', { name: /mark read/i })[0])

    await waitFor(() => expect(countOn('Unread')).toBe(11))
    expect(countOn('All')).toBe(12)
  })

  it('empties the Unread chip on mark all read', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(countOn('Unread')).toBe(12))

    await user.click(screen.getByRole('button', { name: /mark all read/i }))

    await waitFor(() => expect(countOn('Unread')).toBe(0))
    expect(countOn('All')).toBe(12)
  })
})

describe('an empty chip says what is empty', () => {
  it('names back-in-stock rather than blaming the filter', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal([notif('running-low')])

    await user.click(chip('Back in Stock'))

    expect(await screen.findByText(/No back-in-stock notifications yet/i)).toBeDefined()
  })

  it('names safety alerts', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal([notif('running-low')])

    await user.click(chip('Safety Alerts'))

    expect(await screen.findByText(/No safety alerts yet/i)).toBeDefined()
  })

  it('says nothing is unread rather than that there is nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal([notif('running-low', { read: true })])

    await user.click(chip('Unread'))

    expect(await screen.findByText(/No unread notifications/i)).toBeDefined()
  })
})

describe('turning a page takes the reader to the top of the list', () => {
  const many = () =>
    Array.from({ length: 27 }, (_, i) =>
      notif('running-low', { title: `Low ${String(i + 1).padStart(2, '0')}` }),
    )

  /** The one scroll the page should ever ask for, if it asked at all. */
  const lastScroll = () => scrollCalls[scrollCalls.length - 1]

  it('scrolls nothing on the first load', async () => {
    // Arriving on the page is not a page change. Scrolling here would fight
    // whatever position the browser restored.
    await renderSignal(many())

    expect(scrollCalls).toHaveLength(0)
  })

  it('scrolls to the notifications section on Next', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(scrollCalls).toHaveLength(1))
    // The section, identified by what it contains rather than by a test id:
    // the heading above the chips is the top of the feed.
    expect(lastScroll().element.textContent).toMatch(/SMART NOTIFICATIONS/i)
  })

  it('asks for the start of it, so the first card is what appears', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(scrollCalls).toHaveLength(1))
    expect(lastScroll().options).toEqual({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls after the new page is in place, not before', async () => {
    // The reader should land on the list they asked for. Asserted by the state
    // of the DOM at the moment the scroll was requested.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(scrollCalls).toHaveLength(1))
    expect(lastScroll().element.textContent).toMatch(/Page 2 of 3/)
  })

  it('scrolls to the same place on Previous', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())

    await user.click(screen.getByRole('button', { name: /previous/i }))

    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeDefined())
    expect(scrollCalls).toHaveLength(2)
    expect(lastScroll().element.textContent).toMatch(/SMART NOTIFICATIONS/i)
  })

  it('scrolls once per click, not once per render', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())

    expect(scrollCalls).toHaveLength(1)
  })

  it('costs one request, so the scroll fetches nothing of its own', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await waitFor(() => expect(listCalls).toHaveBeenCalled())
    const before = listCalls.mock.calls.length

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())

    expect(listCalls.mock.calls.length).toBe(before + 1)
  })
})

describe('a chip change goes back to the top too', () => {
  const many = () => [
    ...Array.from({ length: 24 }, (_, i) => notif('running-low', { title: `Low ${i + 1}` })),
    ...Array.from({ length: 3 }, (_, i) => notif('back-in-stock', { title: `Back ${i + 1}` })),
  ]

  it('scrolls to the list when a chip is chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(chip('Back in Stock'))

    await waitFor(() => expect(scrollCalls).toHaveLength(1))
    expect(scrollCalls[0].element.textContent).toMatch(/SMART NOTIFICATIONS/i)
    expect(scrollCalls[0].options).toEqual({ behavior: 'smooth', block: 'start' })
  })

  it('lands on page one of the chip it moved to', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeDefined())

    await user.click(chip('Back in Stock'))

    await waitFor(() => expect(screen.getByText('Back 1')).toBeDefined())
    expect(countOn('All')).toBe(27)
    expect(countOn('Back in Stock')).toBe(3)
  })
})

describe('an action does not move the reader', () => {
  const many = () =>
    Array.from({ length: 12 }, (_, i) =>
      notif('running-low', { title: `Low ${String(i + 1).padStart(2, '0')}` }),
    )

  it('does not scroll when a card is marked read', async () => {
    // The reload an action triggers is not a page change, and jumping the list
    // out from under the button that was just clicked is worse than staying.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getAllByRole('button', { name: /mark read/i })[0])

    await waitFor(() => expect(countOn('Unread')).toBe(11))
    expect(scrollCalls).toHaveLength(0)
  })

  it('does not scroll when a card is archived, even as the page refills', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getAllByRole('button', { name: /archive/i })[0])

    await waitFor(() => expect(screen.getByText('Low 11')).toBeDefined())
    expect(scrollCalls).toHaveLength(0)
  })

  it('does not scroll when a card is deleted', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0])

    await waitFor(() => expect(countOn('All')).toBe(11))
    expect(scrollCalls).toHaveLength(0)
  })

  it('does not scroll on mark all read', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    await user.click(screen.getByRole('button', { name: /mark all read/i }))

    await waitFor(() => expect(countOn('Unread')).toBe(0))
    expect(scrollCalls).toHaveLength(0)
  })

  it('does not scroll when a settings switch below the list is toggled', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal(many())

    const switches = screen.getAllByRole('switch')
    await user.click(switches[0])

    expect(scrollCalls).toHaveLength(0)
  })

  it('does not scroll when the last card on the last page is deleted', async () => {
    // The server answers a page past the end with the last one, and the client
    // follows that correction. It is a page change nobody asked for, so it
    // must not move the reader either.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderSignal([
      ...Array.from({ length: 10 }, (_, i) => notif('running-low', { title: `Low ${i + 1}` })),
      notif('running-low', { title: 'Only one' }),
    ])
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('Only one')).toBeDefined())
    const afterTurningThePage = scrollCalls.length

    // Named rather than indexed: the outgoing page-1 cards are still mounted
    // through their exit animation, so "the first delete button" is whichever
    // card happens to be leaving.
    await user.click(screen.getByRole('button', { name: /Delete notification: Only one/i }))

    await waitFor(() => expect(screen.queryByText('Only one')).toBeNull())
    expect(scrollCalls).toHaveLength(afterTurningThePage)
  })
})
