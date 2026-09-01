// Prescription form labels must never reach the detected-medicine list.
//
// The reported case was "Diap", offered to a patient to confirm against their
// prescription. It is OCR's reading of "Disp" — the dispensed-quantity label on
// a printed form.
//
// `hasFieldLabel` recognised these already, but only in the "Label: value"
// shape: it needs the colon. Scanned forms lose the colon constantly, and the
// label then arrived as a bare token. A bare token is name-shaped, so it took
// the plausible-name path, matched nothing in MediBase, and was surfaced as an
// unmatched medicine — the one tier with no dosage evidence to check it against.

import { describe, expect, it } from 'vitest'
import {
  extractCandidateLines,
  isFieldLabelLine,
  isPlausibleMedicineName,
  parseCandidate,
} from '../candidate-extract'

/** Every medicine name the pipeline reports for a prescription. */
const namesFrom = (text) =>
  extractCandidateLines(text)
    .map((c) => parseCandidate(c)?.name)
    .filter(Boolean)

describe('a label with no colon is still a label', () => {
  it.each([
    'Disp',
    'Dispense',
    'Sig',
    'Signa',
    'Qty',
    'Quantity',
    'Refill',
    'Refills',
    'Ref',
    'Rx',
    'Date',
    'Directions',
    'Instructions',
    'Frequency',
    'Route',
    'Duration',
    'Dose',
    'Prescriber',
  ])('rejects the bare label %s', (label) => {
    expect(isFieldLabelLine(label)).toBe(true)
    expect(isPlausibleMedicineName(label)).toBe(false)
  })

  it.each([
    ['Qty 30', 'a count'],
    ['Refill 2', 'a repeat count'],
    ['Disp 20', 'a dispensed quantity'],
    ['Date 16/06/2026', 'a date'],
  ])('rejects "%s" — %s, not a medicine', (line) => {
    expect(isFieldLabelLine(line)).toBe(true)
  })

  it.each(['Dr. Test', 'Dr John Smith', 'Prescriber Smith', 'Patient A Sharma'])(
    'rejects "%s", whose value is a person',
    (line) => {
      // The remainder is name-shaped by every structural measure, because a
      // person's name is. The label is what settles it.
      expect(isFieldLabelLine(line)).toBe(true)
    },
  )
})

describe('one OCR slip on a known label', () => {
  it.each([
    ['Diap', 'Disp — the reported case'],
    ['Dsp', 'Disp, a dropped letter'],
    ['S1g', 'Sig, with a digit for the i'],
    ['Oty', 'Qty, O read for Q'],
    ['Refil', 'Refill, a dropped letter'],
    ['Qtv', 'Qty'],
    ['Oate', 'Date'],
  ])('rejects "%s" (%s)', (variant) => {
    expect(isFieldLabelLine(variant)).toBe(true)
  })

  it('stays narrow — it does not reject words merely similar to a label', () => {
    // Two edits away, or simply not close to any label. This is the arm that
    // would start eating real medicines if it were loosened.
    for (const name of ['Dapa', 'Sigma', 'Repaglinide', 'Rifampicin', 'Dolo', 'Ranitidine']) {
      expect(isFieldLabelLine(name)).toBe(false)
    }
  })
})

describe('a label in front of a real medicine is a prefix, not a rejection', () => {
  it.each([
    ['Rx: Amoxicillin 500 mg', 'Amoxicillin'],
    ['Medication: Dolo 650', 'Dolo'],
    ['Drug: Pantoprazole 40 mg', 'Pantoprazole'],
    ['Medicine: Azithromycin 500 mg', 'Azithromycin'],
  ])('keeps the medicine from "%s"', (line, expected) => {
    expect(namesFrom(line)).toContain(expected)
  })

  it('does not leave the label attached to the name', () => {
    // "Drug: Pantoprazole 40 mg" used to yield "Drug Pantoprazole": the inline
    // prefix strip knew "Rx" and "Medication" but not "Drug".
    expect(namesFrom('Drug: Pantoprazole 40 mg')).toEqual(['Pantoprazole'])
  })

  it('leaves a strength-bearing line alone even when it opens with a label word', () => {
    expect(isFieldLabelLine('Rx: Amoxicillin 500 mg')).toBe(false)
  })
})

describe('short real medicines still work', () => {
  it.each([
    ['Pan 40', 'Pan'],
    ['Omez 20', 'Omez'],
    ['Zifi 200', 'Zifi'],
    ['Dolo 650', 'Dolo'],
    ['Azee 500', 'Azee'],
    ['Shelcal 500', 'Shelcal'],
  ])('reads "%s" as %s', (line, expected) => {
    expect(namesFrom(line)).toEqual([expected])
  })

  it('keeps a bare brand name with no strength at all', () => {
    expect(namesFrom('Becosules')).toEqual(['Becosules'])
  })

  it('keeps a two-word medicine', () => {
    expect(namesFrom('Carbamide Forte')).toEqual(['Carbamide Forte'])
  })
})

describe('the reported prescription, end to end', () => {
  const PRESCRIPTION = [
    'Dr. Test',
    'Date: 16/06/2026',
    'Patient: A Sharma',
    'Rx:',
    'Amoxicillin 500 mg',
    'Sig: Take one tablet daily',
    'Disp: 20',
    'Refill: 2',
    'Lisinopril 10 mg',
    'Qty: 30',
    'Disp',
    'Diap',
  ].join('\n')

  it('returns exactly the two medicines', () => {
    expect(namesFrom(PRESCRIPTION)).toEqual(['Amoxicillin', 'Lisinopril'])
  })

  it.each(['Disp', 'Diap', 'Sig', 'Refill', 'Qty', 'Dr', 'Date', 'Rx', 'Patient'])(
    'never reports %s',
    (label) => {
      expect(namesFrom(PRESCRIPTION)).not.toContain(label)
    },
  )

  it('reports every medicine on a multi-medicine prescription', () => {
    const many = [
      'Rx:',
      'Tab Amoxicillin 500 mg',
      'Disp: 20',
      'Pantoprazole 40 mg',
      'Sig: 1 tablet BD',
      'Dolo 650',
      'Qty 15',
      'Omez 20',
      'Dr. Smith',
    ].join('\n')

    expect(namesFrom(many)).toEqual(['Amoxicillin', 'Pantoprazole', 'Dolo', 'Omez'])
  })
})
