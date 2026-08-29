import { describe, expect, it } from 'vitest'
import {
  bestSimilarity,
  containsName,
  foldConfusions,
  levenshtein,
  repairStrengthText,
  similarity,
} from '../text-normalize'

describe('OCR error correction', () => {
  it('treats capital-I / lowercase-l / digit-1 as the same glyph', () => {
    // The canonical OCR failure: "ParacetamoI" (capital i) for "Paracetamol".
    expect(foldConfusions('ParacetamoI')).toBe(foldConfusions('Paracetamol'))
    expect(similarity('ParacetamoI', 'Paracetamol')).toBeGreaterThan(0.95)
  })

  it('recovers a dropped letter — Amoxcillin → Amoxicillin', () => {
    expect(similarity('Amoxcillin', 'Amoxicillin')).toBeGreaterThan(0.9)
  })

  it('folds the other common confusion pairs', () => {
    expect(similarity('Metf0rmin', 'Metformin')).toBeGreaterThan(0.95) // 0 / O
    expect(similarity('Omepraz0le', 'Omeprazole')).toBeGreaterThan(0.95)
    expect(similarity('Ibuprofen', 'lbuprofen')).toBeGreaterThan(0.95) // I / l
    expect(similarity('Ceftriax0ne', 'Ceftriaxone')).toBeGreaterThan(0.95)
  })

  it('collapses the rn/m ligature', () => {
    expect(similarity('Metforrnin', 'Metformin')).toBeGreaterThan(0.95)
  })

  it('still separates genuinely different medicines', () => {
    // Folding must not make everything match everything.
    expect(similarity('Amoxicillin', 'Azithromycin')).toBeLessThan(0.6)
    expect(similarity('Metformin', 'Metoprolol')).toBeLessThan(0.75)
    expect(similarity('Paracetamol', 'Pantoprazole')).toBeLessThan(0.7)
  })

  it('ranks an exact match above a fold-only match', () => {
    expect(similarity('Paracetamol', 'Paracetamol')).toBe(1)
    expect(similarity('ParacetamoI', 'Paracetamol')).toBeLessThan(1)
  })
})

describe('bestSimilarity', () => {
  it('picks the closest of a name, its generic and its brands', () => {
    const result = bestSimilarity('Augmentin', ['Amoxicillin/Clavulanate', 'Augmentin', 'Clavam'])
    expect(result.reference).toBe('Augmentin')
    expect(result.score).toBe(1)
  })
})

describe('levenshtein', () => {
  it('computes standard edit distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('same', 'same')).toBe(0)
  })
})

describe('containsName — the shortcut that must not fire on noise', () => {
  it('accepts a substantial whole-token containment', () => {
    // The case the shortcut exists for: a generic inside a combination name.
    expect(containsName('amoxicillin', 'Amoxicillin Clavulanate')).toBe(true)
    expect(containsName('Dolo', 'Dolo 650')).toBe(true)
  })

  it('refuses a three-letter OCR fragment against a longer medicine', () => {
    // "Pan" satisfied includes() against every catalog entry containing those
    // letters, and the caller then promoted it to 0.95 — a garbled reading
    // presented as a confident, and different, medicine.
    expect(containsName('Pan', 'Pantoprazole')).toBe(false)
    expect(containsName('Met', 'Metformin')).toBe(false)
    expect(containsName('Ome', 'Omeprazole')).toBe(false)
  })

  it('refuses a short fragment even when it IS a whole token of the reference', () => {
    expect(containsName('Pan', 'Pan 40')).toBe(false)
  })

  it('refuses a prefix that is not a whole token', () => {
    // "Amox" is four characters, so length alone would let it through; it is
    // still only part of a word OCR did not finish reading.
    expect(containsName('Amox', 'Amoxicillin')).toBe(false)
  })

  it('guards the candidate as well as the reference', () => {
    // Previously only the reference was length-checked, so the guard missed
    // the side that actually came from OCR.
    expect(containsName('Pan', 'Pan')).toBe(true) // identical is still identical
    expect(containsName('Pan', 'Panadol Extra')).toBe(false)
  })

  it('can be lowered by a caller holding corroborating evidence', () => {
    expect(containsName('Pan 40', 'Pan 40 mg', { minChars: 3 })).toBe(true)
  })

  it('is symmetric', () => {
    expect(containsName('Amoxicillin Clavulanate', 'amoxicillin')).toBe(true)
  })
})

describe('repairStrengthText — OCR damage inside a dose', () => {
  it('reads a letter O back as a zero', () => {
    expect(repairStrengthText('Paracetamol 65O mg')).toBe('Paracetamol 650 mg')
  })

  it('reads the rn ligature back as an m', () => {
    expect(repairStrengthText('Paracetamol 650 rng')).toBe('Paracetamol 650 mg')
  })

  it('handles both at once', () => {
    expect(repairStrengthText('65O rng')).toBe('650 mg')
  })

  it('repairs l/I/S inside a number that already has digits', () => {
    expect(repairStrengthText('Amoxicillin 5OO mg')).toBe('Amoxicillin 500 mg')
    expect(repairStrengthText('Cetirizine 1O mg')).toBe('Cetirizine 10 mg')
  })

  it('refuses to invent a number from letters alone', () => {
    // No digit in the run means no evidence of a number — a guess here would
    // put a dose on the page that nobody wrote.
    expect(repairStrengthText('OO mg')).toBe('OO mg')
    expect(repairStrengthText('SOS ml')).toBe('SOS ml')
  })

  it('leaves the medicine name alone', () => {
    // The repair is scoped to a numeric run before a unit; a name that happens
    // to contain those letters must not be rewritten.
    expect(repairStrengthText('Losartan 50 mg')).toBe('Losartan 50 mg')
    expect(repairStrengthText('Iron Folic Acid')).toBe('Iron Folic Acid')
  })

  it('leaves text with no strength untouched', () => {
    expect(repairStrengthText('Tab Amoxicillin BD')).toBe('Tab Amoxicillin BD')
    expect(repairStrengthText('')).toBe('')
  })
})
