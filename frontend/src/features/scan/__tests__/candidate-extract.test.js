import { describe, expect, it } from 'vitest'
import {
  extractCandidateLines,
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
