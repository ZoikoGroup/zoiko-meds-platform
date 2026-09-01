// @vitest-environment jsdom
//
// Dashboard medicine search → the autocomplete dropdown, and what may clip it.
//
// The list is `absolute top-full`, so it hangs below the input and out of the
// hero card. The hero was `relative overflow-hidden`, which cut it off at the
// card's edge: on desktop the hero ends only a little below the input, so one
// row survived; on a phone the heading, subtitle and chip row all wrap, the card
// runs further down, and two or three rows fitted — which is why this looked
// like a desktop-only bug when it was really "however much card is left".
//
// The clipping is now on a decoration-only layer, so these tests walk the real
// ancestor chain rather than asserting a class on one element.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const SUGGESTIONS = [
  { id: 'm1', name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', form: 'Tablet' },
  { id: 'm2', name: 'Dolo 500', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet' },
  { id: 'm3', name: 'Doxycycline', generic: 'Doxycycline', strength: '100 mg', form: 'Capsule' },
  { id: 'm4', name: 'Domperidone', generic: 'Domperidone', strength: '10 mg', form: 'Tablet' },
  { id: 'm5', name: 'Dolonex', generic: 'Piroxicam', strength: '20 mg', form: 'Tablet' },
  { id: 'm6', name: 'Doxofylline', generic: 'Doxofylline', strength: '400 mg', form: 'Tablet' },
]

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

// The hook is the search behaviour; this is a layout test, so it answers
// immediately and is never asserted against.
vi.mock('@/hooks/use-medicine-suggestions', () => ({
  useMedicineSuggestions: (query) => ({
    suggestions: (query || '').trim() ? SUGGESTIONS : [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/services/user-api', () => ({
  getUserOverview: async () => ({ summary: {}, featured: [], recentSearches: [] }),
  listNearbyPharmacies: async () => [],
}))
vi.mock('@/services/medicine-api', () => ({ matchMedicines: async () => [] }))
vi.mock('@/features/signal/signal-widget', () => ({ SignalWidget: () => null }))
vi.mock('@/components/shared/location-modal', () => ({ LocationModal: () => null }))

const { default: UserHome } = await import('../UserHome')

/** Type into the hero search box and wait for the listbox to appear. */
async function search(user, term = 'do') {
  render(<UserHome />)
  const input = screen.getByRole('combobox', { name: /search medicines/i })
  await user.type(input, term)
  const list = await screen.findByRole('listbox')
  return { input, list }
}

/** Every ancestor of `el` up to <body>, nearest first. */
function ancestors(el) {
  const chain = []
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    chain.push(node)
  }
  return chain
}

const classesOf = (el) => (el.getAttribute('class') || '').split(/\s+/)

beforeEach(() => {
  navigate.mockClear()
  localStorage.setItem('zoiko-user-loc', 'Ghaziabad')
  localStorage.setItem('zoiko-loc-permission', 'granted')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('the dropdown is not clipped by anything it hangs out of', () => {
  it('has no ancestor that hides overflow', async () => {
    // The bug in one assertion. `overflow-hidden` anywhere above an
    // `absolute top-full` list is a scissor across it.
    const { list } = await search(userEvent.setup())

    const clipping = ancestors(list).filter((el) =>
      classesOf(el).some((c) => c === 'overflow-hidden' || c === 'overflow-y-hidden'),
    )

    expect(clipping.map((el) => el.getAttribute('class'))).toEqual([])
  })

  it('has no ancestor that caps its height', async () => {
    const { list } = await search(userEvent.setup())

    const capped = ancestors(list).filter((el) =>
      classesOf(el).some((c) => /^(max-)?h-(?!full|auto)/.test(c)),
    )

    expect(capped.map((el) => el.getAttribute('class'))).toEqual([])
  })

  it('still gives the hero a positioned ancestor to hang from', async () => {
    // top-full means nothing without one; the nearest must be the input wrapper.
    const { list } = await search(userEvent.setup())

    const positioned = ancestors(list).find((el) => classesOf(el).includes('relative'))

    expect(positioned).toBeDefined()
    expect(within(positioned).getByRole('combobox')).toBeDefined()
  })
})

describe('the hero card keeps its decoration clipped', () => {
  it('clips the decorative layer rather than the whole card', async () => {
    // The blobs are positioned outside the card on purpose, so something still
    // has to clip them — just not the element the dropdown lives in.
    await search(userEvent.setup())

    const decoration = document.querySelector('[aria-hidden].absolute.inset-0.overflow-hidden')

    expect(decoration).not.toBeNull()
    expect(classesOf(decoration)).toContain('rounded-2xl')
    // Decoration must never eat a click meant for the card.
    expect(classesOf(decoration)).toContain('pointer-events-none')
  })

  it('leaves the card itself unclipped', async () => {
    const { list } = await search(userEvent.setup())

    const card = ancestors(list).find((el) => el.tagName === 'SECTION')

    expect(card).toBeDefined()
    expect(classesOf(card)).not.toContain('overflow-hidden')
    // The rounded card look is unchanged.
    expect(classesOf(card)).toEqual(expect.arrayContaining(['relative', 'rounded-2xl']))
  })
})

describe('the list itself', () => {
  it('renders every suggestion, not just the first', async () => {
    // Desktop showed one row. All six are in the DOM now.
    const { list } = await search(userEvent.setup())

    const options = within(list).getAllByRole('option')

    expect(options).toHaveLength(SUGGESTIONS.length)
    // The matched prefix is wrapped in <mark>, so the name is split across
    // elements — read each row whole rather than matching on a text node.
    const rendered = options.map((o) => o.textContent)
    for (const s of SUGGESTIONS) {
      expect(rendered.some((text) => text.includes(s.name))).toBe(true)
    }
  })

  it('opens directly below the input and paints above the cards under it', async () => {
    const { list } = await search(userEvent.setup())

    const classes = classesOf(list)
    expect(classes).toContain('absolute')
    expect(classes).toContain('top-full')
    expect(classes).toContain('left-0')
    expect(classes).toContain('w-full')
    // The quick-action cards below are unpositioned, so any positive z wins.
    expect(classes.some((c) => /^z-\d+$/.test(c))).toBe(true)
  })

  it('scrolls instead of clipping when it runs out of room', async () => {
    const { list } = await search(userEvent.setup())

    const classes = classesOf(list)
    expect(classes).toContain('overflow-y-auto')
    expect(classes).not.toContain('overflow-hidden')
    expect(classes.some((c) => c.startsWith('max-h-'))).toBe(true)
  })

  it('keeps its border, background and shadow', async () => {
    // The fix is about clipping, not appearance.
    const { list } = await search(userEvent.setup())

    expect(classesOf(list)).toEqual(
      expect.arrayContaining(['rounded-xl', 'border', 'bg-popover', 'shadow-elevated']),
    )
  })
})

describe('search behaviour is untouched', () => {
  it('selecting a suggestion still searches for it', async () => {
    const user = userEvent.setup()
    const { list } = await search(user)

    await user.click(within(list).getByText('Doxycycline'))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/search?q=Doxycycline'))
  })

  it('shows nothing until something is typed', async () => {
    render(<UserHome />)

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('leaves the input where it was, at full width', async () => {
    const { input } = await search(userEvent.setup())

    expect(classesOf(input)).toContain('h-12')
    expect(input.closest('.relative')?.className).toContain('flex-1')
  })
})
