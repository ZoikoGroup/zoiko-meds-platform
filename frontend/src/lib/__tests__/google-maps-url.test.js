import { describe, it, expect } from 'vitest'
import {
  formatCoordinates,
  isShortMapsLink,
  isValidCoordinate,
  mapsLinkFor,
  parseGoogleMapsUrl,
} from '../google-maps-url'

/**
 * Reading a pharmacy's coordinates out of a Google Maps link.
 *
 * The stakes are asymmetric: failing to parse a good link is an inconvenience,
 * but parsing the wrong numbers puts a pharmacy somewhere it is not and sends
 * patients there. Everything here leans toward refusing rather than guessing.
 */

const HYD = { latitude: 17.5561, longitude: 78.4181 }

describe('the link formats Google actually produces', () => {
  it.each([
    ['desktop place URL', 'https://www.google.com/maps/place/Zoiko+Pharmacy/@17.5561,78.4181,17z/'],
    ['bare @ URL', 'https://www.google.com/maps/@17.5561,78.4181,15z'],
    ['?q= query', 'https://maps.google.com/?q=17.5561,78.4181'],
    ['?query= param', 'https://www.google.com/maps/search/?api=1&query=17.5561,78.4181'],
    ['?ll= param', 'https://maps.google.com/maps?ll=17.5561,78.4181&z=16'],
    ['directions destination', 'https://www.google.com/maps/dir/?api=1&destination=17.5561,78.4181'],
    ['url-encoded comma', 'https://www.google.com/maps?q=17.5561%2C78.4181'],
    ['coordinates in the path', 'https://www.google.com/maps/place/17.5561,78.4181'],
  ])('reads %s', (_label, url) => {
    expect(parseGoogleMapsUrl(url)).toEqual(HYD)
  })

  it('accepts a bare pair copied off the place card', () => {
    expect(parseGoogleMapsUrl('17.5561, 78.4181')).toEqual(HYD)
    expect(parseGoogleMapsUrl('  17.5561,78.4181  ')).toEqual(HYD)
  })

  it('handles southern and western hemispheres', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/@-33.8688,151.2093,15z')).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    })
    expect(parseGoogleMapsUrl('https://maps.google.com/?q=40.7128,-74.006')).toEqual({
      latitude: 40.7128,
      longitude: -74.006,
    })
  })
})

describe('the pin wins over the viewport', () => {
  it('prefers !3d/!4d to the @ centre on a place URL', () => {
    // @ is where the map was centred; 3d/4d is the pin. They differ by tens of
    // metres, and the pin is the pharmacy.
    const url =
      'https://www.google.com/maps/place/Zoiko/@17.5000,78.4000,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d17.5561!4d78.4181'
    expect(parseGoogleMapsUrl(url)).toEqual(HYD)
  })
})

describe('refusing rather than guessing', () => {
  it.each([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['a plain word', 'pharmacy'],
    ['a non-maps URL', 'https://example.com/about'],
    ['a maps URL with no coordinates', 'https://www.google.com/maps/place/Zoiko+Pharmacy'],
    ['out-of-range latitude', 'https://maps.google.com/?q=91.0,78.4181'],
    ['out-of-range longitude', 'https://maps.google.com/?q=17.5561,181.0'],
  ])('returns null for %s', (_label, input) => {
    expect(parseGoogleMapsUrl(input)).toBeNull()
  })

  it('rejects 0,0 — far more often a parse artefact than a pharmacy', () => {
    expect(parseGoogleMapsUrl('https://maps.google.com/?q=0,0')).toBeNull()
    expect(isValidCoordinate(0, 0)).toBe(false)
  })

  it('does not throw on a malformed percent-escape', () => {
    expect(() => parseGoogleMapsUrl('https://maps.google.com/?q=100%')).not.toThrow()
  })
})

describe('short share links', () => {
  it.each([
    'https://maps.app.goo.gl/AbCdEfGhIjK',
    'https://goo.gl/maps/AbCdEfGhIjK',
  ])('recognises %s as needing server resolution', (url) => {
    expect(isShortMapsLink(url)).toBe(true)
    // They genuinely carry no coordinates, so parsing must fail — that is what
    // routes them to the API rather than showing "invalid link".
    expect(parseGoogleMapsUrl(url)).toBeNull()
  })

  it('does not treat a full URL as short', () => {
    expect(isShortMapsLink('https://www.google.com/maps/@17.5561,78.4181,15z')).toBe(false)
  })
})

describe('display helpers', () => {
  it('formats a stored pair to six decimals', () => {
    expect(formatCoordinates(17.5561, 78.4181)).toBe('17.556100, 78.418100')
  })

  it('returns null instead of formatting a missing pair', () => {
    expect(formatCoordinates(null, null)).toBeNull()
    expect(formatCoordinates(undefined, 78.4)).toBeNull()
    expect(mapsLinkFor(null, null)).toBeNull()
  })

  it('builds a Maps link back to the stored pin', () => {
    expect(mapsLinkFor(17.5561, 78.4181)).toBe(
      'https://www.google.com/maps/search/?api=1&query=17.5561,78.4181',
    )
  })
})

describe('round trip', () => {
  it('parses back what mapsLinkFor produced', () => {
    const link = mapsLinkFor(HYD.latitude, HYD.longitude)
    expect(parseGoogleMapsUrl(link)).toEqual(HYD)
  })
})
