// @vitest-environment jsdom
//
// Scan → search UX: the medicines read from one prescription must all stay
// reachable while the user searches them one at a time. Before this, choosing
// a medicine unmounted the scan panel and the rest of the prescription was
// lost — the only way to reach the second medicine was to scan again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// --- Mocks: isolate the page from routing, i18n and the network -------------

let searchParams = new URLSearchParams()
const setSearchParamsMock = vi.fn((next) => {
  searchParams = new URLSearchParams(next ?? {})
})
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [searchParams, setSearchParamsMock],
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

vi.mock('@/hooks/use-medicine-suggestions', () => ({
  useMedicineSuggestions: () => ({ suggestions: [], loading: false, error: null }),
}))

vi.mock('@/lib/geocode', () => ({ reverseGeocode: async () => 'Gummadidala, Telangana' }))
vi.mock('@/lib/location-data', () => ({ validateLocation: async () => ({ isValid: true }) }))

// The results card offers Save/Unsave; these hooks are react-query backed and
// would otherwise need a QueryClientProvider around the page.
const saveMock = vi.fn(async () => ({ saved: true }))
const unsaveMock = vi.fn(async () => ({ saved: false }))
let savedMedicines = []
vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({ data: savedMedicines }),
  useSaveMedicine: () => ({ mutateAsync: saveMock, isPending: false }),
  useUnsaveMedicine: () => ({ mutateAsync: unsaveMock, isPending: false }),
}))

const searchNearbyAvailabilityMock = vi.fn(async ({ q }) => ({
  medicine: q,
  items: [],
  availableCount: 0,
  total: 0,
  internet: null,
}))
vi.mock('@/services/nearby-availability', () => ({
  searchNearbyAvailability: (...args) => searchNearbyAvailabilityMock(...args),
}))

// A stand-in for the scan panel: publishes a three-medicine prescription and
// lets the test fire the same "Search" callback the real result card fires.
const DETECTED = [
  { name: 'Metformin 500 mg', detail: 'Metformin · 500 mg', strength: '500 mg', needsConfirmation: false, reason: 'Matched to the MediBase catalog' },
  { name: 'Pantoprazole 40 mg', detail: 'Pantoprazole · 40 mg', strength: '40 mg', needsConfirmation: false, reason: 'Matched to the MediBase catalog' },
  { name: 'Atorvastatin', detail: 'Atorvastatin · 20 mg', strength: '20 mg', needsConfirmation: true, reason: 'Read from your prescription but not found in the catalog' },
]

vi.mock('@/features/scan/scan-prescription', () => ({
  ScanPrescription: ({ onSearchMedicine, onDetected }) => (
    <div>
      <button type="button" onClick={() => onDetected(DETECTED)}>
        stub-publish-detected
      </button>
      <button type="button" onClick={() => onSearchMedicine(DETECTED[0])}>
        stub-search-first
      </button>
    </div>
  ),
}))

const { default: UserSearch } = await import('../UserSearch')

beforeEach(() => {
  searchParams = new URLSearchParams()
  vi.clearAllMocks()
  savedMedicines = []
  localStorage.setItem('zoiko-user-loc', 'Gummadidala, Telangana')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** Render the page, scan a 3-medicine prescription, pick the first medicine. */
async function scanAndPickFirst(user) {
  render(<UserSearch />)
  await user.click(screen.getByRole('button', { name: 'Scan prescription' }))
  await user.click(screen.getByText('stub-publish-detected'))
  await user.click(screen.getByText('stub-search-first'))
}

const detectedBar = () => screen.getByText('Detected medicines').closest('div').parentElement

describe('detected medicines stay available after searching one', () => {
  it('keeps all three listed after the first is searched', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)

    // We are now on the search view with the first medicine committed…
    expect(screen.getByLabelText('Medicine name').value).toBe('Metformin 500 mg')
    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalled())

    // …and the other two are still one click away.
    for (const medicine of DETECTED) {
      expect(within(detectedBar()).getByText(medicine.name)).toBeDefined()
    }
  })

  it('searches all three one after another without re-scanning', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)
    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalledTimes(1))

    await user.click(within(detectedBar()).getByText('Pantoprazole 40 mg'))
    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalledTimes(2))

    await user.click(within(detectedBar()).getByText('Atorvastatin'))
    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalledTimes(3))

    // Each search ran against its own medicine, in order.
    expect(searchNearbyAvailabilityMock.mock.calls.map(([args]) => args.q)).toEqual([
      'metformin 500 mg',
      'pantoprazole 40 mg',
      'atorvastatin',
    ])
    // The scan panel was never re-opened.
    expect(screen.queryByText('stub-publish-detected')).not.toBeNull() // mounted, hidden
  })

  it('marks the medicine being searched as the active chip', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)

    const bar = detectedBar()
    expect(
      within(bar).getByText('Metformin 500 mg').closest('button').getAttribute('aria-pressed'),
    ).toBe('true')

    await user.click(within(bar).getByText('Atorvastatin'))
    expect(within(bar).getByText('Atorvastatin').closest('button').getAttribute('aria-pressed')).toBe('true')
    expect(
      within(bar).getByText('Metformin 500 mg').closest('button').getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('un-highlights every chip once the user types a different name', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)

    const input = screen.getByLabelText('Medicine name')
    await user.clear(input)
    await user.type(input, 'Ibuprofen')

    const bar = detectedBar()
    for (const medicine of DETECTED) {
      expect(within(bar).getByText(medicine.name).closest('button').getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('keeps the scan panel mounted so its results are not thrown away', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)

    // Returning to the scan tab must not require a new upload.
    await user.click(screen.getByRole('button', { name: 'Scan prescription' }))
    expect(screen.getByText('stub-search-first')).toBeDefined()
  })

  it('clears the list and resets the scan panel on Clear', async () => {
    const user = userEvent.setup()
    await scanAndPickFirst(user)

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('Detected medicines')).toBeNull()
  })

  it('shows nothing when no prescription has been scanned', () => {
    render(<UserSearch />)
    expect(screen.queryByText('Detected medicines')).toBeNull()
  })
})

describe('saving a medicine from the search results', () => {
  /** Search a medicine and get a result carrying a governed identity. */
  async function searchWithIdentity(user) {
    searchNearbyAvailabilityMock.mockResolvedValueOnce({
      medicine: 'ibuprofen 400 mg',
      identity: { id: 'med_1', name: 'Ibuprofen 400 mg', strength: '400 mg' },
      items: [
        { id: 'p1', name: 'Apollo Pharmacy', area: 'Hyderabad', distance: 4.2,
          status: 'available', confidence: 'high', updated: '10 min ago', is24x7: false },
      ],
      availableCount: 1,
      total: 1,
      internet: null,
    })
    render(<UserSearch />)
    await user.type(screen.getByLabelText('Medicine name'), 'Ibuprofen 400 mg')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))
    return screen.findByRole('button', { name: /Save Ibuprofen 400 mg to your medicines/i })
  }

  it('offers Save on the result, without opening the details page', async () => {
    const user = userEvent.setup()
    const saveButton = await searchWithIdentity(user)

    await user.click(saveButton)
    expect(saveMock).toHaveBeenCalledWith({ id: 'med_1', name: 'Ibuprofen 400 mg' })
    // Saved in place: the user is still on the results, not sent to details.
    expect(screen.getByLabelText('Medicine name').value).toBe('Ibuprofen 400 mg')
    expect(screen.getByText('View details')).toBeDefined()
  })

  it('offers Save for a medicine MediBase does not hold yet', async () => {
    // The Volini Gel case: an identity with a name but no id, so there is no
    // detail page — Save must still be available.
    const user = userEvent.setup()
    searchNearbyAvailabilityMock.mockResolvedValueOnce({
      medicine: 'volini gel',
      identity: { id: null, name: 'Volini Gel', strength: '', form: '' },
      items: [
        { id: 'p1', name: 'Apollo Pharmacy', area: 'Hyderabad', distance: 4.2,
          status: 'available', confidence: 'high', updated: '10 min ago', is24x7: false },
      ],
      availableCount: 1,
      total: 1,
      internet: null,
    })
    render(<UserSearch />)
    await user.type(screen.getByLabelText('Medicine name'), 'Volini Gel')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    const save = await screen.findByRole('button', {
      name: /Save Volini Gel to your medicines/i,
    })
    // No governed identity, so no detail link beside it.
    expect(screen.queryByText('View details')).toBeNull()

    await user.click(save)
    // Sent by name; the API links it when a pharmacy adds the medicine.
    expect(saveMock).toHaveBeenCalledWith({ id: null, name: 'Volini Gel' })
  })

  it('shows an off-catalog medicine as Saved via normalized name', async () => {
    const user = userEvent.setup()
    savedMedicines = [{ id: null, name: 'volini-gel' }]

    searchNearbyAvailabilityMock.mockResolvedValueOnce({
      medicine: 'volini gel',
      identity: { id: null, name: 'Volini Gel', strength: '', form: '' },
      items: [
        { id: 'p1', name: 'Apollo Pharmacy', area: 'Hyderabad', distance: 4.2,
          status: 'available', confidence: 'high', updated: '10 min ago', is24x7: false },
      ],
      availableCount: 1,
      total: 1,
      internet: null,
    })
    render(<UserSearch />)
    await user.type(screen.getByLabelText('Medicine name'), 'Volini Gel')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    const remove = await screen.findByRole('button', {
      name: /Remove Volini Gel from saved medicines/i,
    })
    expect(remove.getAttribute('aria-pressed')).toBe('true')

    await user.click(remove)
    // Unsaved by name, since there is no id to address it with.
    expect(unsaveMock).toHaveBeenCalledWith('Volini Gel')
  })

  it('reflects an already-saved medicine and unsaves it', async () => {
    const user = userEvent.setup()
    savedMedicines = [{ id: 'med_1', name: 'Ibuprofen 400 mg' }]

    searchNearbyAvailabilityMock.mockResolvedValueOnce({
      medicine: 'ibuprofen 400 mg',
      identity: { id: 'med_1', name: 'Ibuprofen 400 mg', strength: '400 mg' },
      items: [
        { id: 'p1', name: 'Apollo Pharmacy', area: 'Hyderabad', distance: 4.2,
          status: 'available', confidence: 'high', updated: '10 min ago', is24x7: false },
      ],
      availableCount: 1,
      total: 1,
      internet: null,
    })
    render(<UserSearch />)
    await user.type(screen.getByLabelText('Medicine name'), 'Ibuprofen 400 mg')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    const remove = await screen.findByRole('button', {
      name: /Remove Ibuprofen 400 mg from saved medicines/i,
    })
    expect(remove.getAttribute('aria-pressed')).toBe('true')

    await user.click(remove)
    expect(unsaveMock).toHaveBeenCalledWith('med_1')
    expect(saveMock).not.toHaveBeenCalled()
  })
})

describe('search radius is in kilometres', () => {
  const options = () =>
    [...screen.getByLabelText('Distance from me').options].map((option) => option.textContent.trim())

  it('offers 5–50 km in 5 km steps and no miles', () => {
    render(<UserSearch />)
    expect(options()).toEqual([
      '5 km', '10 km', '15 km', '20 km', '25 km',
      '30 km', '35 km', '40 km', '45 km', '50 km',
    ])
    expect(options().join(' ')).not.toMatch(/mile|\bmi\b/i)
  })

  it('sends the selected radius to the API unconverted', async () => {
    // The API takes `maxDistance` as a km ceiling, so the selected number must
    // arrive as-is — the old selector multiplied it by 1.60934 first, turning
    // a 15-mile choice into a 24 km request.
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.selectOptions(screen.getByLabelText('Distance from me'), '25')
    await user.type(screen.getByLabelText('Medicine name'), 'Ibuprofen 400 mg')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalled())
    expect(searchNearbyAvailabilityMock.mock.calls[0][0].maxDistanceKm).toBe(25)
  })

  it('defaults to 15 km', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.type(screen.getByLabelText('Medicine name'), 'Ibuprofen 400 mg')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalled())
    expect(searchNearbyAvailabilityMock.mock.calls[0][0].maxDistanceKm).toBe(15)
  })

  it('states the radius in km in the availability summary', async () => {
    const user = userEvent.setup()
    // The summary only renders alongside at least one pharmacy card.
    searchNearbyAvailabilityMock.mockResolvedValueOnce({
      medicine: 'ibuprofen 400 mg',
      items: [
        {
          id: 'p1',
          name: 'Apollo Pharmacy',
          area: 'Kompally Main Rd, Hyderabad',
          distance: 4.2,
          status: 'available',
          confidence: 'high',
          updated: '10 min ago',
          is24x7: false,
        },
      ],
      availableCount: 3,
      total: 4,
      internet: null,
    })
    // The sentence is assembled from several nested spans, so assert against
    // the rendered tree's text rather than a single element.
    const { container } = render(<UserSearch />)

    await user.selectOptions(screen.getByLabelText('Distance from me'), '30')
    await user.type(screen.getByLabelText('Medicine name'), 'Ibuprofen 400 mg')
    await user.click(screen.getByRole('button', { name: /Search Availability/i }))

    await waitFor(() => expect(container.textContent).toMatch(/within\s*30\s*km\./i))
    expect(container.textContent).not.toMatch(/mile/i)
  })
})
