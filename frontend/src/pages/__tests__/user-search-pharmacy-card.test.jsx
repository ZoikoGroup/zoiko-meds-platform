// @vitest-environment jsdom
//
// The pharmacy card in Patient Search.
//
// Two guarantees are pinned here. A pharmacy that carries the medicine but has
// run out stays on screen, labelled Out of stock — dropping it would tell the
// patient the pharmacy has nothing to do with the medicine, which is not what
// the pharmacy said. And every card shows that pharmacy's own contact number,
// because calling to confirm is the one action the availability model asks of a
// patient before they travel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

let searchParams = new URLSearchParams()
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [searchParams, vi.fn()],
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

vi.mock('@/hooks/use-medicine-suggestions', () => ({
  useMedicineSuggestions: () => ({ suggestions: [], loading: false, error: null }),
}))

vi.mock('@/lib/geocode', () => ({ reverseGeocode: async () => 'Gandimaisamma, Telangana' }))
vi.mock('@/lib/location-data', () => ({ validateLocation: async () => ({ isValid: true }) }))

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({ data: [] }),
  useSaveMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnsaveMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/scan/scan-prescription', () => ({ ScanPrescription: () => null }))
vi.mock('@/features/scan/detected-medicines-bar', () => ({ DetectedMedicinesBar: () => null }))

let result = null
const searchNearbyAvailabilityMock = vi.fn(async () => result)
vi.mock('@/services/nearby-availability', () => ({
  searchNearbyAvailability: (...args) => searchNearbyAvailabilityMock(...args),
}))

const { default: UserSearch } = await import('../UserSearch')

/** One pharmacy card's worth of API data, as nearby-availability maps it. */
const card = (over = {}) => ({
  id: 'ph_zoiko',
  name: 'Zoiko Meds Pharmacy',
  address: 'Gandimaisamma, Hyderabad, 500043',
  distance: 3.6,
  phone: '+91 40 2345 6789',
  latitude: 17.5878172,
  longitude: 78.4236196,
  confidence: 'high',
  status: 'available',
  updated: '2 days ago',
  ...over,
})

const searched = (items, availableCount) => ({
  source: 'live',
  identity: { id: 'med_atorva', name: 'Atorvastatin', generic: 'Atorvastatin', rx: true },
  medicine: 'Atorvastatin',
  items,
  availableCount,
  total: items.length,
  internet: null,
})

/** Render the deep-linked search and wait for the results to land. */
async function renderSearch() {
  render(<UserSearch />)
  await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalled())
  await screen.findByText('Zoiko Meds Pharmacy')
}

const cardFor = (name) => screen.getByText(name).closest('div[class*="rounded"]').parentElement

beforeEach(() => {
  searchParams = new URLSearchParams({ q: 'Atorvastatin' })
  vi.clearAllMocks()
  result = null
  localStorage.setItem('zoiko-user-loc', 'Gandimaisamma, Telangana')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('a pharmacy that has run out stays visible', () => {
  it('shows Out of stock for a pharmacy whose signal is LOW', async () => {
    result = searched([card({ confidence: 'low', status: 'unavailable' })], 0)

    await renderSearch()

    // Still on screen — it carries Atorvastatin, it just has none right now.
    expect(screen.getByText('Zoiko Meds Pharmacy')).toBeDefined()
    expect(screen.getAllByText('Out of stock').length).toBeGreaterThan(0)
    // And never described as available.
    expect(screen.queryByText('Likely available now')).toBeNull()
  })

  it('shows Out of stock for a pharmacy whose signal is UNKNOWN', async () => {
    result = searched([card({ confidence: 'unknown', status: 'unavailable' })], 0)

    await renderSearch()

    expect(screen.getByText('Zoiko Meds Pharmacy')).toBeDefined()
    expect(screen.getAllByText('Out of stock').length).toBeGreaterThan(0)
  })

  it('shows High for a pharmacy that has it', async () => {
    result = searched([card()], 1)

    await renderSearch()

    expect(screen.getByText('High')).toBeDefined()
    expect(screen.getByText('Likely available now')).toBeDefined()
  })

  it('shows Moderate for a pharmacy with limited stock', async () => {
    result = searched([card({ confidence: 'moderate', status: 'limited' })], 1)

    await renderSearch()

    expect(screen.getByText('Moderate')).toBeDefined()
  })

  it('does not count an out-of-stock pharmacy as available', async () => {
    result = searched([card({ confidence: 'low', status: 'unavailable' })], 0)

    await renderSearch()

    expect(screen.getByText(/couldn.t confirm/i)).toBeDefined()
  })

  it('says nothing at all when the medicine is in no pharmacy\'s inventory', async () => {
    result = { ...searched([], 0), items: [], total: 0 }
    render(<UserSearch />)
    await waitFor(() => expect(searchNearbyAvailabilityMock).toHaveBeenCalled())

    // Removed from inventory means gone from the results — not an Out of stock
    // card for a pharmacy that never reported on this medicine.
    expect(screen.queryByText('Zoiko Meds Pharmacy')).toBeNull()
    expect(screen.queryByText('Out of stock')).toBeNull()
  })
})

describe('each card carries that pharmacy\'s own number', () => {
  it('shows the pharmacy\'s contact number', async () => {
    result = searched([card()], 1)

    await renderSearch()

    expect(screen.getByText('+91 40 2345 6789')).toBeDefined()
  })

  it('shows it for an out-of-stock pharmacy too, so the patient can ask', async () => {
    result = searched([card({ confidence: 'low', status: 'unavailable' })], 0)

    await renderSearch()

    expect(screen.getByText('+91 40 2345 6789')).toBeDefined()
  })

  it('offers it as a dialable link', async () => {
    result = searched([card()], 1)

    await renderSearch()

    const link = screen.getByText('+91 40 2345 6789').closest('a')
    expect(link.getAttribute('href')).toBe('tel:+914023456789')
  })

  it('gives each pharmacy its own number, never the other one\'s', async () => {
    result = searched(
      [
        card(),
        card({
          id: 'ph_apollo',
          name: 'Apollo Pharmacy',
          phone: '+91 40 8888 9999',
          address: 'Prakruthi nivas, Gandimaisamma, 500043',
          distance: 7.7,
          confidence: 'moderate',
          status: 'limited',
        }),
      ],
      2,
    )

    await renderSearch()

    expect(within(cardFor('Zoiko Meds Pharmacy')).getByText('+91 40 2345 6789')).toBeDefined()
    expect(within(cardFor('Apollo Pharmacy')).getByText('+91 40 8888 9999')).toBeDefined()
  })

  it('shows no number and offers no call when the record has none', async () => {
    result = searched([card({ phone: '' })], 1)

    await renderSearch()

    // A placeholder here would be a number a patient actually dials.
    expect(screen.queryByText('Phone')).toBeNull()
    expect(screen.queryByRole('link', { name: /call/i })).toBeNull()
  })
})
