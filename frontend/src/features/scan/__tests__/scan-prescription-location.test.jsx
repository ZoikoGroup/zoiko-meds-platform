// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The scan panel's "Use my current location".
 *
 * This is where the reported message came from: "Could not access your
 * location. Enter it manually." for every failure, whatever the cause. On
 * success it was worse — the position was thrown away and the words "Current
 * location" were stored in its place.
 *
 * Inside the search page the panel now hands the request to the page, so the
 * coordinates reach the search (see user-search-location.test.jsx). On its own
 * it still answers the request itself, correctly. Both are held here.
 */

const getCurrentLocationMock = vi.hoisted(() => vi.fn())
const reverseGeocodeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/current-location', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getCurrentLocation: (...args) => getCurrentLocationMock(...args) }
})
vi.mock('@/lib/geocode', () => ({ reverseGeocode: (...args) => reverseGeocodeMock(...args) }))
vi.mock('@/services/medicine-api', () => ({ matchMedicines: vi.fn() }))
vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

const { ScanPrescription } = await import('../scan-prescription')
const { LocationError, describeLocationFailure } = await import('@/lib/current-location')

const failWith = (code) => new LocationError(describeLocationFailure(Object.assign(new Error('x'), { code })))
const field = () => screen.getByLabelText(/your location \(for nearby search\)/i)
const locateButton = () => screen.getByRole('button', { name: /use my current location/i })

let flash
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  flash = vi.fn()
  getCurrentLocationMock.mockResolvedValue({ lat: 17.4948, lng: 78.3996, accuracy: 20 })
  reverseGeocodeMock.mockResolvedValue('Bachupally, Telangana')
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('on its own', () => {
  it('fills the field with the place it found — never the words "Current location"', async () => {
    const user = userEvent.setup()
    render(<ScanPrescription flash={flash} />)

    await user.click(locateButton())

    await waitFor(() => expect(field().value).toBe('Bachupally, Telangana'))
    expect(localStorage.getItem('zoiko-user-loc')).toBe('Bachupally, Telangana')
    expect(flash).toHaveBeenCalledWith('Using your current location')
  })

  it('no longer answers every failure with "Could not access your location"', async () => {
    const user = userEvent.setup()
    for (const [code, expected] of [
      ['OS-PLUG-GLOC-0003', /permission was denied/i],
      ['OS-PLUG-GLOC-0007', /location is turned off/i],
      ['OS-PLUG-GLOC-0010', /took too long/i],
      [2, /couldn't be determined/i],
    ]) {
      flash.mockClear()
      getCurrentLocationMock.mockRejectedValueOnce(failWith(code))
      render(<ScanPrescription flash={flash} />)

      await user.click(locateButton())

      await waitFor(() => expect(flash).toHaveBeenCalledTimes(1))
      expect(flash.mock.calls[0][0]).toMatch(expected)
      expect(flash.mock.calls[0][0]).not.toMatch(/could not access your location/i)
      cleanup()
    }
  })

  it('keeps the coordinates when the place name cannot be looked up', async () => {
    reverseGeocodeMock.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ScanPrescription flash={flash} />)

    await user.click(locateButton())

    await waitFor(() => expect(field().value).toBe('17.4948, 78.3996'))
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/couldn't look up the place name/i))
  })

  it('leaves the button usable again after a failure', async () => {
    getCurrentLocationMock.mockRejectedValueOnce(failWith('OS-PLUG-GLOC-0010'))
    const user = userEvent.setup()
    render(<ScanPrescription flash={flash} />)

    await user.click(locateButton())
    await waitFor(() => expect(flash).toHaveBeenCalled())

    expect(locateButton().disabled).toBe(false)
  })
})

describe('inside a page that owns the location', () => {
  const page = () => ({
    location: 'Gummadidala, Telangana',
    onLocationChange: vi.fn(),
    onUseMyLocation: vi.fn(),
    locating: false,
  })

  it('shows the page’s location, not a copy of its own', () => {
    render(<ScanPrescription flash={flash} {...page()} />)
    expect(field().value).toBe('Gummadidala, Telangana')
  })

  it('hands typing to the page, so the search uses it', async () => {
    const props = page()
    const user = userEvent.setup()
    render(<ScanPrescription flash={flash} {...props} location="" />)

    await user.type(field(), 'H')

    expect(props.onLocationChange).toHaveBeenCalledWith('H')
  })

  it('hands the location request to the page, and asks the device nothing itself', async () => {
    const props = page()
    const user = userEvent.setup()
    render(<ScanPrescription flash={flash} {...props} />)

    await user.click(locateButton())

    expect(props.onUseMyLocation).toHaveBeenCalledWith({ announce: true })
    expect(getCurrentLocationMock).not.toHaveBeenCalled()
  })

  it('shows the page’s progress on the button', () => {
    render(<ScanPrescription flash={flash} {...page()} locating />)
    expect(locateButton().disabled).toBe(true)
  })
})
