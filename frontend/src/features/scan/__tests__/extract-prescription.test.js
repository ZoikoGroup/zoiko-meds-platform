import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFile, fakePdf, installDomStub, removeDomStub } from './setup'

// --- Mocks ------------------------------------------------------------------

const recognizeMock = vi.fn()
const createWorkerMock = vi.fn()
const terminateMock = vi.fn(async () => {})

vi.mock('tesseract.js', () => ({
  createWorker: (...args) => createWorkerMock(...args),
}))

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args) => getDocumentMock(...args),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

// A stand-in MediBase catalog. Matching mirrors the backend: variant expansion
// plus fuzzy ranking, so a candidate only matches something genuinely close.
const CATALOG = [
  { id: 'm1', name: 'Amoxicillin', generic: 'Amoxicillin', brands: ['Novamox'], strength: '500 mg' },
  { id: 'm2', name: 'Paracetamol', generic: 'Paracetamol', brands: ['Calpol', 'Crocin'], strength: '500 mg' },
  { id: 'm3', name: 'Omeprazole', generic: 'Omeprazole', brands: [], strength: '20 mg' },
  { id: 'm4', name: 'Cetirizine', generic: 'Cetirizine', brands: ['Zyrtec'], strength: '10 mg' },
  { id: 'm5', name: 'Ceftriaxone', generic: 'Ceftriaxone', brands: [], strength: '1 g' },
  { id: 'm6', name: 'Metformin', generic: 'Metformin', brands: ['Glycomet'], strength: '500 mg' },
]

/** Default catalog behaviour — mirrors the backend's fuzzy ranking. */
async function defaultCatalogMatch(query) {
  const { similarity } = await import('../text-normalize')
  return CATALOG.map((entry) => ({
    entry,
    score: Math.max(
      ...[entry.name, entry.generic, ...entry.brands].map((reference) => similarity(query, reference)),
    ),
  }))
    .filter((row) => row.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.entry)
}

const matchMedicinesMock = vi.fn(defaultCatalogMatch)

vi.mock('@/services/medicine-api', () => ({
  matchMedicines: (...args) => matchMedicinesMock(...args),
}))

// --- Helpers ----------------------------------------------------------------

function mockOcrText(text, confidence = 0.92) {
  recognizeMock.mockResolvedValue({ data: { text, confidence: confidence * 100 } })
}

async function loadPipeline() {
  vi.resetModules()
  return import('../extract-prescription')
}

const imageFile = () => fakeFile('rx.jpg', 'image/jpeg')
const pdfFile = () => fakeFile('rx.pdf', 'application/pdf')

beforeEach(() => {
  installDomStub()
  vi.clearAllMocks()
  // clearAllMocks resets call history but NOT implementations, so any test that
  // overrides a mock must have it restored here or it leaks into the next one.
  matchMedicinesMock.mockImplementation(defaultCatalogMatch)
  createWorkerMock.mockImplementation(async () => ({
    recognize: recognizeMock,
    terminate: terminateMock,
  }))
  mockOcrText('')
})

afterEach(() => {
  removeDomStub()
})

// --- Image scans ------------------------------------------------------------

describe('single medicine image', () => {
  it('extracts and matches one medicine', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\nTab. Amoxicillin 500mg TDS x 5 days')

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toHaveLength(1)
    expect(result.medicines[0].name).toBe('Amoxicillin')
    expect(result.medicines[0].needsConfirmation).toBe(false)
    expect(result.confident).toHaveLength(1)
    expect(result.needsVisionFallback).toBe(false)
  })
})

describe('multiple medicines image', () => {
  it('extracts every medicine, not just the first', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'Rx',
        '1. Tab. Amoxicillin 500mg TDS x 5 days',
        '2. Syp. Paracetamol 250mg/5ml SOS',
        '3. Cap. Omeprazole 20mg OD',
        '4. Tab. Cetirizine 10mg HS x 7 days',
        '5. Inj. Ceftriaxone 1g BD',
      ].join('\n'),
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual([
      'Amoxicillin',
      'Ceftriaxone',
      'Cetirizine',
      'Omeprazole',
      'Paracetamol',
    ])
  })
})

describe('bare medicine-name list (regression: Text_to_PDF_Onlinenotpad)', () => {
  // A real digital PDF whose whole content is three brand names, one per line,
  // with no dosage form, no strength and no "Rx" heading. The first version of
  // the structural scorer required dosage evidence, so every line scored 0 and
  // the scan reported "0 medicines found".
  const LIST = 'Becosules\nNurokind OD\nCarbamide Forte'

  it('detects all three medicines from a digital PDF', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakePdf([{ textLayer: ['Becosules', 'Nurokind OD', 'Carbamide Forte'] }])),
    })

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual([
      'Becosules',
      'Carbamide Forte',
      'Nurokind OD',
    ])
    expect(recognizeMock).not.toHaveBeenCalled() // text layer is usable
  })

  it('detects the same three from a scanned PDF via OCR', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakePdf([{ textLayer: [] }])) })
    mockOcrText(LIST)

    const result = await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(1)
    expect(result.medicines.map((m) => m.name).sort()).toEqual([
      'Becosules',
      'Carbamide Forte',
      'Nurokind OD',
    ])
  })

  it('detects the same three from a photo', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(LIST)

    const result = await extractPrescriptionMeds(imageFile())
    expect(result.medicines).toHaveLength(3)
  })

  it('queries MediBase for each name rather than relying on the offline list', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(LIST)

    await extractPrescriptionMeds(imageFile())

    const queried = matchMedicinesMock.mock.calls.map(([q]) => q).sort()
    expect(queried).toEqual(['Becosules', 'Carbamide Forte', 'Nurokind'])
  })

  it('flags them for confirmation while they are absent from the catalog', async () => {
    // The seeded MediBase catalog does not contain these brands, so honesty
    // requires surfacing them as read-but-unverified, never as auto-accepted.
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(LIST)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.unconfirmed).toHaveLength(3)
    expect(result.confident).toEqual([])
    result.medicines.forEach((medicine) => {
      expect(medicine.needsConfirmation).toBe(true)
      expect(medicine.reason).toMatch(/not found in the catalog/i)
    })
  })

  it('auto-accepts once the medicine is seeded in MediBase', async () => {
    // Proves the path is genuine catalog matching, not a hardcoded allow-list:
    // adding the entry to MediBase promotes it to the confident band.
    const { extractPrescriptionMeds } = await loadPipeline()
    matchMedicinesMock.mockImplementation(async (query) =>
      /becosule/i.test(query)
        ? [{ id: 'm9', name: 'Becosules', generic: 'Vitamin B-Complex with C', brands: [], strength: 'Capsule' }]
        : [],
    )
    mockOcrText(LIST)

    const result = await extractPrescriptionMeds(imageFile())

    const becosules = result.medicines.find((m) => m.name === 'Becosules')
    expect(becosules.needsConfirmation).toBe(false)
    expect(becosules.genericName).toBe('Vitamin B-Complex with C')
    expect(result.medicines).toHaveLength(3)
  })
})

describe('US-format prescription with dispensing metadata (regression: perscription 5)', () => {
  // A full prescription: letterhead, patient block, an Rx section with two
  // medicines, and the dispensing metadata that surrounds each of them.
  // Sig/Disp/Refills lines sit INSIDE the Rx block and carry a dosage form and
  // a duration, so structure-only acceptance turned them into medicines named
  // "SI Take BY Mouth Avery Hours For Oays" and "Refills AX Real Inr".
  const PRESCRIPTION = [
    '======================================================================',
    'METROPOLITAN COMMUNITY MEDICAL CENTER',
    '123 HEALTHCARE BLVD, SUITE 400',
    'NEW YORK, NY 10001',
    'TEL: (212) 555-0199',
    '',
    'PATIENT NAME: Jane Doe          DATE: 08/07/2026',
    'DOB: 04/12/1988                 AGE: 38',
    'ADDRESS: 742 Evergreen Terrace, NY 10002',
    '',
    '----------------------------------------------------------------------',
    'Rx',
    '',
    '1. Amoxicillin 500 mg Capsule',
    '   Disp: #30 (Thirty)',
    '   Sig: Take 1 capsule by mouth every 8 hours for 10 days.',
    '',
    '2. Lisinopril 10 mg Tablet',
    '   Disp: #90 (Ninety)',
    '   Sig: Take 1 tablet daily in the morning for blood pressure.',
    '',
    '----------------------------------------------------------------------',
    'REFILLS: [ ] 1 [ ] 2 [ ] 3 [x] PRN [ ] NR',
    'GENERIC SUBSTITUTION PERMISSIBLE: [x] YES [ ] NO',
    '',
    'DOCTOR SIGNATURE: Dr. Sarah Jenkins, MD',
    'DEA NO: BJ1234567     NPI: 1982039481',
    '======================================================================',
  ].join('\n')

  it('returns exactly the two prescribed medicines', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(PRESCRIPTION)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Amoxicillin', 'Lisinopril'])
  })

  it('detects both medicines, not just the first', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(PRESCRIPTION)

    const result = await extractPrescriptionMeds(imageFile())
    expect(result.medicines).toHaveLength(2)
  })

  it('carries the strength and form through for each', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(PRESCRIPTION)

    const result = await extractPrescriptionMeds(imageFile())
    const amox = result.medicines.find((m) => m.name === 'Amoxicillin')
    const lisin = result.medicines.find((m) => m.name === 'Lisinopril')

    expect(amox.strength).toMatch(/500\s*mg/i)
    expect(amox.form).toBe('capsule')
    expect(lisin.strength).toMatch(/10\s*mg/i)
    expect(lisin.form).toBe('tablet')
  })

  it('never treats Sig / Disp / Refills / prescriber metadata as a medicine', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(PRESCRIPTION)

    const result = await extractPrescriptionMeds(imageFile())
    const names = result.medicines.map((m) => m.name.toLowerCase()).join(' | ')

    for (const forbidden of [
      'take', 'mouth', 'hours', 'days', 'refill', 'prn', 'disp', 'thirty', 'ninety',
      'sig', 'generic substitution', 'yes', 'jane', 'doe', 'sarah', 'jenkins',
      'metropolitan', 'healthcare', 'evergreen', 'dea', 'npi', 'blood pressure',
    ]) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('matches Amoxicillin to MediBase and flags off-catalog Lisinopril', async () => {
    // Amoxicillin is seeded; Lisinopril is not. The seeded one auto-accepts,
    // the other is surfaced as uncertain rather than forced onto a near name.
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(PRESCRIPTION)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.confident.map((m) => m.name)).toEqual(['Amoxicillin'])
    expect(result.unconfirmed.map((m) => m.name)).toEqual(['Lisinopril'])
  })

  it('leaves badly-read text unmatched instead of renaming it to a near medicine', async () => {
    // Real OCR of this page produced "Amescitin Cepsutel" for "Amoxicillin
    // 500 mg Capsule". That is ~0.55 similar to Amoxicillin — close enough for
    // a loose threshold to claim a match that the page never named.
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\n1. Amescitin Cepsutel 500 mg\n2. Uisinopr 10mg')

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.confident).toEqual([])
    result.medicines.forEach((medicine) => {
      expect(medicine.needsConfirmation).toBe(true)
      expect(medicine.name).not.toBe('Amoxicillin')
    })
  })
})

describe('OCR spelling errors', () => {
  it('matches medicines through common character confusions', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    // ParacetamoI (capital i), Amoxcillin (dropped i), Metf0rmin (zero).
    mockOcrText(
      ['Rx', 'Tab. ParacetamoI 500mg BD', 'Cap. Amoxcillin 500mg TDS', 'Tab. Metf0rmin 500mg OD'].join('\n'),
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual([
      'Amoxicillin',
      'Metformin',
      'Paracetamol',
    ])
  })
})

describe('prescription containing patient and hospital information', () => {
  it('returns only the medicines', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'SUNRISE MULTISPECIALITY HOSPITAL',
        '12 Riverside Avenue, Springfield',
        'Ph: 0114 496 0821',
        'Dr. Eleanor Whitfield, MBBS, MD (Paediatrics)',
        'Reg. No: 44821',
        'Patient Name: Thomas Okonkwo',
        'Age: 34 / Sex: M     Date: 14/08/2026',
        'Weight: 71 kg   BP: 120/80',
        'Diagnosis: Acute bronchitis',
        '',
        'Rx',
        '1. Tab. Amoxicillin 500mg TDS x 5 days',
        '2. Syp. Paracetamol 250mg/5ml SOS',
        '',
        'Follow up after 5 days',
        'Signature: ____________',
      ].join('\n'),
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Amoxicillin', 'Paracetamol'])
  })
})

describe('no medicine detected', () => {
  it('returns an empty list and offers the vision fallback', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Patient Name: Thomas Okonkwo\nDate: 14/08/2026\nFollow up in two weeks')

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toEqual([])
    expect(result.needsVisionFallback).toBe(true)
  })

  it('never guesses a medicine from the file name', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('   ')
    // The old implementation matched "amoxicillin" out of the file name.
    const result = await extractPrescriptionMeds(fakeFile('amoxicillin-500.jpg', 'image/jpeg'))

    expect(result.medicines).toEqual([])
    expect(result.needsVisionFallback).toBe(true)
  })

  it('never invents a medicine from unreadable text', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\nxxvv zzqq 8823 ~~~~\n#### ????', 0.2)

    const result = await extractPrescriptionMeds(imageFile())
    expect(result.confident).toEqual([])
  })
})

describe('low-confidence medicine', () => {
  it('flags an off-catalog reading for user confirmation', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    // Structurally a medicine line, but no catalog entry is close.
    mockOcrText('Rx\nTab. Zafirlukastium 250mg BD x 5 days', 0.7)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toHaveLength(1)
    expect(result.medicines[0].needsConfirmation).toBe(true)
    expect(result.confident).toEqual([])
    expect(result.unconfirmed).toHaveLength(1)
    expect(result.needsVisionFallback).toBe(true)
  })

  it('degrades to needs-confirmation when the catalog is unreachable', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    matchMedicinesMock.mockRejectedValueOnce(new Error('network down'))
    mockOcrText('Rx\nTab. Paracetamol 500mg BD')

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toHaveLength(1)
    expect(result.medicines[0].needsConfirmation).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/catalog was unreachable/i)
  })
})

// --- PDFs -------------------------------------------------------------------

describe('digital PDF', () => {
  it('uses the embedded text layer and skips OCR entirely', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakePdf([
          {
            textLayer: [
              'Rx',
              'Tab. Amoxicillin 500mg TDS x 5 days',
              'Syp. Paracetamol 250mg/5ml SOS',
            ],
          },
        ]),
      ),
    })

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Amoxicillin', 'Paracetamol'])
    expect(result.stats.pages).toBe(1)
    // No OCR step, so there is no OCR confidence to blend into the score.
    expect(result.stats.ocrConfidence).toBeNull()
    expect(recognizeMock).not.toHaveBeenCalled()
  })
})

describe('scanned PDF', () => {
  it('falls back to OCR when the text layer is empty', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakePdf([{ textLayer: [] }])) })
    mockOcrText('Rx\nTab. Omeprazole 20mg OD x 14 days')

    const result = await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(1)
    expect(result.medicines.map((m) => m.name)).toEqual(['Omeprazole'])
  })
})

describe('PDF with a misleading text layer', () => {
  it('OCRs a scanned page whose text layer holds only page furniture', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    // The old `length >= 3` check trusted this and returned nothing.
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakePdf([{ textLayer: ['Page 1 of 1'] }])),
    })
    mockOcrText('Rx\nTab. Cetirizine 10mg HS x 7 days')

    const result = await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(1)
    expect(result.medicines.map((m) => m.name)).toEqual(['Cetirizine'])
  })
})

describe('multi-page PDF', () => {
  it('reads past page three — the old cap silently dropped the rest', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakePdf(Array.from({ length: 6 }, () => ({ textLayer: [] })))),
    })
    const perPage = [
      'Rx\nTab. Amoxicillin 500mg TDS',
      'Rx\nSyp. Paracetamol 250mg/5ml SOS',
      'Rx\nCap. Omeprazole 20mg OD',
      'Rx\nTab. Cetirizine 10mg HS',
      'Rx\nInj. Ceftriaxone 1g BD',
      'Rx\nTab. Metformin 500mg OD',
    ]
    let page = 0
    recognizeMock.mockImplementation(async () => ({
      data: { text: perPage[page++], confidence: 92 },
    }))

    const result = await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(6)
    expect(result.stats.pages).toBe(6)
    expect(result.medicines).toHaveLength(6)
    // Page 6's medicine must be present — proof nothing was dropped.
    expect(result.medicines.map((m) => m.name)).toContain('Metformin')
  })

  it('mixes text-layer and OCR pages in one document', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakePdf([
          { textLayer: ['Rx', 'Tab. Amoxicillin 500mg TDS x 5 days'] },
          { textLayer: [] },
        ]),
      ),
    })
    mockOcrText('Rx\nTab. Metformin 500mg OD x 30 days')

    const result = await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(1) // page 2 only
    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Amoxicillin', 'Metformin'])
  })

  it('warns rather than silently dropping pages beyond the OCR ceiling', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    const { MAX_OCR_PAGES } = await import('../pdf-text')
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakePdf(Array.from({ length: MAX_OCR_PAGES + 3 }, () => ({ textLayer: [] }))),
      ),
    })
    mockOcrText('Rx\nTab. Amoxicillin 500mg TDS')

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.warnings.join(' ')).toMatch(/were skipped/i)
  })
})

// --- Worker lifecycle -------------------------------------------------------

describe('Tesseract worker reuse', () => {
  it('creates one worker for a whole multi-page scan', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakePdf(Array.from({ length: 5 }, () => ({ textLayer: [] })))),
    })
    mockOcrText('Rx\nTab. Amoxicillin 500mg TDS')

    await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).toHaveBeenCalledTimes(5)
    // The old code called Tesseract.recognize() per page, re-downloading the
    // ~15 MB language data each time.
    expect(createWorkerMock).toHaveBeenCalledTimes(1)
  })

  it('reuses the worker across separate scans', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\nTab. Amoxicillin 500mg TDS')

    await extractPrescriptionMeds(imageFile())
    await extractPrescriptionMeds(imageFile())

    expect(createWorkerMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed worker start', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    createWorkerMock.mockRejectedValueOnce(new Error('network error'))

    await expect(extractPrescriptionMeds(imageFile())).rejects.toThrow(/could not start the text reader/i)

    // A retry must be able to start a fresh worker.
    mockOcrText('Rx\nTab. Amoxicillin 500mg TDS')
    const result = await extractPrescriptionMeds(imageFile())
    expect(result.medicines.map((m) => m.name)).toEqual(['Amoxicillin'])
  })
})

// --- Format handling --------------------------------------------------------

describe('HEIC/HEIF handling', () => {
  it('rejects HEIC with an actionable message instead of "0 medicines found"', async () => {
    const { extractPrescriptionMeds, UnsupportedFormatError } = await loadPipeline()

    await expect(extractPrescriptionMeds(fakeFile('IMG_0042.HEIC', 'image/heic'))).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    )
    await expect(extractPrescriptionMeds(fakeFile('IMG_0042.heif', ''))).rejects.toThrow(/JPEG or PNG/i)
    expect(recognizeMock).not.toHaveBeenCalled()
  })
})

// --- Vision fallback merge --------------------------------------------------

describe('mergeVisionResults', () => {
  it('adds assisted-reading medicines as confirmable, never auto-accepted', async () => {
    const { extractPrescriptionMeds, mergeVisionResults } = await loadPipeline()
    mockOcrText('Patient Name: Thomas Okonkwo\nDate: 14/08/2026')
    const base = await extractPrescriptionMeds(imageFile())
    expect(base.needsVisionFallback).toBe(true)

    const merged = mergeVisionResults(base, [
      { name: 'Amoxicillin', strength: '500 mg', form: 'tablet', confidence: 0.9 },
    ])

    expect(merged.medicines).toHaveLength(1)
    expect(merged.medicines[0].needsConfirmation).toBe(true)
    expect(merged.unconfirmed).toHaveLength(1)
    expect(merged.confident).toEqual([])
    expect(merged.needsVisionFallback).toBe(false)
  })

  it('discards empty or nameless vision entries', async () => {
    const { extractPrescriptionMeds, mergeVisionResults } = await loadPipeline()
    mockOcrText('Date: 14/08/2026')
    const base = await extractPrescriptionMeds(imageFile())

    const merged = mergeVisionResults(base, [{ name: '' }, { name: 'x' }, null])
    expect(merged.medicines).toEqual([])
  })
})
