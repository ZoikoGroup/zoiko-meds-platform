import { describe, expect, it } from 'vitest'
import {
  BAND,
  HIGH_THRESHOLD,
  MATCH_SOURCE,
  bandFor,
  computeConfidence,
  needsConfirmation,
} from '../confidence'

const fullEvidence = {
  formPrefix: true,
  form: true,
  strength: true,
  frequency: true,
  inMedicineSection: true,
}

describe('computeConfidence', () => {
  it('scores an exact catalog match with full structure in the high band', () => {
    const confidence = computeConfidence({
      nameSimilarity: 1,
      source: MATCH_SOURCE.MEDIBASE_EXACT,
      evidence: fullEvidence,
      ocrConfidence: 0.95,
    })
    expect(bandFor(confidence)).toBe(BAND.HIGH)
    expect(needsConfirmation(confidence, MATCH_SOURCE.MEDIBASE_EXACT)).toBe(false)
  })

  it('drops a weak name match out of the auto-accept band', () => {
    const confidence = computeConfidence({
      nameSimilarity: 0.65,
      source: MATCH_SOURCE.MEDIBASE_FUZZY,
      evidence: { form: true },
      ocrConfidence: 0.6,
    })
    expect(confidence).toBeLessThan(HIGH_THRESHOLD)
    expect(needsConfirmation(confidence, MATCH_SOURCE.MEDIBASE_FUZZY)).toBe(true)
  })

  it('penalises a perfect name read off a barely legible scan', () => {
    const clean = computeConfidence({
      nameSimilarity: 1,
      source: MATCH_SOURCE.MEDIBASE_EXACT,
      evidence: fullEvidence,
      ocrConfidence: 0.95,
    })
    const smudged = computeConfidence({
      nameSimilarity: 1,
      source: MATCH_SOURCE.MEDIBASE_EXACT,
      evidence: fullEvidence,
      ocrConfidence: 0.25,
    })
    expect(smudged).toBeLessThan(clean)
  })

  it('never auto-accepts a medicine absent from the catalog', () => {
    const confidence = computeConfidence({
      nameSimilarity: 1,
      source: MATCH_SOURCE.UNMATCHED,
      evidence: fullEvidence,
    })
    expect(needsConfirmation(confidence, MATCH_SOURCE.UNMATCHED)).toBe(true)
    expect(bandFor(confidence)).not.toBe(BAND.HIGH)
  })

  it('never auto-accepts an assisted-reading result', () => {
    const confidence = computeConfidence({
      nameSimilarity: 0.95,
      source: MATCH_SOURCE.VISION,
      evidence: fullEvidence,
    })
    expect(needsConfirmation(confidence, MATCH_SOURCE.VISION)).toBe(true)
  })

  it('ranks an offline-dictionary match below a catalog match', () => {
    const args = { nameSimilarity: 1, evidence: fullEvidence, ocrConfidence: 0.9 }
    expect(computeConfidence({ ...args, source: MATCH_SOURCE.OFFLINE_DICTIONARY })).toBeLessThan(
      computeConfidence({ ...args, source: MATCH_SOURCE.MEDIBASE_EXACT }),
    )
  })

  it('rejects a structureless, unmatched reading outright', () => {
    const confidence = computeConfidence({
      nameSimilarity: 0.4,
      source: MATCH_SOURCE.UNMATCHED,
      evidence: {},
      ocrConfidence: 0.3,
    })
    expect(bandFor(confidence)).toBe(BAND.REJECTED)
  })

  it('is monotonic in name similarity', () => {
    const at = (nameSimilarity) =>
      computeConfidence({ nameSimilarity, source: MATCH_SOURCE.MEDIBASE_FUZZY, evidence: fullEvidence })
    expect(at(0.9)).toBeGreaterThan(at(0.7))
    expect(at(0.7)).toBeGreaterThan(at(0.5))
  })
})
