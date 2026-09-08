// Which lines are prescriptions, and which describe them.
//
// The regression prescription in §11 of the brief, which the line-scoring
// extractor read as eight medicines:
//
//   ABCIXIMAB, VOMILAST, DOXYLAMINE + PYRIDOXINE + FOLIC ACID, ZOCLAR,
//   CLARITHROMYCIN IP, GESTAKIND SR, ISOXSUPRINE, CLOSED SUNDAY
//
// Four are prescribed. Three are the compositions printed under them — real
// drug names, which is why no per-line classifier and no NER model can rule
// them out; the evidence that they are not prescriptions is that they sit
// under a numbered row rather than on one. One is the clinic's opening hours.
// And two of the four came out damaged: "Zoclar 500" lost its 500 and
// "Gestakind 10/SR" became "Gestakind SR", which are different products.
//
// The names below appear only in these fixtures. Nothing in the module knows
// them.

import { describe, expect, it } from 'vitest'
import {
  groupPrescriptionRows,
  isPrimaryRow,
  looksLikeComposition,
  parsePrimaryRow,
} from '../prescription-structure'

/** The §11 regression prescription. */
const REGRESSION = `1) TAB. ABCIXIMAB

2) TAB. VOMILAST
DOXYLAMINE 10 MG + PYRIDOXINE 10 MG + FOLIC ACID 2.5 MG

3) CAP. ZOCLAR 500
CLARITHROMYCIN IP 500MG

4) TAB. GESTAKIND 10/SR
ISOXSUPRINE 10 MG

Diagnosis:
MALARIA

Advice:
TAKE BED REST

Clinic:
CLOSED SUNDAY`

const namesOf = (text, entities = null) =>
  groupPrescriptionRows(text, entities).map((row) => row.name)

describe('the regression prescription', () => {
  it('yields exactly the four prescribed medicines', () => {
    expect(namesOf(REGRESSION)).toEqual([
      'Abciximab',
      'Vomilast',
      'Zoclar 500',
      'Gestakind 10/SR',
    ])
  })

  it.each(['Malaria', 'Take Bed Rest', 'Closed Sunday'])('rejects %s', (noise) => {
    expect(namesOf(REGRESSION).join(' | ')).not.toContain(noise)
  })

  it.each([
    ['Doxylamine', 'Vomilast'],
    ['Clarithromycin', 'Zoclar 500'],
    ['Isoxsuprine', 'Gestakind 10/SR'],
  ])('does not promote %s to a prescription of its own', (ingredient) => {
    expect(namesOf(REGRESSION).join(' | ')).not.toContain(ingredient)
  })

  it('attaches each composition to the medicine it belongs to', () => {
    const byName = Object.fromEntries(
      groupPrescriptionRows(REGRESSION).map((row) => [row.name, row.compositionText]),
    )

    expect(byName.Vomilast).toBe('DOXYLAMINE 10 MG + PYRIDOXINE 10 MG + FOLIC ACID 2.5 MG')
    expect(byName['Zoclar 500']).toBe('CLARITHROMYCIN IP 500MG')
    expect(byName['Gestakind 10/SR']).toBe('ISOXSUPRINE 10 MG')
  })

  it('leaves a medicine with no composition line reporting none', () => {
    const abciximab = groupPrescriptionRows(REGRESSION)[0]

    expect(abciximab.name).toBe('Abciximab')
    expect(abciximab.compositionText).toBeNull()
  })

  it('records which lines each candidate came from', () => {
    const vomilast = groupPrescriptionRows(REGRESSION)[1]

    expect(vomilast.sourceLines).toHaveLength(2)
    expect(vomilast.sourceLines[0]).toContain('VOMILAST')
  })
})

describe('12. the written product identity survives', () => {
  it.each([
    ['3) CAP. ZOCLAR 500', 'ZOCLAR 500'],
    ['4) TAB. GESTAKIND 10/SR', 'GESTAKIND 10/SR'],
    ['1) TAB. PANTOCID DSR', 'PANTOCID DSR'],
    ['2) TAB. METFORMIN XR 500', 'METFORMIN XR 500'],
    ['5) TAB. SHELCAL XT', 'SHELCAL XT'],
  ])('%s keeps its suffix', (line, expected) => {
    // A bare number carries no unit, so it is part of the name the doctor
    // wrote — not a strength to be stripped off. parsePrimaryRow returns the
    // characters as written; capitalization happens later.
    expect(parsePrimaryRow(line).name).toBe(expected)
  })

  it.each([
    ['3) CAP. ZOCLAR 500', 'Zoclar 500'],
    ['4) TAB. GESTAKIND 10/SR', 'Gestakind 10/SR'],
  ])('%s is capitalized without lowercasing its suffix', (line, expected) => {
    // "10/SR" is a release-profile marker. Title-casing the whole string turned
    // it into "10/sr", which names a different product.
    expect(groupPrescriptionRows(line)[0].name).toBe(expected)
  })

  it('still separates a strength that carries a unit', () => {
    const row = parsePrimaryRow('1) TAB. PARACETAMOL 500MG')

    expect(row.name).toBe('PARACETAMOL')
    expect(row.strength).toBe('500MG')
  })

  it('takes the directions off the name without losing them', () => {
    // "Amoxicillin BD x 5 days" matched nothing in the catalog.
    const row = parsePrimaryRow('Tab. Amoxicillin 500 mg BD x 5 days')

    expect(row.name).toBe('Amoxicillin')
    expect(row.strength).toBe('500 mg')
    expect(row.frequency).toBeTruthy()
  })
})

describe('6. a numbered generic is still a prescription', () => {
  it('keeps a generic written on a numbered row', () => {
    // The composition rule must not swallow a medicine that was prescribed
    // generically — position is what distinguishes them, not the name.
    const text = '1) TAB. PARACETAMOL 500MG\n2) TAB. AMOXICILLIN 250MG'

    expect(namesOf(text)).toEqual(['Paracetamol', 'Amoxicillin'])
  })

  it('does not treat the second numbered row as the first one’s composition', () => {
    const rows = groupPrescriptionRows('1) TAB. PARACETAMOL 500MG\n2) TAB. AMOXICILLIN 250MG')

    expect(rows[0].compositionText).toBeNull()
    expect(rows[1].compositionText).toBeNull()
  })
})

describe('reading the rows', () => {
  it.each([
    '1) TAB. VOMILAST',
    '2. Levosiz 5mg Tablet',
    'Tab. Amoxicillin 500mg',
    '- CAP. ZOCLAR 500',
  ])('%s opens a prescription', (line) => {
    expect(isPrimaryRow(line)).toBe(true)
  })

  it.each(['Diagnosis:', 'Advice:', 'Clinic:', 'MALARIA', 'DOXYLAMINE 10 MG + PYRIDOXINE 10 MG'])(
    '%s does not',
    (line) => {
      expect(isPrimaryRow(line)).toBe(false)
    },
  )

  it.each([
    'DOXYLAMINE 10 MG + PYRIDOXINE 10 MG + FOLIC ACID 2.5 MG',
    'CLARITHROMYCIN IP 500MG',
    'ISOXSUPRINE 10 MG',
  ])('%s reads as a composition', (line) => {
    expect(looksLikeComposition(line)).toBe(true)
  })

  it('a numbered row is never a composition, however it is written', () => {
    expect(looksLikeComposition('3) CAP. ZOCLAR 500MG')).toBe(false)
  })

  it('a section heading closes the medicine block', () => {
    // Without this, "MALARIA" under "Diagnosis:" attaches to the last medicine.
    const rows = groupPrescriptionRows('1) TAB. ABCIXIMAB\nDiagnosis:\nMALARIA')

    expect(rows).toHaveLength(1)
    expect(rows[0].compositionText).toBeNull()
  })
})

describe('pages with no list structure', () => {
  it('finds nothing to group, so the caller falls back', () => {
    // A photographed strip or one scrawled line has no rows to read. Returning
    // nothing is correct — the line scorer still runs on those lines.
    expect(groupPrescriptionRows('Pan 40\nsome scrawl')).toEqual([])
  })

  it('handles an empty page without throwing', () => {
    expect(groupPrescriptionRows('')).toEqual([])
    expect(groupPrescriptionRows(null)).toEqual([])
  })
})
