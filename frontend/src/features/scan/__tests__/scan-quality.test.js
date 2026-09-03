import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFile, installDomStub, removeDomStub } from './setup'
import { assessScanQuality, looksCorrupted } from '../scan-quality'
import { MATCH_SOURCE } from '../confidence'

/**
 * When assisted reading is worth offering.
 *
 * The old rule was `medicines.length === 0 || confident.length === 0`, and it
 * was wrong in both directions.
 *
 * Too weak: a photographed prescription whose instruction column bleeds into
 * the medicine column produces plenty of text and one recognisable brand. One
 * confident medicine, so the offer was withheld from precisely the scan that
 * needed it.
 *
 * Too aggressive: UNMATCHED always requires confirmation, so three medicines
 * MediBase has not catalogued yet produced zero confident rows and the whole
 * scan was declared a failure. That is a fact about the catalog, not evidence
 * the page was misread, and it called for a second attempt at lines that were
 * read correctly the first time.
 */

// --- Mocks, matching the pipeline suite -------------------------------------

const recognizeMock = vi.fn()
const createWorkerMock = vi.fn()
const terminateMock = vi.fn(async () => {})

vi.mock('tesseract.js', () => ({ createWorker: (...args) => createWorkerMock(...args) }))

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args) => getDocumentMock(...args),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

const CATALOG = [
  { id: 'm1', name: 'Amoxicillin', generic: 'Amoxicillin', brands: ['Novamox'], strength: '500 mg' },
  { id: 'm2', name: 'Paracetamol', generic: 'Paracetamol', brands: ['Calpol'], strength: '500 mg' },
  { id: 'm3', name: 'Omeprazole', generic: 'Omeprazole', brands: [], strength: '20 mg' },
  { id: 'm4', name: 'Cetirizine', generic: 'Cetirizine', brands: ['Zyrtec'], strength: '10 mg' },
]

async function defaultCatalogMatch(query) {
  const { similarity } = await import('../text-normalize')
  return CATALOG.map((entry) => ({
    entry,
    score: Math.max(
      ...[entry.name, entry.generic, ...entry.brands].map((r) => similarity(query, r)),
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

const mockOcrText = (text, confidence = 0.92) =>
  recognizeMock.mockResolvedValue({ data: { text, confidence: confidence * 100 } })

const loadPipeline = async () => {
  vi.resetModules()
  return import('../extract-prescription')
}

const imageFile = () => fakeFile('rx.jpg', 'image/jpeg')

beforeEach(() => {
  installDomStub()
  vi.clearAllMocks()
  matchMedicinesMock.mockImplementation(defaultCatalogMatch)
  createWorkerMock.mockImplementation(async () => ({
    recognize: recognizeMock,
    terminate: terminateMock,
  }))
  mockOcrText('')
})

afterEach(() => removeDomStub())

// --- The assessor on its own ------------------------------------------------

const medicine = (over = {}) => ({
  name: 'Amoxicillin',
  source: MATCH_SOURCE.MEDIBASE_EXACT,
  confidence: 0.88,
  ...over,
})

const LINES = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the page`).join('\n')

describe('assessScanQuality', () => {
  it('calls a clean extraction good and offers nothing', () => {
    const result = assessScanQuality({
      rawText: 'Rx\n1. Tab. Amoxicillin 500mg TDS',
      ocrConfidence: 0.93,
      candidateCount: 1,
      medicines: [medicine()],
    })

    expect(result.quality).toBe('good')
    expect(result.reasons).toEqual([])
    expect(result.shouldOfferVision).toBe(false)
  })

  it('calls an empty page poor', () => {
    const result = assessScanQuality({ rawText: '   \n\n', ocrConfidence: 0.9 })

    expect(result.quality).toBe('poor')
    expect(result.reasons).toEqual(['NO_TEXT'])
    expect(result.shouldOfferVision).toBe(true)
  })

  it('flags a very low OCR confidence on its own', () => {
    const result = assessScanQuality({
      rawText: 'Rx\nTab. Amoxicillin 500mg',
      ocrConfidence: 0.31,
      candidateCount: 1,
      medicines: [medicine()],
    })

    expect(result.reasons).toContain('VERY_LOW_OCR_CONFIDENCE')
    expect(result.quality).toBe('poor')
  })

  it('treats a merely low OCR confidence as uncertain, not failed', () => {
    const result = assessScanQuality({
      rawText: 'Rx\nTab. Amoxicillin 500mg',
      ocrConfidence: 0.5,
      candidateCount: 1,
      medicines: [medicine()],
    })

    expect(result.reasons).toContain('LOW_OCR_CONFIDENCE')
    expect(result.quality).toBe('uncertain')
    expect(result.shouldOfferVision).toBe(true)
  })

  it('flags a full page that yielded no candidate at all', () => {
    const result = assessScanQuality({
      rawText: LINES(9),
      ocrConfidence: 0.85,
      candidateCount: 0,
      medicines: [],
    })

    expect(result.reasons).toContain('TEXT_BUT_NO_CANDIDATES')
    expect(result.quality).toBe('poor')
  })

  it('flags several readings the catalog recognised none of', () => {
    const result = assessScanQuality({
      rawText: LINES(8),
      ocrConfidence: 0.8,
      candidateCount: 4,
      medicines: [
        medicine({ name: 'Zafrilukast', source: MATCH_SOURCE.UNMATCHED, confidence: 0.55 }),
        medicine({ name: 'Ombitasvira', source: MATCH_SOURCE.UNMATCHED, confidence: 0.55 }),
        medicine({ name: 'Tenofoviren', source: MATCH_SOURCE.UNMATCHED, confidence: 0.55 }),
      ],
    })

    expect(result.reasons).toContain('NO_CATALOG_MATCHES')
  })

  it('does NOT flag one uncatalogued medicine', () => {
    // The rule item 6 exists for: a genuine new medicine is not a failed scan.
    const result = assessScanQuality({
      rawText: 'Rx\nTab. Zafirlukastium 250mg BD x 5 days',
      ocrConfidence: 0.8,
      candidateCount: 1,
      medicines: [medicine({ name: 'Zafirlukastium', source: MATCH_SOURCE.UNMATCHED, confidence: 0.6 })],
    })

    expect(result.reasons).not.toContain('NO_CATALOG_MATCHES')
    expect(result.quality).toBe('good')
    expect(result.shouldOfferVision).toBe(false)
  })

  it('does NOT flag two uncatalogued medicines either', () => {
    const result = assessScanQuality({
      rawText: LINES(6),
      ocrConfidence: 0.85,
      candidateCount: 2,
      medicines: [
        medicine({ name: 'Zafirlukastium', source: MATCH_SOURCE.UNMATCHED, confidence: 0.6 }),
        medicine({ name: 'Bempedoicacid', source: MATCH_SOURCE.UNMATCHED, confidence: 0.6 }),
      ],
    })

    expect(result.reasons).not.toContain('NO_CATALOG_MATCHES')
  })

  it('does not blame the catalog when the catalog was unreachable', () => {
    const result = assessScanQuality({
      rawText: LINES(8),
      ocrConfidence: 0.85,
      candidateCount: 4,
      catalogReachable: false,
      medicines: [
        medicine({ source: MATCH_SOURCE.OFFLINE_DICTIONARY, confidence: 0.7 }),
        medicine({ source: MATCH_SOURCE.OFFLINE_DICTIONARY, confidence: 0.7 }),
        medicine({ source: MATCH_SOURCE.OFFLINE_DICTIONARY, confidence: 0.7 }),
      ],
    })

    expect(result.reasons).not.toContain('NO_CATALOG_MATCHES')
  })

  it('flags a high rejection rate', () => {
    const result = assessScanQuality({
      rawText: LINES(10),
      ocrConfidence: 0.85,
      candidateCount: 8,
      medicines: [medicine()],
    })

    expect(result.reasons).toContain('HIGH_REJECTION_RATE')
  })

  it('flags rows the page numbered but the reader lost', () => {
    const result = assessScanQuality({
      rawText: ['Rx', '1. Tab. Amoxicillin 500mg', '2. Cap. Omeprazole 20mg', '3. Tab. Cetirizine 10mg'].join('\n'),
      ocrConfidence: 0.85,
      candidateCount: 1,
      medicines: [medicine()],
    })

    expect(result.signals.numberedRows).toBe(3)
    expect(result.reasons).toContain('ROWS_LOST')
  })

  it('does not flag a one-row shortfall', () => {
    const result = assessScanQuality({
      rawText: ['1. Tab. Amoxicillin 500mg', '2. Cap. Omeprazole 20mg'].join('\n'),
      ocrConfidence: 0.9,
      candidateCount: 1,
      medicines: [medicine()],
    })

    expect(result.reasons).not.toContain('ROWS_LOST')
  })

  it('flags names that read as guessed characters', () => {
    const result = assessScanQuality({
      rawText: LINES(6),
      ocrConfidence: 0.7,
      candidateCount: 2,
      medicines: [
        medicine({ name: 'Amescitin Cepsutel' }),
        medicine({ name: 'Frcnstlm' }),
      ],
    })

    expect(result.reasons).toContain('CORRUPTED_NAMES')
    expect(result.quality).toBe('poor')
  })

  it('does not condemn a scan for one odd-looking brand', () => {
    const result = assessScanQuality({
      rawText: LINES(6),
      ocrConfidence: 0.9,
      candidateCount: 3,
      medicines: [medicine(), medicine({ name: 'Paracetamol' }), medicine({ name: 'Frcnstlm' })],
    })

    expect(result.reasons).not.toContain('CORRUPTED_NAMES')
  })

  it('flags an extraction nothing in it is worth presenting', () => {
    const result = assessScanQuality({
      rawText: LINES(6),
      ocrConfidence: 0.8,
      candidateCount: 2,
      medicines: [medicine({ confidence: 0.42 }), medicine({ name: 'Paracetamol', confidence: 0.44 })],
    })

    expect(result.reasons).toContain('WEAK_EXTRACTION')
    expect(result.quality).toBe('uncertain')
  })

  it('never shows a reason code to the user', () => {
    // Codes are for tests and for the decision; the card says the reader was
    // unsure, not HIGH_REJECTION_RATE.
    const result = assessScanQuality({ rawText: LINES(9), candidateCount: 0, medicines: [] })

    for (const reason of result.reasons) {
      expect(reason).toMatch(/^[A-Z_]+$/)
    }
  })
})

describe('looksCorrupted', () => {
  it.each(['Frcnstlm', 'F0rcan', 'Levos1z', 'Zzqqxxvv'])('flags %s', (name) => {
    expect(looksCorrupted(name)).toBe(true)
  })

  it('cannot catch a misread that still looks like a word', () => {
    // "Amoxicillin" misread as "Amescitin" is the dangerous case and this test
    // records that this signal does not catch it: the vowel ratio is ordinary
    // and so is the letter run. Tightening the rule until it did would start
    // rejecting real brand names, which is the more expensive mistake.
    //
    // That class of error is caught by the other signals instead — it will not
    // match the catalog, and it travels with the low OCR confidence that
    // produced it.
    expect(looksCorrupted('Amescitin')).toBe(false)
  })

  it.each([
    'Amoxicillin',
    'Paracetamol',
    'Ceftriaxone',
    'Zafirlukastium',
    'Bempedoic',
    'Pan',
    'Zimig',
  ])('leaves %s alone', (name) => {
    expect(looksCorrupted(name)).toBe(false)
  })

  it('does not flag a strength written normally', () => {
    expect(looksCorrupted('Levosiz 5mg')).toBe(false)
  })
})

// --- Through the whole pipeline ---------------------------------------------

describe('the ten cases, end to end', () => {
  it('1. a clean printed prescription does not offer assisted reading', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      ['Rx', '1. Tab. Amoxicillin 500mg TDS x 5 days', '2. Cap. Omeprazole 20mg OD'].join('\n'),
      0.94,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.quality.quality).toBe('good')
    expect(result.needsVisionFallback).toBe(false)
    expect(result.medicines).toHaveLength(2)
  })

  it('2. an empty read offers it', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('   ', 0.9)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.quality.reasons).toContain('NO_TEXT')
    expect(result.needsVisionFallback).toBe(true)
  })

  it('3. plenty of text and zero medicines offers it', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'City Hospital, Main Road',
        'Patient Name: Thomas Okonkwo',
        'Age: 41  Sex: M',
        'Date: 14/08/2026',
        'Reg No: 88213-A',
        'Dr. A. Mehta MBBS MD',
        'Follow up after one week',
      ].join('\n'),
      0.9,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toEqual([])
    expect(result.quality.quality).toBe('poor')
    expect(result.needsVisionFallback).toBe(true)
  })

  it('4. a low OCR confidence offers it', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\n1. Tab. Amoxicillin 500mg TDS x 5 days', 0.35)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.quality.reasons).toContain('VERY_LOW_OCR_CONFIDENCE')
    expect(result.needsVisionFallback).toBe(true)
  })

  it('5. three strong catalog matches do not offer it', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'Rx',
        '1. Tab. Amoxicillin 500mg TDS x 5 days',
        '2. Cap. Omeprazole 20mg OD',
        '3. Tab. Cetirizine 10mg HS x 7 days',
      ].join('\n'),
      0.93,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toHaveLength(3)
    expect(result.quality.signals.matched).toBe(3)
    expect(result.needsVisionFallback).toBe(false)
  })

  it('6. one uncatalogued medicine does not fail the whole scan', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      ['Rx', '1. Tab. Amoxicillin 500mg TDS', '2. Tab. Zafirlukastium 250mg BD x 5 days'].join('\n'),
      0.9,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines.length).toBeGreaterThanOrEqual(2)
    expect(result.quality.quality).toBe('good')
    expect(result.needsVisionFallback).toBe(false)
  })

  it('7. instructions dominating the extraction is not called good', async () => {
    // The reported shape: the instruction column read as its own rows.
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'Rx',
        '1. Levosiz 5mg',
        'And Redness',
        'Forcan Anemaoon 150mg',
        'Avoid Alcohol',
        'Liver Function Test',
        'Keep area dry',
        '2. Zimig 1% w/w Cream',
        '3. Forcan 150mg Tablet',
      ].join('\n'),
      0.62,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.quality.quality).not.toBe('good')
    expect(result.needsVisionFallback).toBe(true)
  })

  it('8. column bleed at a middling OCR confidence is uncertain at best', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'Rx',
        '1. Tab. Amoxicillin 500mg   Morning-1   After food',
        '2. Cap. Omeprazole 20mg   Night-1   Avoid alcohol',
        '3. Tab. Cetirizine 10mg   Weekly once   Keep area dry',
        '4. Syp. Paracetamol 250mg   SOS',
      ].join('\n'),
      0.48,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.quality.quality).not.toBe('good')
    expect(result.needsVisionFallback).toBe(true)
  })

  it('9. a clean text PDF runs no OCR and offers nothing', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: 'Rx', transform: [1, 0, 0, 1, 0, 700] },
              { str: '1. Tab. Amoxicillin 500mg TDS x 5 days', transform: [1, 0, 0, 1, 0, 680] },
              { str: '2. Cap. Omeprazole 20mg OD', transform: [1, 0, 0, 1, 0, 660] },
            ],
          }),
        }),
      }),
    })

    const result = await extractPrescriptionMeds(fakeFile('rx.pdf', 'application/pdf'))

    expect(recognizeMock).not.toHaveBeenCalled()
    // No OCR step, so no OCR confidence to judge — and nothing is invented for it.
    expect(result.stats.ocrConfidence).toBeNull()
    expect(result.quality.quality).toBe('good')
    expect(result.needsVisionFallback).toBe(false)
  })

  it('10. a scanned PDF is judged by the same policy', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    // An empty text layer forces the page down the OCR path.
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] }),
          getViewport: () => ({ width: 600, height: 800 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      }),
    })
    mockOcrText('Rx\n1. Tab. Amoxicillin 500mg TDS x 5 days', 0.3)

    const result = await extractPrescriptionMeds(fakeFile('rx.pdf', 'application/pdf'))

    expect(result.quality.reasons).toContain('VERY_LOW_OCR_CONFIDENCE')
    expect(result.needsVisionFallback).toBe(true)
  })
})

// --- The vision path still validates ----------------------------------------

describe('assisted-reading output goes through the same validation', () => {
  const baseResult = async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Patient Name: Thomas Okonkwo\nDate: 14/08/2026', 0.9)
    return extractPrescriptionMeds(imageFile())
  }

  it('rejects non-medicine text the model transcribed', async () => {
    // The model reads the page faithfully, including the instruction column.
    // A clear reading of "Avoid alcohol" is still not a medicine.
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()

    const merged = await mergeVisionResults(base, [
      { name: 'Avoid alcohol', confidence: 0.95 },
      { name: 'Kidney Function Test', confidence: 0.95 },
      { name: 'Amoxicillin', strength: '500 mg', form: 'tablet', confidence: 0.9 },
    ])

    expect(merged.medicines.map((m) => m.name)).toEqual(['Amoxicillin'])
  })

  it('attaches the MediBase identity when the catalog recognises the name', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()

    const merged = await mergeVisionResults(base, [
      { name: 'Amoxicillin', strength: '500 mg', confidence: 0.9 },
    ])

    expect(merged.medicines[0].medicineId).toBe('m1')
  })

  it('accepts a medicine the catalog matched closely', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()

    const merged = await mergeVisionResults(base, [
      { name: 'Amoxicillin', strength: '500 mg', form: 'tablet', confidence: 0.99 },
    ])

    expect(merged.medicines[0].needsConfirmation).toBe(false)
    expect(merged.confident.map((m) => m.name)).toEqual(['Amoxicillin'])
  })

  it('keeps a genuine medicine the catalog does not hold', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()

    const merged = await mergeVisionResults(base, [
      { name: 'Zafirlukastium', strength: '250 mg', confidence: 0.85 },
    ])

    expect(merged.medicines).toHaveLength(1)
    expect(merged.medicines[0].medicineId).toBeNull()
    expect(merged.medicines[0].needsConfirmation).toBe(true)
  })

  it('survives an unreachable catalog', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()
    matchMedicinesMock.mockRejectedValue(new Error('offline'))

    const merged = await mergeVisionResults(base, [{ name: 'Amoxicillin', confidence: 0.9 }])

    expect(merged.medicines).toHaveLength(1)
    expect(merged.medicines[0].needsConfirmation).toBe(true)
  })

  it('clears the offer once assisted reading has run', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const base = await baseResult()

    const merged = await mergeVisionResults(base, [{ name: 'Amoxicillin', confidence: 0.9 }])

    expect(merged.needsVisionFallback).toBe(false)
    expect(merged.visionUsed).toBe(true)
  })
})
