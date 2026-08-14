import { describe, expect, it } from 'vitest'
import { bestSimilarity, foldConfusions, levenshtein, similarity } from '../text-normalize'

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
