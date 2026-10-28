import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCATION_OPTIONS,
  LocationError,
  describeLocationFailure,
  getCurrentLocation,
  locationServicesEnabled,
  readBrowserLocation,
} from '@/lib/current-location'

/**
 * Telling location failures apart.
 *
 * Both location buttons used to answer every failure with one sentence, so a
 * person whose phone had Location switched off was told the same thing as one
 * who had refused permission — and neither was told what to do. These tests
 * hold each cause to its own reason and message.
 *
 * The plugin branch of getCurrentLocation sits behind __ZM_NATIVE__, which
 * these tests compile to false, as the website does. The plugin's error codes
 * are tested through describeLocationFailure, which is what that branch uses.
 */

const coded = (code) => Object.assign(new Error('failed'), { code })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('describeLocationFailure — the browser', () => {
  it.each([
    [1, 'permission-denied', 'locationPermissionDenied'],
    [2, 'unavailable', 'locationUnavailable'],
    [3, 'timeout', 'locationTimeout'],
  ])('reads GeolocationPositionError code %i as %s', (code, reason, key) => {
    const failure = describeLocationFailure(coded(code))
    expect(failure.reason).toBe(reason)
    expect(failure.key).toBe(key)
  })
})

describe('describeLocationFailure — the Android plugin', () => {
  it.each([
    ['OS-PLUG-GLOC-0003', 'permission-denied'],
    // Four ways of saying "Location is off", one message.
    ['OS-PLUG-GLOC-0007', 'services-disabled'],
    ['OS-PLUG-GLOC-0009', 'services-disabled'],
    ['OS-PLUG-GLOC-0016', 'services-disabled'],
    ['OS-PLUG-GLOC-0017', 'services-disabled'],
    ['OS-PLUG-GLOC-0010', 'timeout'],
    ['OS-PLUG-GLOC-0002', 'unavailable'],
    ['OS-PLUG-GLOC-0014', 'unavailable'],
    ['OS-PLUG-GLOC-0015', 'unavailable'],
  ])('reads %s as %s', (code, reason) => {
    expect(describeLocationFailure(coded(code)).reason).toBe(reason)
  })

  it('reads a build without the location permission as unavailable to the person', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(describeLocationFailure(coded('OS-PLUG-GLOC-0018')).reason).toBe('unsupported')
    // The person cannot fix this, but a developer reading the console can.
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('describeLocationFailure — everything else', () => {
  it('never reads an unknown failure as success, and never says nothing', () => {
    for (const err of [undefined, null, new Error('boom'), coded('OS-PLUG-GLOC-9999'), coded(42)]) {
      const failure = describeLocationFailure(err)
      expect(failure.reason).toBe('unavailable')
      expect(failure.fallback).toBeTruthy()
    }
  })

  it('passes a failure that is already classified straight through', () => {
    const err = new LocationError({ reason: 'timeout', key: 'locationTimeout', fallback: 'Too slow.' })
    expect(describeLocationFailure(err)).toEqual({ reason: 'timeout', key: 'locationTimeout', fallback: 'Too slow.' })
  })

  it('offers typing a place in every message, because the device is never required', () => {
    for (const code of [1, 2, 3, 'OS-PLUG-GLOC-0007']) {
      expect(describeLocationFailure(coded(code)).fallback).toMatch(/enter your location/i)
    }
  })

  it('tells "Location is off" apart from "permission refused"', () => {
    const off = describeLocationFailure(coded('OS-PLUG-GLOC-0007'))
    const refused = describeLocationFailure(coded('OS-PLUG-GLOC-0003'))
    expect(off.fallback).not.toBe(refused.fallback)
    expect(off.fallback).toMatch(/turned off/i)
    expect(refused.fallback).toMatch(/denied/i)
  })
})

describe('readBrowserLocation', () => {
  const geolocation = (outcome) => ({
    getCurrentPosition: vi.fn((ok, fail, options) => {
      geolocation.lastOptions = options
      if (outcome.coords) ok({ coords: outcome.coords })
      else fail(outcome.error)
    }),
  })

  it('returns the actual coordinates', async () => {
    const geo = geolocation({ coords: { latitude: 17.4948, longitude: 78.3996, accuracy: 25 } })
    await expect(readBrowserLocation(geo)).resolves.toEqual({ lat: 17.4948, lng: 78.3996, accuracy: 25 })
  })

  it('asks with the shared options', async () => {
    const geo = geolocation({ coords: { latitude: 1, longitude: 2 } })
    await readBrowserLocation(geo)
    expect(geo.getCurrentPosition.mock.calls[0][2]).toEqual(LOCATION_OPTIONS)
  })

  it('gives fifteen seconds and accepts a fix up to a minute old', () => {
    expect(LOCATION_OPTIONS.timeout).toBe(15000)
    expect(LOCATION_OPTIONS.maximumAge).toBe(60000)
  })

  it('rejects a refusal as permission-denied', async () => {
    const geo = geolocation({ error: coded(1) })
    await expect(readBrowserLocation(geo)).rejects.toMatchObject({ reason: 'permission-denied' })
  })

  it('rejects a slow fix as a timeout, distinct from unavailable', async () => {
    await expect(readBrowserLocation(geolocation({ error: coded(3) }))).rejects.toMatchObject({ reason: 'timeout' })
    await expect(readBrowserLocation(geolocation({ error: coded(2) }))).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('rejects as unsupported when there is no geolocation at all', async () => {
    const err = await readBrowserLocation(undefined).catch((e) => e)
    expect(err).toBeInstanceOf(LocationError)
    expect(err.reason).toBe('unsupported')
  })
})

describe('on the website', () => {
  it('uses the browser, and returns its coordinates — never a guess', async () => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 12.97, longitude: 77.59 } }) },
    })
    await expect(getCurrentLocation()).resolves.toEqual({ lat: 12.97, lng: 77.59, accuracy: null })
  })

  it('reports an unsupported browser instead of inventing a location', async () => {
    vi.stubGlobal('navigator', {})
    await expect(getCurrentLocation()).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('cannot know whether Location is switched on, and says so', async () => {
    await expect(locationServicesEnabled()).resolves.toBeNull()
  })
})
