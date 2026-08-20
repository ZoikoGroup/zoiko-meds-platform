import { describe, expect, it } from 'vitest'
import { AVAILABILITY, availabilityMeta, byConfidence } from '../availability'

// What a patient reads off each governed confidence band.
//
// HIGH → High, MODERATE → Moderate, and LOW/UNKNOWN → Out of stock, because
// that is what the pharmacy said: the portal writes LOW when an operator sets a
// medicine to Out of stock, and UNKNOWN carries no availability the pharmacy
// stands behind. SUPPRESSED never reaches the client at all.
describe('availability band labels', () => {
  it('reads HIGH as High', () => {
    expect(availabilityMeta('high').label).toBe('High')
    expect(availabilityMeta('high').plain).toBe('Likely available now')
  })

  it('reads MODERATE as Moderate', () => {
    expect(availabilityMeta('moderate').label).toBe('Moderate')
  })

  it('reads LOW as Out of stock', () => {
    expect(availabilityMeta('low').label).toBe('Out of stock')
    expect(availabilityMeta('low').plain).toBe('Out of stock')
  })

  it('reads UNKNOWN as Out of stock', () => {
    expect(availabilityMeta('unknown').label).toBe('Out of stock')
  })

  it('has no band that says anything about exact stock counts', () => {
    for (const band of Object.values(AVAILABILITY)) {
      expect(band.plain).not.toMatch(/\d+\s*(units|packs|boxes|in stock)/i)
    }
  })

  it('gives every band a badge tone, so none renders colourless', () => {
    for (const band of Object.values(AVAILABILITY)) {
      expect(['good', 'warning', 'serious', 'critical', 'neutral']).toContain(band.tone)
    }
  })

  it('falls back to the out-of-stock reading for an unrecognised band', () => {
    // Never a blank badge, and never an optimistic one.
    expect(availabilityMeta(undefined).label).toBe('Out of stock')
    expect(availabilityMeta('nonsense').label).toBe('Out of stock')
  })

  it('still ranks the strongest band first', () => {
    expect(['unknown', 'high', 'low', 'moderate'].sort(byConfidence)).toEqual([
      'high',
      'moderate',
      'low',
      'unknown',
    ])
  })
})
