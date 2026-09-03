// @vitest-environment jsdom
//
// Saved Medicines cards holding their height.
//
// Every verified pharmacy near the patient that reports a medicine was listed
// inside its card — name, distance, freshness, confidence badge and a Call
// link each. A medicine stocked at two branches made a card two rows taller
// than its neighbour; at ten, the grid lost any rhythm and the patient scrolled
// past every branch of every medicine to reach the last one.
//
// Same data, same visibility rule, same API response — moved behind one
// compact action, into the Sheet primitive the mobile navigation already uses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
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

const listSavedMock = vi.fn()
const toggleAlertsMock = vi.fn()
let signalSettings = { backInStock: true }

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({
    data: listSavedMock(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUnsaveMedicine: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleSavedAlerts: () => ({
    mutate: (vars, opts) => {
      toggleAlertsMock(vars)
      opts?.onSuccess?.()
    },
    isPending: false,
  }),
  useSignalSettings: () => ({ data: signalSettings }),
}))

const { default: UserSaved } = await import('../UserSaved')

/** One pharmacy row as the API already sends it inside a saved medicine. */
const pharmacy = (n, over = {}) => ({
  id: `ph_${n}`,
  name: `Pharmacy ${n}`,
  confidence: 'high',
  distance: n + 0.5,
  approximate: false,
  updated: `${n} min ago`,
  phone: '+91 40 2345 6789',
  ...over,
})

/** A saved medicine stocked at `count` nearby pharmacies. */
const withPharmacies = (count, over = {}) => ({
  id: 'med_1',
  name: 'Dolo 650',
  generic: 'Paracetamol',
  strength: '650 mg',
  confidence: 'high',
  pharmacy: 'Apollo Pharmacy',
  distance: 7.7,
  updated: '14 days ago',
  alertsEnabled: true,
  pharmacies: Array.from({ length: count }, (_, i) => pharmacy(i + 1)),
  ...over,
})

/** A saved medicine no nearby pharmacy reports. */
const withNone = (over = {}) => ({
  id: 'med_2',
  name: 'Metformin 500 mg',
  generic: 'Metformin',
  strength: '500 mg',
  confidence: 'unknown',
  pharmacy: 'No verified pharmacy near you stocks this yet',
  distance: null,
  updated: 'No recent signal nearby',
  alertsEnabled: true,
  pharmacies: [],
  ...over,
})

const VIEW_PHARMACIES = /View pharmacies/i

/** The card element for a medicine, by its heading text. */
const cardFor = (name) => screen.getByText(name).closest('div[data-slot="card"]')

beforeEach(() => {
  vi.clearAllMocks()
  signalSettings = { backInStock: true }
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

describe('1. pharmacy names are not in the card', () => {
  it('renders no pharmacy name inside a card that has several', () => {
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    const card = cardFor('Dolo 650')
    for (const n of [1, 2, 3]) {
      expect(within(card).queryByText(`Pharmacy ${n}`)).toBeNull()
    }
  })

  it('renders no per-pharmacy distance, freshness or Call link in the card', () => {
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    const card = cardFor('Dolo 650')
    expect(within(card).queryByText('1 min ago')).toBeNull()
    expect(within(card).queryByText('1.5 km')).toBeNull()
    expect(within(card).queryAllByRole('link', { name: /^Call$/ })).toHaveLength(0)
  })

  it('keeps the availability summary', () => {
    // The headline stays; only the list moved.
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    const card = cardFor('Dolo 650')
    expect(within(card).getByText('Availability')).toBeDefined()
    expect(within(card).getByText(/Likely available now/i)).toBeDefined()
  })
})

describe('2. the action appears when there are pharmacies', () => {
  it('offers View pharmacies, with the count', () => {
    listSavedMock.mockReturnValue([withPharmacies(2)])
    render(<UserSaved />)

    const button = screen.getByRole('button', { name: VIEW_PHARMACIES })
    expect(button).toBeDefined()
    expect(button.textContent).toContain('(2)')
  })

  it('offers one per medicine that has pharmacies', () => {
    listSavedMock.mockReturnValue([
      withPharmacies(2),
      withNone(),
      withPharmacies(5, { id: 'med_3', name: 'Ibuprofen 400 mg' }),
    ])
    render(<UserSaved />)

    expect(screen.getAllByRole('button', { name: VIEW_PHARMACIES })).toHaveLength(2)
  })
})

describe('3. clicking it shows that medicine’s pharmacies', () => {
  it('lists every pharmacy with name, distance, freshness and confidence', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    const panel = await screen.findByRole('dialog')
    for (const n of [1, 2, 3]) {
      expect(within(panel).getByText(`Pharmacy ${n}`)).toBeDefined()
      expect(within(panel).getByText(`${n} min ago`)).toBeDefined()
    }
    expect(within(panel).getAllByRole('link', { name: /^Call$/ })).toHaveLength(3)
  })

  it('names the medicine it is showing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(2)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    expect(within(await screen.findByRole('dialog')).getByText('Dolo 650')).toBeDefined()
  })

  it('shows the right medicine when several are saved', async () => {
    // One sheet for the page, so the wrong medicine's list is the mistake to
    // guard against.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([
      withPharmacies(2),
      withPharmacies(1, {
        id: 'med_3',
        name: 'Ibuprofen 400 mg',
        pharmacies: [pharmacy(9, { name: 'Riverside Chemist' })],
      }),
    ])
    render(<UserSaved />)

    const [, second] = screen.getAllByRole('button', { name: VIEW_PHARMACIES })
    await user.click(second)

    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('Riverside Chemist')).toBeDefined()
    expect(within(panel).queryByText('Pharmacy 1')).toBeNull()
  })

  it('carries the confirm-before-travelling note', async () => {
    // Availability is a confidence signal wherever it is shown.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(2)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    expect(within(await screen.findByRole('dialog')).getByText(/not exact stock/i)).toBeDefined()
  })

  it('closes again', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(2)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('4. no eligible pharmacies', () => {
  it('does not offer the action at all', () => {
    // Hidden rather than disabled: there is nothing to open, and an empty sheet
    // is worse than no button.
    listSavedMock.mockReturnValue([withNone()])
    render(<UserSaved />)

    expect(screen.queryByRole('button', { name: VIEW_PHARMACIES })).toBeNull()
  })

  it('still says why, in the existing empty-state line', () => {
    listSavedMock.mockReturnValue([withNone()])
    render(<UserSaved />)

    const card = cardFor('Metformin 500 mg')
    expect(
      within(card).getByText(/No verified pharmacy near you stocks this yet/i),
    ).toBeDefined()
    expect(within(card).getByText(/No recent signal nearby/i)).toBeDefined()
  })

  it('opens no dialog', () => {
    listSavedMock.mockReturnValue([withNone()])
    render(<UserSaved />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('5. card height does not follow the pharmacy count', () => {
  /** Every element rendered inside a card, as a shape-of-the-card signature. */
  const shape = (name) =>
    [...cardFor(name).querySelectorAll('*')].map((el) => el.tagName).join(',')

  it('is the same shape at 1, 2, 10 and 40 pharmacies', () => {
    const shapes = new Set()
    for (const count of [1, 2, 10, 40]) {
      cleanup()
      listSavedMock.mockReturnValue([withPharmacies(count)])
      render(<UserSaved />)
      shapes.add(shape('Dolo 650'))
    }

    expect(shapes.size).toBe(1)
  })

  it('adds no list element to the card', () => {
    listSavedMock.mockReturnValue([withPharmacies(10)])
    render(<UserSaved />)

    expect(cardFor('Dolo 650').querySelectorAll('li')).toHaveLength(0)
  })

  it('renders one action whether there are 2 pharmacies or 40', () => {
    listSavedMock.mockReturnValue([withPharmacies(40)])
    render(<UserSaved />)

    expect(screen.getAllByRole('button', { name: VIEW_PHARMACIES })).toHaveLength(1)
  })
})

describe('6. visibility rules are untouched', () => {
  it('shows exactly the pharmacies the API sent, no more and no fewer', async () => {
    // Presentation only: no filtering added here, and none removed. The list is
    // whatever `med.pharmacies` holds, which is what the patient-visibility
    // rule already produced server-side.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(4)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    expect(within(await screen.findByRole('dialog')).getAllByRole('listitem')).toHaveLength(4)
  })

  it('shows no stock quantity anywhere', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).not.toMatch(/units|in stock:|quantity|qty/i)
  })

  it('offers no Call link for a pharmacy with no number on record', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([
      withPharmacies(2, {
        pharmacies: [pharmacy(1), pharmacy(2, { phone: null })],
      }),
    ])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))

    expect(within(await screen.findByRole('dialog')).getAllByRole('link', { name: /^Call$/ })).toHaveLength(1)
  })
})

describe('7 & 8. the controls that were not part of this change', () => {
  it('the alerts toggle still sends its per-medicine value', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    await user.click(screen.getByLabelText('Toggle alerts for Dolo 650'))

    await waitFor(() =>
      expect(toggleAlertsMock).toHaveBeenCalledWith({ medicineId: 'med_1', alertsEnabled: false }),
    )
  })

  it('the alerts toggle is still on the card, beside the new action', () => {
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    const card = cardFor('Dolo 650')
    expect(within(card).getByText('Alerts enabled')).toBeDefined()
    expect(within(card).getByRole('button', { name: VIEW_PHARMACIES })).toBeDefined()
  })

  it('View details still navigates to the medicine', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: /View details/i }))

    expect(navigateMock).toHaveBeenCalledWith('/medicine/med_1')
  })
})

describe('9 & 10. layout', () => {
  it('the action fills the card width rather than sitting on its own row', () => {
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    const button = screen.getByRole('button', { name: VIEW_PHARMACIES })
    expect(button.className).toContain('w-full')
  })

  it('the panel is a bottom sheet on small screens and a side panel above sm', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(3)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))
    const panel = await screen.findByRole('dialog')

    expect(panel.className).toContain('inset-x-0')
    expect(panel.className).toContain('bottom-0')
    expect(panel.className).toMatch(/sm:(right-0|w-\[26rem\])/)
  })

  it('scrolls the panel vertically rather than the page sideways', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([withPharmacies(40)])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))
    const panel = await screen.findByRole('dialog')

    expect(panel.className).toContain('overflow-y-auto')
    expect(panel.className).not.toContain('overflow-x')
  })

  it('truncates a long pharmacy name instead of widening the row', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    listSavedMock.mockReturnValue([
      withPharmacies(1, {
        pharmacies: [
          pharmacy(1, { name: 'The Very Long Community Pharmacy And Dispensing Chemist Limited' }),
        ],
      }),
    ])
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))
    const panel = await screen.findByRole('dialog')

    const name = within(panel).getByText(/The Very Long Community Pharmacy/)
    expect(name.className).toContain('truncate')
  })
})
