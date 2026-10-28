// @vitest-environment jsdom
//
// "Use my current location", end to end through the search page.
//
// The reported failure was on the scan panel, and it was two bugs. Every
// failure — permission refused, Location switched off, a slow fix — produced
// one sentence. And when it worked, the panel threw the coordinates away and
// stored the words "Current location" in a copy of the location the search
// never read, so the scanned medicine was searched somewhere else, or nowhere.
//
// The panel now acts on this page's location. These tests hold the page to
// that: coordinates found from either button reach the search, typing a place
// switches them off, each failure says what happened, and turning Location on
// in Settings is picked up when the person comes back — once, without asking.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getCurrentLocationMock = vi.hoisted(() => vi.fn())
const servicesEnabledMock = vi.hoisted(() => vi.fn())
const reverseGeocodeMock = vi.hoisted(() => vi.fn())
const resume = vi.hoisted(() => ({ callbacks: [], armed: 0 }))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))
vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))
vi.mock('@/hooks/use-medicine-suggestions', () => ({
  useMedicineSuggestions: () => ({ suggestions: [], loading: false, error: null }),
}))
vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({ data: [] }),
  useSaveMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnsaveMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/location-data', () => ({ validateLocation: async () => ({ isValid: true }) }))
vi.mock('@/lib/geocode', () => ({ reverseGeocode: (...args) => reverseGeocodeMock(...args) }))

// Only the device is faked. How a failure is classified and worded is the
// real module's.
vi.mock('@/lib/current-location', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getCurrentLocation: (...args) => getCurrentLocationMock(...args),
    locationServicesEnabled: (...args) => servicesEnabledMock(...args),
  }
})
vi.mock('@/lib/native', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    onAppResume: (callback) => {
      resume.armed += 1
      resume.callbacks.push(callback)
      return () => {
        resume.callbacks = resume.callbacks.filter((c) => c !== callback)
      }
    },
  }
})

const searchMock = vi.fn(async ({ q }) => ({ medicine: q, items: [], availableCount: 0, total: 0, internet: null }))
vi.mock('@/services/nearby-availability', () => ({
  searchNearbyAvailability: (...args) => searchMock(...args),
}))

// A stand-in for the scan panel that uses exactly the props the real one does
// for location, so this tests the page's wiring rather than the panel's markup.
vi.mock('@/features/scan/scan-prescription', () => ({
  ScanPrescription: ({ onSearchMedicine, location, onLocationChange, onUseMyLocation, locating }) => (
    <div>
      <input aria-label="scan location" value={location ?? ''} onChange={(e) => onLocationChange(e.target.value)} />
      <button type="button" disabled={locating} onClick={() => onUseMyLocation({ announce: true })}>
        scan: use my current location
      </button>
      <button type="button" onClick={() => onSearchMedicine({ name: 'Metformin 500 mg', needsConfirmation: false })}>
        scan: search detected medicine
      </button>
    </div>
  ),
}))

const { default: UserSearch } = await import('../UserSearch')
const { LocationError, describeLocationFailure } = await import('@/lib/current-location')

const HERE = { lat: 17.4948, lng: 78.3996, accuracy: 20 }
/** A failure as the real getCurrentLocation raises it. */
const failWith = (code) => new LocationError(describeLocationFailure(Object.assign(new Error('x'), { code })))
const lastSearch = () => searchMock.mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resume.callbacks = []
  resume.armed = 0
  getCurrentLocationMock.mockResolvedValue(HERE)
  reverseGeocodeMock.mockResolvedValue('Bachupally, Telangana')
  servicesEnabledMock.mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('the scan panel’s location reaches the search', () => {
  it('searches the scanned medicine at the coordinates the device returned', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await waitFor(() => expect(screen.getByLabelText('scan location').value).toBe('Bachupally, Telangana'))
    await user.click(screen.getByText('scan: search detected medicine'))

    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    // Coordinates, not a place name for the server to guess at.
    expect(lastSearch()).toMatchObject({ lat: HERE.lat, lng: HERE.lng, city: undefined })
  })

  it('never stores the words "Current location"', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))

    await waitFor(() => expect(getCurrentLocationMock).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem('zoiko-user-loc')).toBe('Bachupally, Telangana'))
    expect(screen.getByLabelText('scan location').value).not.toBe('Current location')
  })

  it('confirms success out loud on the scan panel, which has no indicator of its own', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)
    // In scan mode, as the person is: the search form — and its own "Using
    // your current location" line — is not on screen, so only the toast says it.
    await user.click(screen.getByRole('button', { name: 'Scan prescription' }))
    expect(screen.queryByLabelText('Search area')).toBeNull()

    await user.click(screen.getByText('scan: use my current location'))

    expect(await screen.findByText('Using your current location')).toBeDefined()
  })

  it('searches a place typed on the scan panel, which it used to ignore', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.type(screen.getByLabelText('scan location'), 'Hyderabad')
    await user.click(screen.getByText('scan: search detected medicine'))

    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    expect(lastSearch()).toMatchObject({ city: 'Hyderabad', lat: undefined, lng: undefined })
  })

  it('switches the coordinates off when a place is typed afterwards', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await waitFor(() => expect(screen.getByLabelText('scan location').value).toBe('Bachupally, Telangana'))
    await user.clear(screen.getByLabelText('scan location'))
    await user.type(screen.getByLabelText('scan location'), 'Hyderabad')
    await user.click(screen.getByText('scan: search detected medicine'))

    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    expect(lastSearch()).toMatchObject({ city: 'Hyderabad', lat: undefined, lng: undefined })
  })
})

describe('the search form’s own button still works', () => {
  it('fills the field and searches at the coordinates', async () => {
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByRole('button', { name: /use my location/i }))
    await waitFor(() => expect(screen.getByLabelText('Search area').value).toBe('Bachupally, Telangana'))
    expect(screen.getByText('Using your current location')).toBeDefined()

    await user.type(screen.getByLabelText('Medicine name'), 'Dolo 650')
    await user.click(screen.getByRole('button', { name: /search availability/i }))

    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    expect(lastSearch()).toMatchObject({ lat: HERE.lat, lng: HERE.lng })
  })
})

describe('each failure says what happened', () => {
  it.each([
    ['permission refused', 'OS-PLUG-GLOC-0003', /permission was denied/i],
    ['Location switched off', 'OS-PLUG-GLOC-0007', /location is turned off/i],
    ['the turn-on-location dialog declined', 'OS-PLUG-GLOC-0009', /location is turned off/i],
    ['no fix available', 'OS-PLUG-GLOC-0002', /couldn't be determined/i],
    ['too slow', 'OS-PLUG-GLOC-0010', /took too long/i],
    ['a browser refusal', 1, /permission was denied/i],
    ['a browser timeout', 3, /took too long/i],
  ])('%s', async (_label, code, message) => {
    getCurrentLocationMock.mockRejectedValue(failWith(code))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))

    expect(await screen.findByText(message)).toBeDefined()
    // Manual entry is untouched and still offered.
    expect(screen.getByLabelText('scan location').disabled).toBe(false)
  })

  it('reports an unsupported device rather than guessing a place', async () => {
    getCurrentLocationMock.mockRejectedValue(
      new LocationError({ reason: 'unsupported', key: 'locationUnsupported', fallback: "Location isn't available on this device. Enter your location instead." }),
    )
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))

    expect(await screen.findByText(/isn't available on this device/i)).toBeDefined()
    expect(localStorage.getItem('zoiko-user-loc')).toBeNull()
  })

  it('keeps the coordinates when only the place name could not be looked up', async () => {
    reverseGeocodeMock.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))

    expect(await screen.findByText(/couldn't look up the place name/i)).toBeDefined()
    expect(screen.getByLabelText('scan location').value).toBe('17.4948, 78.3996')
    await user.click(screen.getByText('scan: search detected medicine'))
    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    expect(lastSearch()).toMatchObject({ lat: HERE.lat, lng: HERE.lng })
  })
})

describe('coming back from Settings', () => {
  const comeBack = () => act(async () => {
    await Promise.all(resume.callbacks.map((callback) => callback()))
  })

  it('tries again once, if Location is now on', async () => {
    getCurrentLocationMock.mockRejectedValueOnce(failWith('OS-PLUG-GLOC-0007'))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await screen.findByText(/location is turned off/i)
    expect(resume.armed).toBe(1)

    servicesEnabledMock.mockResolvedValue(true)
    await comeBack()

    await waitFor(() => expect(getCurrentLocationMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText('scan location').value).toBe('Bachupally, Telangana'))
    // Spent: a second return to the app does nothing.
    expect(resume.callbacks).toHaveLength(0)
  })

  it('does not ask again if Location is still off', async () => {
    getCurrentLocationMock.mockRejectedValue(failWith('OS-PLUG-GLOC-0007'))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await screen.findByText(/location is turned off/i)

    servicesEnabledMock.mockResolvedValue(false)
    await comeBack()

    expect(getCurrentLocationMock).toHaveBeenCalledTimes(1)
    expect(resume.callbacks).toHaveLength(0)
  })

  it('does not wait for Settings after a refused permission', async () => {
    // Nothing in Settings changes on its own here; retrying would just ask again.
    getCurrentLocationMock.mockRejectedValue(failWith('OS-PLUG-GLOC-0003'))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await screen.findByText(/permission was denied/i)

    expect(resume.armed).toBe(0)
  })

  it('stops waiting once the person types a place themselves', async () => {
    // Typing is a choice. A retry that fired after it would replace the place
    // they typed with wherever the phone is — the opposite of what they asked.
    getCurrentLocationMock.mockRejectedValueOnce(failWith('OS-PLUG-GLOC-0007'))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await screen.findByText(/location is turned off/i)
    await user.type(screen.getByLabelText('scan location'), 'Hyderabad')
    await comeBack()

    expect(getCurrentLocationMock).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('scan location').value).toBe('Hyderabad')
  })

  it('stops waiting once the person asks again themselves', async () => {
    getCurrentLocationMock.mockRejectedValueOnce(failWith('OS-PLUG-GLOC-0007'))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await screen.findByText(/location is turned off/i)
    await user.click(screen.getByText('scan: use my current location'))
    await waitFor(() => expect(getCurrentLocationMock).toHaveBeenCalledTimes(2))
    await comeBack()

    // Two requests, both from the person. The return to the app adds none.
    expect(getCurrentLocationMock).toHaveBeenCalledTimes(2)
  })
})

describe('a late answer does not overwrite what was typed', () => {
  it('keeps the typed place when the name lookup finishes afterwards', async () => {
    let finishLookup
    reverseGeocodeMock.mockReturnValue(new Promise((resolve) => { finishLookup = resolve }))
    const user = userEvent.setup()
    render(<UserSearch />)

    await user.click(screen.getByText('scan: use my current location'))
    await waitFor(() => expect(screen.getByLabelText('scan location').value).toBe('17.4948, 78.3996'))
    await user.clear(screen.getByLabelText('scan location'))
    await user.type(screen.getByLabelText('scan location'), 'Hyderabad')

    await act(async () => finishLookup('Bachupally, Telangana'))

    expect(screen.getByLabelText('scan location').value).toBe('Hyderabad')
  })
})
