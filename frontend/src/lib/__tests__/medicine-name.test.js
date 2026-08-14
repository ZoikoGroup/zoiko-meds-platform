import { describe, expect, it } from 'vitest'
import { isMedicineSaved, normalizeMedicineKey } from '../medicine-name'

describe('normalizeMedicineKey', () => {
  it('collapses case, spacing and punctuation', () => {
    const key = normalizeMedicineKey('Volini Gel')
    expect(normalizeMedicineKey('volini gel')).toBe(key)
    expect(normalizeMedicineKey('  VOLINI-GEL ')).toBe(key)
    expect(key).toBe('volinigel')
  })

  it('keeps genuinely different medicines apart', () => {
    expect(normalizeMedicineKey('Volini Gel')).not.toBe(normalizeMedicineKey('Volini Spray'))
  })

  it('matches the API normalizer, so client and server agree', () => {
    // Same rule as normalizeMedicineName in
    // backend/src/modules/saved-link/saved-medicine-link.service.ts
    expect(normalizeMedicineKey('Amoxicillin 500 mg')).toBe('amoxicillin500mg')
    expect(normalizeMedicineKey('###')).toBe('')
  })
})

describe('isMedicineSaved', () => {
  const SAVED = [
    { id: 'med_1', name: 'Amoxicillin 500 mg' },
    { id: null, name: 'Volini Gel' },
  ]

  it('matches a catalog medicine by its MediBase id', () => {
    expect(isMedicineSaved(SAVED, { id: 'med_1', name: 'Amoxicillin 500 mg' })).toBe(true)
    expect(isMedicineSaved(SAVED, { id: 'med_other', name: 'Something else' })).toBe(false)
  })

  it('matches an off-catalog medicine by normalized name', () => {
    // The saved row has no id, and neither does the search result.
    expect(isMedicineSaved(SAVED, { id: null, name: 'volini gel' })).toBe(true)
    expect(isMedicineSaved(SAVED, { id: null, name: 'VOLINI-GEL' })).toBe(true)
    expect(isMedicineSaved(SAVED, { id: null, name: 'Volini Spray' })).toBe(false)
  })

  it('still reads as saved once a pharmacy links the medicine', () => {
    // The saved row gained an id; the search result has one too now.
    const linked = [{ id: 'med_volini', name: 'Volini Gel' }]
    expect(isMedicineSaved(linked, { id: 'med_volini', name: 'Volini Gel' })).toBe(true)
    // And from a stale client that still has no id for it.
    expect(isMedicineSaved(linked, { id: null, name: 'Volini Gel' })).toBe(true)
  })

  it('is false for an empty list or a nameless medicine', () => {
    expect(isMedicineSaved([], { id: 'med_1', name: 'X' })).toBe(false)
    expect(isMedicineSaved(SAVED, {})).toBe(false)
    expect(isMedicineSaved(undefined, { name: 'Volini Gel' })).toBe(false)
  })
})
