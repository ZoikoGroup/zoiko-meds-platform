import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFile, installDomStub, removeDomStub } from './setup'
import {
  HIGH_THRESHOLD,
  MATCH_SOURCE,
  VISION_AUTO_ACCEPT_MATCH,
  computeConfidence,
  needsConfirmation,
} from '../confidence'

/**
 * What decides whether a patient has to confirm a medicine.
 *
 * The rule was `source === VISION || source === UNMATCHED` — where the reading
 * came from settled it on its own. So assisted reading could name a medicine,
 * MediBase could match it exactly, and the patient was still asked to confirm
 * an identity the catalog had already established. Meanwhile a Tesseract
 * reading of the same medicine went straight through.
 *
 * The governed identity is what makes acceptance possible; the source only sets
 * how strong the match has to be before it happens. Assisted reading is held to
 * a higher bar than on-device text because its reading is the less certain half
 * of the pair — but a near-identical catalog name is evidence it read the line
 * correctly, and refusing to act on that was the defect.
 */

// --- Mocks ------------------------------------------------------------------

const recognizeMock = vi.fn()
const createWorkerMock = vi.fn()
const terminateMock = vi.fn(async () => {})

vi.mock('tesseract.js', () => ({ createWorker: (...args) => createWorkerMock(...args) }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

const CATALOG = [
  { id: 'm1', name: 'Amoxicillin', generic: 'Amoxicillin', brands: ['Novamox'], strength: '500 mg' },
  { id: 'm2', name: 'Paracetamol', generic: 'Paracetamol', brands: ['Calpol'], strength: '500 mg' },
  { id: 'm3', name: 'Omeprazole', generic: 'Omeprazole', brands: [], strength: '20 mg' },
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

/** A result the vision path would produce for a given catalog match strength. */
const visionScore = (matchScore, modelConfidence = 0.9) =>
  computeConfidence({
    nameSimilarity: matchScore,
    source: MATCH_SOURCE.VISION,
    evidence: { strength: true, form: true },
    ocrConfidence: modelConfidence,
  })

// --- The rule itself --------------------------------------------------------

describe('the decision is about identity, not origin', () => {
  it('confirms anything with no governed identity behind it', () => {
    // The medicine may well be real. The platform cannot say which medicine it
    // is, so there is nothing to accept.
    for (const source of [MATCH_SOURCE.UNMATCHED, MATCH_SOURCE.OFFLINE_DICTIONARY]) {
      expect(needsConfirmation(0.99, source, { medicineId: null })).toBe(true)
    }
  })

  it('confirms an assisted reading the catalog did not recognise', () => {
    expect(
      needsConfirmation(0.99, MATCH_SOURCE.VISION, { medicineId: null, matchScore: null }),
    ).toBe(true)
  })

  it('accepts an assisted reading matched at or above the vision bar', () => {
    expect(
      needsConfirmation(0.9, MATCH_SOURCE.VISION, {
        medicineId: 'm1',
        matchScore: VISION_AUTO_ACCEPT_MATCH,
      }),
    ).toBe(false)
  })

  it('confirms an assisted reading matched just below it', () => {
    expect(
      needsConfirmation(0.9, MATCH_SOURCE.VISION, {
        medicineId: 'm1',
        matchScore: VISION_AUTO_ACCEPT_MATCH - 0.01,
      }),
    ).toBe(true)
  })

  it('holds assisted reading to a higher match bar than on-device text', () => {
    // 0.8 clears the floor that lets a match be used at all, and is enough for
    // a Tesseract reading. It is not enough for a second attempt at text the
    // on-device reader could not resolve.
    const middling = { medicineId: 'm1', matchScore: 0.8 }

    expect(needsConfirmation(0.9, MATCH_SOURCE.MEDIBASE_FUZZY, middling)).toBe(false)
    expect(needsConfirmation(0.9, MATCH_SOURCE.VISION, middling)).toBe(true)
  })

  it('still requires the combined score to clear the ordinary bar', () => {
    // A perfect catalog name is not enough if everything else about the reading
    // was poor.
    expect(
      needsConfirmation(HIGH_THRESHOLD - 0.01, MATCH_SOURCE.VISION, {
        medicineId: 'm1',
        matchScore: 1,
      }),
    ).toBe(true)
  })

  it('treats a catalog source as carrying an identity when none is passed', () => {
    // resolveCandidate only returns a MediBase source because it found one, so
    // the two-argument call sites keep working unchanged.
    expect(needsConfirmation(0.9, MATCH_SOURCE.MEDIBASE_EXACT)).toBe(false)
    expect(needsConfirmation(0.5, MATCH_SOURCE.MEDIBASE_EXACT)).toBe(true)
  })
})

// --- The nine required cases, through the pipeline --------------------------

describe('the required cases', () => {
  const baseResult = async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Patient Name: Thomas Okonkwo\nDate: 14/08/2026', 0.9)
    return extractPrescriptionMeds(imageFile())
  }

  it('1. vision + strong exact MediBase match is auto-accepted', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const merged = await mergeVisionResults(await baseResult(), [
      { name: 'Amoxicillin', strength: '500 mg', form: 'tablet', confidence: 0.95 },
    ])

    expect(merged.medicines[0].medicineId).toBe('m1')
    expect(merged.medicines[0].needsConfirmation).toBe(false)
    expect(merged.confident).toHaveLength(1)
    expect(merged.unconfirmed).toEqual([])
  })

  it('2. vision + a close-but-not-exact match above the bar is accepted', async () => {
    // "Novamox" is a brand of Amoxicillin — a governed identity reached by a
    // different name, matched at 1.0 against that brand reference.
    const { mergeVisionResults } = await loadPipeline()
    const merged = await mergeVisionResults(await baseResult(), [
      { name: 'Novamox', strength: '500 mg', form: 'tablet', confidence: 0.92 },
    ])

    expect(merged.medicines[0].medicineId).toBe('m1')
    expect(merged.medicines[0].needsConfirmation).toBe(false)
  })

  it('3. vision + a weak match confirms', async () => {
    const { mergeVisionResults } = await loadPipeline()
    // A catalog answer close enough to use, nowhere near close enough to accept.
    matchMedicinesMock.mockResolvedValue([CATALOG[0]])
    const merged = await mergeVisionResults(await baseResult(), [
      { name: 'Amoxicilin Trihydrat', strength: '500 mg', confidence: 0.9 },
    ])

    expect(merged.medicines[0].needsConfirmation).toBe(true)
    expect(merged.confident).toEqual([])
  })

  it('4. vision + no match at all confirms', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const merged = await mergeVisionResults(await baseResult(), [
      { name: 'Zafirlukastium', strength: '250 mg', confidence: 0.95 },
    ])

    expect(merged.medicines[0].medicineId).toBeNull()
    expect(merged.medicines[0].needsConfirmation).toBe(true)
  })

  it('5. vision + non-medicine prose is discarded before matching', async () => {
    const { mergeVisionResults } = await loadPipeline()
    const merged = await mergeVisionResults(await baseResult(), [
      { name: 'Avoid alcohol', confidence: 0.99 },
      { name: 'Liver Function Test', confidence: 0.99 },
      { name: 'Keep area dry', confidence: 0.99 },
      { name: 'Amoxicillin', strength: '500 mg', form: 'tablet', confidence: 0.95 },
    ])

    expect(merged.medicines.map((m) => m.name)).toEqual(['Amoxicillin'])
    // Discarded before the catalog was ever asked about them.
    for (const call of matchMedicinesMock.mock.calls) {
      expect(call[0]).not.toMatch(/avoid alcohol|function test|keep area dry/i)
    }
  })

  it('6. tesseract + a strong match is still auto-accepted', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Rx\n1. Tab. Amoxicillin 500mg TDS x 5 days', 0.93)

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines[0].needsConfirmation).toBe(false)
    expect(result.confident).toHaveLength(1)
  })

  it('7. one uncatalogued medicine confirms, and only that one', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      [
        'Rx',
        '1. Tab. Amoxicillin 500mg TDS x 5 days',
        '2. Cap. Omeprazole 20mg OD',
        '3. Tab. Zafirlukastium 250mg BD x 5 days',
      ].join('\n'),
      0.93,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.confident.map((m) => m.name).sort()).toEqual(['Amoxicillin', 'Omeprazole'])
    expect(result.unconfirmed.map((m) => m.name)).toEqual(['Zafirlukastium'])
  })

  it('8. every medicine matched leaves nothing to confirm', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText(
      ['Rx', '1. Tab. Amoxicillin 500mg TDS', '2. Cap. Omeprazole 20mg OD'].join('\n'),
      0.94,
    )

    const result = await extractPrescriptionMeds(imageFile())

    expect(result.medicines).toHaveLength(2)
    expect(result.unconfirmed).toEqual([])
  })

  it('9. assisted reading stays opt-in — nothing is uploaded by extraction', async () => {
    // The pipeline never calls the vision endpoint. `needsVisionFallback` only
    // makes the button appear; mergeVisionResults runs when the patient clicks.
    const visionModule = await import('../vision-fallback')
    const spy = vi.spyOn(visionModule, 'extractWithVision')

    const { extractPrescriptionMeds } = await loadPipeline()
    mockOcrText('Patient Name: Thomas Okonkwo\nDate: 14/08/2026', 0.3)
    const result = await extractPrescriptionMeds(imageFile())

    expect(result.needsVisionFallback).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// --- Where the vision bar actually sits -------------------------------------

describe('the vision auto-accept bar', () => {
  it('is stricter than the floor that merely permits a match', () => {
    expect(VISION_AUTO_ACCEPT_MATCH).toBeGreaterThan(0.72)
  })

  it('scores a strong match above the ordinary acceptance threshold', () => {
    expect(visionScore(1)).toBeGreaterThanOrEqual(HIGH_THRESHOLD)
  })

  it('scores a merely permitted match below it', () => {
    expect(visionScore(0.75)).toBeLessThan(HIGH_THRESHOLD)
  })

  it('drops a strong match read off a line the model was unsure of', () => {
    // The model's own certainty about the line still counts, the way OCR
    // confidence does on the on-device path.
    expect(visionScore(1, 0.3)).toBeLessThan(HIGH_THRESHOLD)
  })
})
