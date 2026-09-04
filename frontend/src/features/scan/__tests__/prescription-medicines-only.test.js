// Only the medicines, from a prescription that is mostly not medicines.
//
// A prescription's instruction column, symptom list and investigations are all
// name-shaped — short, capitalised, no punctuation — which is exactly what the
// name-only candidate tier accepts. So "Avoid alcohol", "Keep area dry",
// "Weekly once", "itching and redness" and "Kidney Function Test" reached the
// confirmation card as medicines for the patient to check, while
// "Zimig 1% w/w Cream" arrived as "Zimig w w" with no strength: the percentage
// matcher stopped at "1%", and the orphaned w/w lost its slash to the
// punctuation pass and stuck to the name.
//
// Tesseract had read every one of those correctly. The defect was the
// classifier, not the OCR.

import { describe, expect, it } from 'vitest'
import {
  STRENGTH_RE,
  extractCandidateLines,
  isNonMedicineProse,
  parseCandidate,
} from '../candidate-extract'
import { MATCH_SOURCE, computeConfidence, needsConfirmation } from '../confidence'

/**
 * The reported prescription, as OCR emits it: the medicine rows interleaved
 * with the instruction column that sits beside them on the page.
 */
const PRESCRIPTION = [
  'Symptoms(HOPI)',
  'itching and redness',
  'Diagnosis',
  'Fungal infection',
  'Medicines',
  '1. Levosiz 5mg Tablet',
  'Night-1',
  'Daily for 5 days',
  'After food',
  '2. Zimig 1% w/w Cream',
  'Morning-1',
  'Apply twice daily',
  'Keep area dry',
  '3. Forcan 150mg Tablet',
  'Afternoon-1',
  'Weekly once for 4 weeks',
  'Avoid alcohol',
  'Lab Tests',
  'Kidney Function Test',
  'Liver Function Test',
  'General Instructions',
  'Avoid Alcohol',
  'And Redness',
].join('\n')

/** Every medicine the pipeline reports, parsed. */
const medicinesFrom = (text) =>
  extractCandidateLines(text).map((c) => {
    const p = parseCandidate(c)
    return { name: p.name, strength: p.strength, form: p.form }
  })

const namesFrom = (text) => medicinesFrom(text).map((m) => m.name)

describe('the reported prescription', () => {
  it('returns exactly the three medicines on it', () => {
    expect(medicinesFrom(PRESCRIPTION)).toEqual([
      { name: 'Levosiz', strength: '5mg', form: 'tablet' },
      { name: 'Zimig', strength: '1% w/w', form: 'cream' },
      { name: 'Forcan', strength: '150mg', form: 'tablet' },
    ])
  })

  it('finds three and only three', () => {
    expect(medicinesFrom(PRESCRIPTION)).toHaveLength(3)
  })

  it.each([
    'Symptoms',
    'HOPI',
    'itching and redness',
    'Redness',
    'And Redness',
    'Apply',
    'Keep area dry',
    'Weekly once',
    'Avoid alcohol',
    'Avoid Alcohol',
    'Daily',
    'Daly',
    'Morning',
    'Night',
    'After food',
    'Kidney Function Test',
    'Liver Function Test',
    'General Instructions',
    'Anemoon',
  ])('never reports %s as a medicine', (noise) => {
    const names = namesFrom(PRESCRIPTION).map((n) => n.toLowerCase())
    expect(names).not.toContain(noise.toLowerCase())
  })

  it('does not merge the instruction column into a medicine name', () => {
    // "Forcan 150mg  Afternoon-1  Weekly once for 4 weeks" is one visual row.
    for (const name of namesFrom(PRESCRIPTION)) {
      expect(name).not.toMatch(/afternoon|morning|night|weekly|daily|avoid|apply/i)
    }
  })
})

describe('strength parsing', () => {
  it.each([
    ['5mg', '5mg'],
    ['150mg', '150mg'],
    ['500 mg', '500 mg'],
    ['0.5%', '0.5%'],
    ['1%', '1%'],
    ['1% w/w', '1% w/w'],
    ['2% w/v', '2% w/v'],
    ['5% v/v', '5% v/v'],
    ['250mcg', '250mcg'],
    ['10ml', '10ml'],
    ['5mg/ml', '5mg/ml'],
    ['100 IU', '100 IU'],
  ])('reads %s', (input, expected) => {
    expect(STRENGTH_RE.exec(`Brand ${input} Tablet`)?.[0].trim()).toBe(expected)
  })

  it('keeps the w/w tail with the strength, not on the name', () => {
    // The exact defect: "Zimig w w", strength lost.
    const [medicine] = medicinesFrom('2. Zimig 1% w/w Cream')

    expect(medicine).toEqual({ name: 'Zimig', strength: '1% w/w', form: 'cream' })
    expect(medicine.name).not.toMatch(/w\s*w/i)
  })

  it('still reads a ratio strength', () => {
    expect(medicinesFrom('Augmentin 625 Tablet')[0].name).toBe('Augmentin')
    expect(STRENGTH_RE.test('Syrup 250/5 mg')).toBe(true)
  })
})

describe('the prose classifier', () => {
  it.each([
    ['Apply twice daily', 'an instruction'],
    ['Avoid alcohol', 'a precaution'],
    ['Keep area dry', 'a precaution'],
    ['Take after food', 'an instruction'],
    ['Do not drive', 'an instruction'],
    ['Weekly once for 4 weeks', 'a schedule'],
    ['Daily', 'a schedule'],
    ['Daly', 'a schedule, misread'],
    ['Morning', 'a schedule'],
    ['itching and redness', 'symptoms'],
    ['Kidney Function Test', 'an investigation'],
    ['Liver Function Test', 'an investigation'],
    ['Complete Blood Count', 'an investigation'],
  ])('rejects "%s" — %s', (line) => {
    expect(isNonMedicineProse(line)).toBe(true)
  })

  it.each([
    'Levosiz 5mg Tablet',
    'Zimig 1% w/w Cream',
    'Forcan 150mg Tablet',
    'Becosules',
    'Carbamide Forte',
    'Pan 40',
  ])('leaves "%s" alone', (line) => {
    expect(isNonMedicineProse(line)).toBe(false)
  })

  it('spares prose-looking text that carries real dosage evidence', () => {
    // A product whose name contains a symptom word is still a product. The
    // guard is dosage evidence, which is why the rule can afford this
    // vocabulary at all.
    for (const line of ['Pain Relief Gel 30 g', 'Cough Syrup 100ml', 'Burnol Cream']) {
      expect(isNonMedicineProse(line)).toBe(false)
    }
  })
})

describe('a medicine with no strength is not discarded out of hand', () => {
  it('keeps a bare brand name from a repeat list', () => {
    expect(namesFrom('Becosules')).toEqual(['Becosules'])
  })

  it('keeps a two-word brand', () => {
    expect(namesFrom('Carbamide Forte')).toEqual(['Carbamide Forte'])
  })

  it('keeps a brand written with a bare dose', () => {
    expect(medicinesFrom('Pan 40')[0].name).toBe('Pan')
  })

  it('keeps a numbered row that carries only a form', () => {
    // The list number and the dosage form are the evidence; no strength needed.
    expect(namesFrom('1. Zimig Cream')).toEqual(['Zimig'])
  })
})

describe('what reaches the confirmation card', () => {
  // The split is by match source: a governed catalog identity is accepted, a
  // medicine read off the page but absent from MediBase is confirmed. The bug
  // was never this rule — it was that non-medicines arrived here as UNMATCHED.
  const band = (source) =>
    computeConfidence({ nameSimilarity: 1, source, evidence: { strength: true, form: true } })

  it('auto-accepts a medicine MediBase matched exactly', () => {
    expect(needsConfirmation(band(MATCH_SOURCE.MEDIBASE_EXACT), MATCH_SOURCE.MEDIBASE_EXACT)).toBe(
      false,
    )
  })

  it('confirms a genuine medicine MediBase does not hold', () => {
    expect(needsConfirmation(band(MATCH_SOURCE.UNMATCHED), MATCH_SOURCE.UNMATCHED)).toBe(true)
  })

  it('confirms anything the vision fallback resolved', () => {
    expect(needsConfirmation(band(MATCH_SOURCE.VISION), MATCH_SOURCE.VISION)).toBe(true)
  })

  it('has nothing to confirm when every medicine matched', () => {
    // Levosiz and Forcan matched, Zimig not: one card, not three, and none of
    // the instruction text that used to fill it.
    const sources = {
      Levosiz: MATCH_SOURCE.MEDIBASE_EXACT,
      Forcan: MATCH_SOURCE.MEDIBASE_EXACT,
      Zimig: MATCH_SOURCE.UNMATCHED,
    }
    const toConfirm = medicinesFrom(PRESCRIPTION).filter((m) =>
      needsConfirmation(band(sources[m.name]), sources[m.name]),
    )

    expect(toConfirm.map((m) => m.name)).toEqual(['Zimig'])
  })

  it('leaves the section empty when all three match', () => {
    const allMatched = medicinesFrom(PRESCRIPTION).filter((m) =>
      needsConfirmation(band(MATCH_SOURCE.MEDIBASE_EXACT), MATCH_SOURCE.MEDIBASE_EXACT),
    )

    expect(allMatched).toEqual([])
  })
})

describe('PDF text and OCR text take the same path', () => {
  it('reads the same medicines from either source', () => {
    // pdfjs gives one string per line; Tesseract gives a block of lines. Both
    // enter extractCandidateLines, so the rules cannot differ by input format.
    const asPdfText = PRESCRIPTION
    const asOcrBlock = PRESCRIPTION.split('\n').join('\r\n')

    expect(medicinesFrom(asOcrBlock)).toEqual(medicinesFrom(asPdfText))
  })
})

/**
 * Instruction text that carries a dosage form is still an instruction.
 *
 * `isNonMedicineProse` used to check for a strength or a dosage form first and
 * return "not prose" the moment it found one. A prescription's direction column
 * is full of both — "Take 1 tablet after food" names a form and a count because
 * it is a direction about a medicine — so those lines were handed to the
 * candidate tiers as medicine-shaped and reached the confirmation card.
 *
 * Grammar is now checked first: an imperative opener or a cadence opener wins
 * over dosage evidence. The dosage guard still runs for everything else, which
 * is what keeps a product whose name contains a symptom word from being thrown
 * away.
 */
describe('an instruction carrying a dosage form', () => {
  it.each([
    'Take 1 tablet after food',
    'Take two tablets daily',
    'Apply 2 drops twice daily',
    'Apply cream to affected area',
    'Use cream twice daily',
    'Use 5ml syrup at bedtime',
    'Swallow 1 capsule with water',
    'Dissolve one tablet in water',
    'Inhale 2 puffs when required',
    'Instil 1 drop in each eye',
  ])('discards "%s"', (line) => {
    expect(isNonMedicineProse(line)).toBe(true)
  })

  it.each([
    'Daily 1 tablet',
    'Weekly once 150mg',
    'Morning 1 tablet after food',
    'Twice daily 5ml',
  ])('discards the schedule opener "%s" despite its dosage words', (line) => {
    expect(isNonMedicineProse(line)).toBe(true)
  })

  it('keeps none of them out of the medicine list', async () => {
    const text = [
      'Medicines',
      '1. Levosiz 5mg Tablet',
      'Take 1 tablet after food',
      '2. Zimig 1% w/w Cream',
      'Apply 2 drops twice daily',
      '3. Forcan 150mg Tablet',
      'Use cream twice daily',
    ].join('\n')

    expect(medicinesFrom(text).map((m) => m.name)).toEqual(['Levosiz', 'Zimig', 'Forcan'])
  })
})

describe('a medicine whose name looks like an instruction does not', () => {
  it.each([
    'Levosiz 5mg Tablet',
    'Zimig 1% w/w Cream',
    'Forcan 150mg Tablet',
    'Paracetamol Oral Suspension 250mg/5ml',
    'Pain Relief Gel 30 g',
    'Cough Syrup 100ml',
    'Burnol Cream',
    'Becosules',
  ])('keeps "%s"', (line) => {
    expect(isNonMedicineProse(line)).toBe(false)
  })

  it.each(['Restore 10mg Tablet', 'Checkmate 5mg', 'Dabur Honey Syrup'])(
    'does not mistake "%s" for an imperative',
    (line) => {
      // Word boundaries: \brest\b does not match "Restore", \bcheck\b does not
      // match "Checkmate", \bdab\b does not match "Dabur".
      expect(isNonMedicineProse(line)).toBe(false)
    },
  )
})
