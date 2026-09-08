// A prescription that numbers its rows tells you how many medicines it has.
//
// Two things were wrong with how that was checked.
//
// The tolerance was two, so a four-medicine prescription that produced three
// medicines was reported as a good scan — the patient saw three cards and
// nothing to suggest a fourth had been missed. A missing medicine is the most
// consequential thing this feature can get wrong.
//
// And the comparison counted every medicine in the list, not the prescribed
// ones. A composition line promoted to its own card, or a stray candidate the
// line scorer picked up, inflates that count: four rows that lost two medicines
// but gained three ingredient names came out at five and read as a good scan.
// Padding is not recovery.

import { describe, expect, it } from 'vitest'
import { ROW_SHORTFALL, assessScanQuality, countNumberedRows } from '../scan-quality'

/** A four-row prescription, each row carrying a composition line under it. */
const FOUR_ROWS = [
  '1) TAB. ABCIXIMAB',
  '2) TAB. VOMILAST',
  'DOXYLAMINE 10 MG + PYRIDOXINE 10 MG',
  '3) CAP. ZOCLAR 500',
  'CLARITHROMYCIN IP 500MG',
  '4) TAB. GESTAKIND 10/SR',
  'ISOXSUPRINE 10 MG',
].join('\n')

const medicine = (name) => ({
  name,
  confidence: 0.8,
  medicineId: `m_${name}`,
  needsConfirmation: false,
  source: 'medibase-exact',
})

const assess = (names, primaryCount, rawText = FOUR_ROWS) =>
  assessScanQuality({
    rawText,
    ocrConfidence: null,
    candidateCount: names.length,
    medicines: names.map(medicine),
    primaryCount,
  })

const PRIMARIES = ['Abciximab', 'Vomilast', 'Zoclar 500', 'Gestakind 10/SR']
const COMPOSITIONS = ['Doxylamine', 'Clarithromycin', 'Isoxsuprine']

describe('the page declares how many medicines it has', () => {
  it('counts the numbered rows', () => {
    expect(countNumberedRows(FOUR_ROWS)).toBe(4)
  })

  it('tolerates no unaccounted row', () => {
    expect(ROW_SHORTFALL).toBe(1)
  })
})

describe('8A. every row came out', () => {
  it('is a good scan', () => {
    const result = assess(PRIMARIES, 4)

    expect(result.quality).toBe('good')
    expect(result.reasons).toEqual([])
  })
})

describe('8B. one medicine missing', () => {
  const result = () => assess(PRIMARIES.slice(0, 3), 3)

  it('is no longer called good', () => {
    // The defect, stated directly. This reported "good" before.
    expect(result().quality).not.toBe('good')
  })

  it('says which signal fired', () => {
    expect(result().reasons).toContain('ROWS_LOST')
  })
})

describe('8C. two medicines missing', () => {
  it('is flagged at least as firmly', () => {
    const result = assess(PRIMARIES.slice(0, 2), 2)

    expect(result.reasons).toContain('ROWS_LOST')
    expect(['uncertain', 'poor']).toContain(result.quality)
  })
})

describe('8D. composition lines cannot mask a lost medicine', () => {
  it('still reports the loss when the total looks healthy', () => {
    // Six medicines from a four-row page — more than the page declared — and
    // one of the prescribed four is missing. The count is what used to hide it.
    const result = assess([...PRIMARIES.slice(0, 3), ...COMPOSITIONS], 3)

    expect(result.reasons).toContain('ROWS_LOST')
    expect(result.quality).not.toBe('good')
  })

  it('counts primaries, not the length of the list', () => {
    const result = assess([...PRIMARIES.slice(0, 3), ...COMPOSITIONS], 3)

    expect(result.signals.primaryCount).toBe(3)
    expect(result.signals.numberedRows).toBe(4)
  })

  it('does not flag a complete page that also carries compositions', () => {
    // Seven medicines, four rows, nothing lost. Extra supporting entries are
    // not themselves a problem.
    const result = assess([...PRIMARIES, ...COMPOSITIONS], 4)

    expect(result.reasons).not.toContain('ROWS_LOST')
    expect(result.quality).toBe('good')
  })
})

describe('8E. a page with no numbered rows', () => {
  const UNSTRUCTURED = 'Pan 40\nParacetamol 500mg Tablet\nAmoxicillin 250mg Capsule'

  it('invents no row-loss signal', () => {
    // Nothing declared a count, so there is nothing to fall short of.
    const result = assess(['Pan 40', 'Paracetamol', 'Amoxicillin'], null, UNSTRUCTURED)

    expect(result.signals.numberedRows).toBe(0)
    expect(result.reasons).not.toContain('ROWS_LOST')
  })

  it('8F. leaves the rest of the quality judgement unchanged', () => {
    const result = assess(['Pan 40', 'Paracetamol', 'Amoxicillin'], null, UNSTRUCTURED)

    expect(result.quality).toBe('good')
  })
})

describe('callers with no structural pass', () => {
  it('fall back to counting the whole list', () => {
    // With nothing marked primary, every medicine is one — which is the honest
    // answer, and keeps every existing caller behaving as it did.
    const result = assessScanQuality({
      rawText: FOUR_ROWS,
      ocrConfidence: null,
      candidateCount: 4,
      medicines: PRIMARIES.map(medicine),
    })

    expect(result.signals.primaryCount).toBe(4)
    expect(result.reasons).not.toContain('ROWS_LOST')
  })
})

// ---------------------------------------------------------------------------
// Where the expected row count comes from.
//
// It used to be `countNumberedRows`, which recognises "1)" / "2." / "3)" and
// nothing else. But a prescription row does not need a number to be a row:
// prescription-structure treats "TAB. ABCIXIMAB" as one on the strength of the
// dosage form alone. So a page of four TAB./CAP. rows had an expected count of
// zero, and losing one of its medicines produced no warning at all — the
// comparison had nothing to compare against.
//
// The same hole opened whenever OCR damaged the numbering. On this engine "2)"
// is measurably read as "7)", and a mangled marker is a marker that no longer
// counts.
// ---------------------------------------------------------------------------

/** Four prescription rows, numbered. */
const NUMBERED_ROWS = [
  '1) TAB. A-DRUG',
  '2) TAB. B-DRUG',
  '3) CAP. C-DRUG',
  '4) TAB. D-DRUG',
].join('\n')

/** The same four rows with no numbering at all — the case that was broken. */
const FORM_ONLY_ROWS = ['TAB. A-DRUG', 'TAB. B-DRUG', 'CAP. C-DRUG', 'TAB. D-DRUG'].join('\n')

const assessWith = ({ rawText, names, primaryCount, declaredRows }) =>
  assessScanQuality({
    rawText,
    ocrConfidence: null,
    candidateCount: names.length,
    medicines: names.map(medicine),
    primaryCount,
    declaredRows,
  })

describe('the structural row count outranks the marker count', () => {
  it('C. reports a loss on rows that carry a form but no number', () => {
    // The defect, stated directly. `countNumberedRows` sees nothing here.
    const result = assessWith({
      rawText: FORM_ONLY_ROWS,
      names: ['A-Drug', 'B-Drug', 'C-Drug'],
      primaryCount: 3,
      declaredRows: 4,
    })

    expect(result.signals.numberedRows).toBe(0)
    expect(result.signals.expectedRows).toBe(4)
    expect(result.reasons).toContain('ROWS_LOST')
    expect(result.quality).not.toBe('good')
  })

  it('D. reports a loss when OCR destroyed the markers entirely', () => {
    const result = assessWith({
      rawText: FORM_ONLY_ROWS,
      names: ['A-Drug', 'B-Drug'],
      primaryCount: 2,
      declaredRows: 4,
    })

    expect(result.reasons).toContain('ROWS_LOST')
  })

  it('takes the structural count even when markers disagree', () => {
    // A page whose numbering OCR mangled down to two surviving markers, while
    // the structural reader still recognised all four rows. The larger, better
    // evidence is what the comparison should use.
    const damaged = ['1) TAB. A-DRUG', '7) TAB. B-DRUG', 'CAP. C-DRUG', 'TAB. D-DRUG'].join('\n')

    const result = assessWith({
      rawText: damaged,
      names: ['A-Drug', 'B-Drug', 'C-Drug'],
      primaryCount: 3,
      declaredRows: 4,
    })

    expect(result.signals.expectedRows).toBe(4)
    expect(result.reasons).toContain('ROWS_LOST')
  })

  it('raises nothing when every structural row came out', () => {
    const result = assessWith({
      rawText: FORM_ONLY_ROWS,
      names: ['A-Drug', 'B-Drug', 'C-Drug', 'D-Drug'],
      primaryCount: 4,
      declaredRows: 4,
    })

    expect(result.reasons).not.toContain('ROWS_LOST')
    expect(result.quality).toBe('good')
  })

  it('E. a composition child still cannot cover a missing row', () => {
    // Six medicines from four rows, one of the four missing. The total looks
    // healthy; the primary count is what tells the truth.
    const result = assessWith({
      rawText: FORM_ONLY_ROWS,
      names: ['A-Drug', 'B-Drug', 'C-Drug', 'ingredient-x', 'ingredient-y', 'ingredient-z'],
      primaryCount: 3,
      declaredRows: 4,
    })

    expect(result.reasons).toContain('ROWS_LOST')
  })
})

describe('the marker count remains the fallback', () => {
  it('still detects a loss on a numbered page with no structural count', () => {
    // Callers that do not run the structural reader keep working exactly as
    // they did — the marker count is the only evidence they have.
    const result = assessWith({
      rawText: NUMBERED_ROWS,
      names: ['A-Drug', 'B-Drug', 'C-Drug'],
      primaryCount: 3,
      declaredRows: null,
    })

    expect(result.signals.expectedRows).toBe(4)
    expect(result.reasons).toContain('ROWS_LOST')
  })

  it('reports which count decided', () => {
    const structural = assessWith({
      rawText: FORM_ONLY_ROWS,
      names: ['A-Drug'],
      primaryCount: 1,
      declaredRows: 4,
    })
    const marker = assessWith({
      rawText: NUMBERED_ROWS,
      names: ['A-Drug'],
      primaryCount: 1,
      declaredRows: null,
    })

    expect(structural.signals.declaredRows).toBe(4)
    expect(marker.signals.declaredRows).toBeNull()
    expect(marker.signals.expectedRows).toBe(4)
  })
})

describe('F. a page with no rows of either kind', () => {
  it('invents no row-loss signal', () => {
    // Nothing declared a count — not a marker, not a form prefix — so there is
    // nothing to fall short of.
    const result = assessWith({
      rawText: 'Pan 40\nParacetamol 500mg',
      names: ['Pan 40', 'Paracetamol'],
      primaryCount: null,
      declaredRows: 0,
    })

    expect(result.signals.expectedRows).toBe(0)
    expect(result.reasons).not.toContain('ROWS_LOST')
    expect(result.quality).toBe('good')
  })
})
