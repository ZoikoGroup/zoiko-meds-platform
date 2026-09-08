// Sitting in the Rx block is not evidence that a line is a medicine.
//
// `scoreLine` gave every line inside the medicine section an unconditional +2,
// and ACCEPT_THRESHOLD is exactly 2. So any capitalised, pronounceable phrase
// that happened to fall inside that section was accepted on position alone —
// no dosage form, no strength, no frequency, no list marker, nothing about it
// medicinal. "CLOSED SUNDAY", printed on the clinic's letterhead, reached the
// patient as a medicine card to confirm.
//
// The trap is that the false positives and the genuinely weak medicines score
// identically. Measured before the fix:
//
//   CLOSED SUNDAY     score 0 alone, 2 in-section, no signals
//   Pantocid DSR      score 0 alone, 2 in-section, no signals
//
// So "require a dosage signal" alone would have thrown away real medicines. The
// rule that separates them is not structural strength but vocabulary: opening
// hours and bare condition names are made of ordinary words, and coined brand
// names are not.
//
// Two rules do the work, and these tests hold both:
//   1. section context amplifies existing evidence, it never creates it
//   2. calendar/scheduling and common-condition words are not product names

import { describe, expect, it } from 'vitest'
import {
  extractCandidateLines,
  isNonMedicineProse,
  isPlausibleMedicineName,
  parseCandidate,
  scoreLine,
} from '../candidate-extract'

/** Everything a page carries that is not a prescription. */
const NOT_MEDICINES = [
  'CLOSED SUNDAY',
  'Closed Sunday',
  'Clinic Closed Sunday',
  'MALARIA',
  'Malaria',
  'Take Bed Rest',
  'Avoid Alcohol',
  'Weekly Once',
  'Daily',
  'Follow Up',
  'OPD Timing',
  'Monday to Saturday',
]

/** Real medicines, including the weak formats with no dosage structure. */
const MEDICINES = [
  'Pan 40',
  'Zoclar 500',
  'Gestakind 10/SR',
  'Pantocid DSR',
  'Shelcal XT',
  'Paracetamol 500mg',
  'Amoxicillin 250mg Capsule',
]

/** Names extracted from a page, whichever tier admitted them. */
const namesFrom = (text) =>
  extractCandidateLines(text)
    .map((candidate) => parseCandidate(candidate)?.name ?? '')
    .filter(Boolean)

describe('1 & 2. section context cannot accept a line on its own', () => {
  it.each(NOT_MEDICINES)('%s is not accepted inside an Rx block', (phrase) => {
    // The worst case for this rule: the phrase sits directly among the
    // medicines, where position offers it every advantage.
    const page = `Rx\n1) TAB. AMOXICILLIN 500MG\n${phrase}\n`

    const found = namesFrom(page).join(' | ').toLowerCase()

    expect(found).not.toContain(phrase.toLowerCase().split(' ')[0].slice(0, 6))
  })

  it.each(NOT_MEDICINES)('%s scores no higher for being in the section', (phrase) => {
    // The bonus has nothing to amplify, so position changes nothing.
    const outside = scoreLine(phrase, { inMedicineSection: false }).score
    const inside = scoreLine(phrase, { inMedicineSection: true }).score

    expect(inside).toBe(outside)
  })

  it.each(NOT_MEDICINES)('%s stays below the acceptance threshold', (phrase) => {
    expect(scoreLine(phrase, { inMedicineSection: true }).score).toBeLessThan(2)
  })

  it('a line with real evidence still gains from the section', () => {
    // The bonus is not removed — it is made conditional. A line that already
    // carries a signal is still made more confident by where it sits.
    const outside = scoreLine('Tab. Amoxicillin 500mg', { inMedicineSection: false }).score
    const inside = scoreLine('Tab. Amoxicillin 500mg', { inMedicineSection: true }).score

    expect(inside).toBeGreaterThan(outside)
  })
})

describe('3. the rule is structural, not a list of phrases', () => {
  it.each([
    'Closed Monday',
    'Sunday Closed',
    'Clinic Timings',
    'OPD Timings',
    'Tuesday to Friday',
    'Closed on Wednesday',
    'Emergency Helpline',
  ])('%s is rejected too, though no test named it before', (phrase) => {
    // Vocabulary, not phrases: any arrangement of scheduling words falls out of
    // the same rule rather than needing its own entry.
    expect(isNonMedicineProse(phrase)).toBe(true)
    expect(isPlausibleMedicineName(phrase)).toBe(false)
  })

  it.each(['Dengue', 'Typhoid', 'Hypertension', 'Asthma'])(
    '%s is a condition, not a prescription',
    (condition) => {
      expect(isNonMedicineProse(condition)).toBe(true)
    },
  )
})

describe('4. genuine medicines are not lost to the stricter rule', () => {
  it.each(MEDICINES)('%s is still extracted from an Rx block', (medicine) => {
    const page = `Rx\n${medicine}\n`

    expect(namesFrom(page).join(' | ').toLowerCase()).toContain(
      medicine.toLowerCase().split(' ')[0],
    )
  })

  it.each(MEDICINES)('%s still reads as a medicine name', (medicine) => {
    expect(isNonMedicineProse(medicine)).toBe(false)
  })

  it('an unstructured list of bare brand names still works', () => {
    // The case the weak tier exists for, and the one a naive "require dosage
    // evidence" rule would have destroyed.
    const page = 'Pantocid DSR\nShelcal XT\nGestakind 10/SR'

    const names = namesFrom(page).join(' | ').toLowerCase()

    expect(names).toContain('pantocid')
    expect(names).toContain('shelcal')
    expect(names).toContain('gestakind')
  })

  it('keeps the medicine when a clinic line sits right beside it', () => {
    const page = 'Rx\n1) TAB. AMOXICILLIN 500MG\nCLOSED SUNDAY\n'

    const names = namesFrom(page)

    expect(names.join(' | ').toLowerCase()).toContain('amoxicillin')
    expect(names.join(' | ').toLowerCase()).not.toContain('closed')
  })
})

describe('7. the regression prescription, end to end through extraction', () => {
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

  it.each(['Malaria', 'Take Bed Rest', 'Closed Sunday'])(
    'the line scorer no longer offers %s as a candidate',
    (noise) => {
      // The structural reader already rejected these; the line scorer runs
      // beside it on every unconsumed line and used to re-admit "CLOSED SUNDAY".
      const found = namesFrom(REGRESSION).join(' | ').toLowerCase()

      expect(found).not.toContain(noise.toLowerCase().split(' ')[0])
    },
  )

  it('still offers every prescribed medicine', () => {
    const found = namesFrom(REGRESSION).join(' | ').toLowerCase()

    for (const medicine of ['abciximab', 'vomilast', 'zoclar', 'gestakind']) {
      expect(found).toContain(medicine)
    }
  })
})
