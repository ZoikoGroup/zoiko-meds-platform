import { describe, expect, it } from 'vitest'
import {
  extractCandidateLines,
  hasBareDose,
  isMeaningfulText,
  isPlausibleMedicineName,
  parseCandidate,
  scoreLine,
} from '../candidate-extract'

const names = (text) => extractCandidateLines(text).map((c) => parseCandidate(c)?.name).filter(Boolean)

describe('non-medicine filtering (generic, not sample-specific)', () => {
  it('drops patient, prescriber, facility and contact lines', () => {
    const header = [
      'SUNRISE MULTISPECIALITY HOSPITAL',
      '12 Riverside Avenue, Springfield',
      'Ph: 0114 496 0821',
      'Dr. Eleanor Whitfield, MBBS, MD (Paediatrics)',
      'Reg. No: 44821',
      'Patient Name: Thomas Okonkwo',
      'Age: 34 / Sex: M',
      'Date: 14/08/2026',
      'Weight: 71 kg',
      'BP: 120/80',
      'Diagnosis: Acute bronchitis',
    ].join('\n')

    expect(extractCandidateLines(header)).toHaveLength(0)
  })

  it('rejects header lines from any hospital, not a hardcoded list', () => {
    // The old implementation named one hospital, one city and one patient. A
    // different prescription must behave identically.
    const a = 'Patient Name: Ashvika R\nJIPMER, Nemmara\nDr. Narayanan, MBBS'
    const b = 'Patient Name: Wei Chen\nSt Bartholomew Clinic, Leeds\nDr. Okafor, MBBS'
    expect(extractCandidateLines(a)).toHaveLength(0)
    expect(extractCandidateLines(b)).toHaveLength(0)
  })

  it('keeps a medicine line whose timing words would once have rejected it', () => {
    // "morning", "night" and "after food" appear on genuine medicine lines;
    // treating them as reject signals dropped real medicines.
    const line = 'Tab. Metformin 500mg - 1 morning, 1 night after food x 30 days'
    expect(scoreLine(line).score).toBeGreaterThanOrEqual(2)
    expect(names(line)).toEqual(['Metformin'])
  })

  it('does not mistake vitals for a strength-bearing medicine line', () => {
    expect(scoreLine('BP: 120/80 mmHg').score).toBeLessThan(2)
    expect(scoreLine('Weight: 62 kg').score).toBeLessThan(2)
  })
})

describe('multi-medicine extraction', () => {
  it('returns every medicine, not just the first', () => {
    const rx = [
      'Rx',
      '1. Tab. Amoxicillin 500mg  TDS x 5 days',
      '2. Syp. Paracetamol 250mg/5ml  SOS',
      '3. Cap. Omeprazole 20mg  OD before food',
      '4. Tab. Cetirizine 10mg  HS x 7 days',
      '5. Inj. Ceftriaxone 1g  BD',
    ].join('\n')

    expect(names(rx)).toEqual([
      'Amoxicillin',
      'Paracetamol',
      'Omeprazole',
      'Cetirizine',
      'Ceftriaxone',
    ])
  })

  it('splits several numbered medicines sharing one OCR line', () => {
    const line = '1. Tab Amoxicillin 500mg 2. Tab Ibuprofen 400mg 3. Cap Omeprazole 20mg'
    expect(names(line)).toEqual(['Amoxicillin', 'Ibuprofen', 'Omeprazole'])
  })

  it('merges a wrapped continuation into the medicine above it', () => {
    // OCR commonly breaks one prescription line across two.
    const wrapped = 'Rx\nTab. Azithromycin\n500 mg  OD  x 3 days'
    expect(names(wrapped)).toEqual(['Azithromycin'])
  })

  it('extracts medicines under an Rx heading without dosage forms', () => {
    const rx = 'Rx:\nAmoxicillin 500mg TDS\nParacetamol 650mg SOS'
    expect(names(rx)).toEqual(['Amoxicillin', 'Paracetamol'])
  })
})

describe('bare medicine names with no dosage markup', () => {
  it('accepts a plain list of brand names (regression: Becosules/Nurokind/Carbamide)', () => {
    // The document that exposed this: three brand names, one per line, no
    // dosage form, no strength, no "Rx" heading.
    expect(names('Becosules\nNurokind OD\nCarbamide Forte')).toEqual([
      'Becosules',
      'Nurokind',
      'Carbamide Forte',
    ])
  })

  it('keeps a trailing brand suffix in the display name but queries without it', () => {
    // "OD" is a dosing abbreviation in "Amoxicillin 500mg OD" and part of the
    // brand in "Nurokind OD". The only dosage signal on the line decides.
    const [bare] = extractCandidateLines('Nurokind OD')
    expect(parseCandidate(bare).displayName).toBe('Nurokind OD')
    expect(parseCandidate(bare).name).toBe('Nurokind')

    const [dosed] = extractCandidateLines('Tab. Amoxicillin 500mg OD x 5 days')
    expect(parseCandidate(dosed).displayName).toBe('Amoxicillin')
  })

  it('still rejects unpronounceable OCR garbage', () => {
    // The vowel rule is what separates a name from noise.
    expect(isPlausibleMedicineName('xxvv zzqq')).toBe(false)
    expect(isPlausibleMedicineName('#### ????')).toBe(false)
    expect(isPlausibleMedicineName('Becosules')).toBe(true)
    expect(isPlausibleMedicineName('Carbamide Forte')).toBe(true)
  })

  it('still rejects header lines that carry no dosage markup either', () => {
    expect(isPlausibleMedicineName('Patient Name: Thomas Okonkwo')).toBe(false)
    expect(isPlausibleMedicineName('St Bartholomew Clinic, Leeds')).toBe(false)
    expect(isPlausibleMedicineName('12 Riverside Avenue')).toBe(false)
    expect(isPlausibleMedicineName('Dr. Eleanor Whitfield MBBS')).toBe(false)
    expect(isPlausibleMedicineName('Please take one after food each day')).toBe(false)
  })

  it('suppresses bare names inside a clinical section', () => {
    // "Acute bronchitis" is name-shaped; the Diagnosis heading is what rules it out.
    expect(names('Diagnosis:\nAcute bronchitis\n\nRx\nBecosules')).toEqual(['Becosules'])
  })
})

describe('parseCandidate', () => {
  it('separates name from strength, form, frequency and duration', () => {
    const [candidate] = extractCandidateLines('Tab. Amoxicillin 500mg TDS x 5 days')
    const parsed = parseCandidate(candidate)
    expect(parsed.name).toBe('Amoxicillin')
    expect(parsed.strength).toMatch(/500\s*mg/i)
    expect(parsed.form).toBe('tab')
    expect(parsed.frequency.toLowerCase()).toBe('tds')
    expect(parsed.duration).toMatch(/5/)
  })

  it('returns null when nothing name-shaped survives stripping', () => {
    expect(parseCandidate({ text: 'Tab 500mg BD x 5 days', evidence: {} })).toBeNull()
  })
})

describe('isMeaningfulText', () => {
  it('accepts a real prescription text layer', () => {
    expect(
      isMeaningfulText('Rx\nTab. Amoxicillin 500mg TDS\nSyp. Paracetamol 250mg/5ml SOS'),
    ).toBe(true)
  })

  it('rejects a text layer holding only page furniture', () => {
    // The old check was `length >= 3`, so a lone page number skipped OCR.
    expect(isMeaningfulText('Page 1 of 6')).toBe(false)
    expect(isMeaningfulText('1\n2\n3')).toBe(false)
    expect(isMeaningfulText('   \n\n  ')).toBe(false)
    expect(isMeaningfulText('')).toBe(false)
  })
})

describe('a short medicine line is not swallowed by the one above it', () => {
  const PRESCRIPTION = ['Paracetamol 650 mg', 'Pan 40', 'Cetirizine 10 mg'].join('\n')

  it('keeps all three medicines separate', () => {
    const candidates = extractCandidateLines(PRESCRIPTION)

    // "Pan 40" leaves only three letters once the number is stripped, so it read
    // as a wrapped continuation and was appended to the paracetamol line above.
    expect(candidates).toHaveLength(3)
    expect(candidates.map((c) => c.text)).toEqual([
      'Paracetamol 650 mg',
      'Pan 40',
      'Cetirizine 10 mg',
    ])
  })

  it('does not append the short line to the previous candidate', () => {
    const [first] = extractCandidateLines(PRESCRIPTION)
    expect(first.text).not.toMatch(/pan/i)
  })

  it('parses each one into its own medicine', () => {
    const parsed = extractCandidateLines(PRESCRIPTION).map(parseCandidate)

    expect(parsed[0].name).toBe('Paracetamol')
    expect(parsed[0].strength).toBe('650 mg')
    expect(parsed[2].name).toBe('Cetirizine')
    expect(parsed[2].strength).toBe('10 mg')
  })

  it('keeps the dose in the displayed name of a bare-dose line', () => {
    // "Pan 40" is how the product is written and how the catalog holds it;
    // the stripped "Pan" is neither.
    const [, pan] = extractCandidateLines(PRESCRIPTION).map(parseCandidate)
    expect(pan.displayName).toBe('Pan 40')
    expect(pan.evidence.bareDose).toBe(true)
  })

  it('still merges a genuine dosage-only continuation', () => {
    // The case the merge exists for: OCR breaking one medicine across lines.
    const candidates = extractCandidateLines('Tab. Amoxicillin\n500mg BD x 5 days')
    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('Tab. Amoxicillin 500mg BD x 5 days')
  })
})

describe('bare-dose lines', () => {
  it('accepts a brand followed by a dose', () => {
    expect(hasBareDose('Pan 40')).toBe(true)
    expect(hasBareDose('Zifi 200')).toBe(true)
    expect(hasBareDose('Shelcal 500')).toBe(true)
  })

  it('rejects page furniture that happens to end in a number', () => {
    expect(hasBareDose('Page 2')).toBe(false)   // single digit
    expect(hasBareDose('Room 401')).toBe(false) // stop-listed head word
    expect(hasBareDose('Bed 12')).toBe(false)
    expect(hasBareDose('Age 45')).toBe(false)
  })

  it('rejects anything that is not exactly one word and one number', () => {
    expect(hasBareDose('Tab Pan 40 BD')).toBe(false)
    expect(hasBareDose('40')).toBe(false)
    expect(hasBareDose('Pan')).toBe(false)
  })
})

describe('strength read through OCR damage', () => {
  it('parses a strength whose zero was read as a letter O', () => {
    const [candidate] = extractCandidateLines('Tab Paracetamol 65O mg BD')
    const parsed = parseCandidate(candidate)

    expect(parsed.strength).toBe('650 mg')
    // The name must not keep the mangled leftovers.
    expect(parsed.name).toBe('Paracetamol')
    // …and the original line is preserved for the user to check against.
    expect(parsed.raw).toBe('Tab Paracetamol 65O mg BD')
  })

  it('parses a strength whose m was read as rn', () => {
    const [candidate] = extractCandidateLines('Tab Paracetamol 650 rng BD')
    const parsed = parseCandidate(candidate)

    expect(parsed.strength).toBe('650 mg')
    expect(parsed.name).toBe('Paracetamol')
    expect(parsed.raw).toContain('rng')
  })

  it('counts a repaired strength as structural evidence', () => {
    expect(scoreLine('Paracetamol 65O mg').evidence.strength).toBe(true)
  })

  it('does not invent a strength where there is none', () => {
    const parsed = parseCandidate({ text: 'Tab Amoxicillin BD', evidence: {} })
    expect(parsed.strength).toBe('')
  })
})
