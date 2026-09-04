// @vitest-environment jsdom
//
// The acceptance case for the layout fix, end to end.
//
// A two-column prescription — medicines on the left, directions on the right —
// used to arrive from pdfjs as one line per row, because the reconstruction
// grouped items by Y and ignored X. Everything downstream then had to unpick a
// row that should never have been joined, and the instruction text travelled
// attached to the medicine name.
//
// This runs a real two-column text layer through the whole local pipeline —
// layout, candidate extraction, parsing, matching, confidence — and requires
// exactly the three medicines out of it. The names live here, in the test,
// and nowhere in production logic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFile, installDomStub, removeDomStub } from './setup'

const recognizeMock = vi.fn()
const createWorkerMock = vi.fn()
const terminateMock = vi.fn(async () => {})

vi.mock('tesseract.js', () => ({ createWorker: (...a) => createWorkerMock(...a) }))

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...a) => getDocumentMock(...a),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

/**
 * A stand-in MediBase holding two of the three.
 *
 * Deliberately incomplete: Zimig is absent, so the run also proves a genuine
 * medicine the catalog has not seen still reaches the patient — for
 * confirmation rather than as an accepted identity.
 */
const CATALOG = [
  { id: 'm_lev', name: 'Levosiz', generic: 'Levocetirizine', brands: [], strength: '5 mg' },
  { id: 'm_for', name: 'Forcan', generic: 'Fluconazole', brands: [], strength: '150 mg' },
]

async function catalogMatch(query) {
  const { similarity } = await import('../text-normalize')
  return CATALOG.map((entry) => ({
    entry,
    score: Math.max(...[entry.name, entry.generic].map((r) => similarity(query, r))),
  }))
    .filter((row) => row.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.entry)
}

const matchMedicinesMock = vi.fn(catalogMatch)
vi.mock('@/services/medicine-api', () => ({
  matchMedicines: (...a) => matchMedicinesMock(...a),
}))

const FONT = 10

/** A positioned text item, as pdfjs emits one. */
const item = (str, x, y, width = str.length * 5) => ({
  str,
  width,
  height: FONT,
  transform: [FONT, 0, 0, FONT, x, y],
  hasEOL: false,
})

/**
 * The prescription as a text layer: two columns, plus the section headings and
 * clinical text that surround a real one.
 */
const TWO_COLUMN_PAGE = [
  item('Symptoms(HOPI)', 50, 760, 70),
  item('itching and redness', 50, 745, 85),
  item('Diagnosis', 50, 725, 45),
  item('Fungal infection', 50, 710, 75),
  item('Medicines', 50, 690, 48),

  // Medicine column at x=50, directions column at x=300.
  item('1. Levosiz 5mg Tablet', 50, 670, 110),
  item('Night - 1', 300, 670, 45),
  item('Daily for 5 days', 300, 656, 72),

  item('2. Zimig 1% w/w Cream', 50, 636, 112),
  item('Apply twice daily', 300, 636, 80),
  item('Keep area dry', 300, 622, 62),

  item('3. Forcan 150mg Tablet', 50, 602, 115),
  item('Weekly once', 300, 602, 55),
  item('Avoid Alcohol', 300, 588, 62),

  item('Lab Tests', 50, 560, 42),
  item('Kidney Function Test', 50, 545, 92),
  item('Liver Function Test', 50, 530, 88),
]

const pdfWithLayer = (items) => {
  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items }) }),
    }),
  })
}

const loadPipeline = async () => {
  vi.resetModules()
  return import('../extract-prescription')
}

const pdfFile = () => fakeFile('rx.pdf', 'application/pdf')

/** The forbidden text — none of it may reach the medicine list. */
const FORBIDDEN = [
  'Symptoms',
  'HOPI',
  'itching and redness',
  'And Redness',
  'Diagnosis',
  'Liver Function Test',
  'Kidney Function Test',
  'Daily',
  'Daly',
  'Avoid Alcohol',
  'Apply twice daily',
  'Keep area dry',
  'Weekly once',
  'Night',
]

beforeEach(() => {
  installDomStub()
  vi.clearAllMocks()
  matchMedicinesMock.mockImplementation(catalogMatch)
  createWorkerMock.mockImplementation(async () => ({
    recognize: recognizeMock,
    terminate: terminateMock,
  }))
  pdfWithLayer(TWO_COLUMN_PAGE)
})

afterEach(() => removeDomStub())

describe('a two-column text PDF, end to end', () => {
  it('extracts exactly three medicines', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.medicines).toHaveLength(3)
  })

  it('extracts the three that are on the page', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Forcan', 'Levosiz', 'Zimig'])
  })

  it('keeps each strength and form with its medicine', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const byName = Object.fromEntries(
      (await extractPrescriptionMeds(pdfFile())).medicines.map((m) => [
        m.name,
        { strength: m.strength, form: m.form },
      ]),
    )

    expect(byName.Levosiz).toEqual({ strength: '5mg', form: 'tablet' })
    expect(byName.Zimig).toEqual({ strength: '1% w/w', form: 'cream' })
    expect(byName.Forcan).toEqual({ strength: '150mg', form: 'tablet' })
  })

  it.each(FORBIDDEN)('never reports %s as a medicine', async (noise) => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const names = (await extractPrescriptionMeds(pdfFile())).medicines.map((m) =>
      m.name.toLowerCase(),
    )

    expect(names.join(' | ')).not.toContain(noise.toLowerCase())
  })

  it('never carries a direction inside a medicine name', async () => {
    // What the Y-only grouping produced: "Levosiz 5mg Tablet Night - 1".
    const { extractPrescriptionMeds } = await loadPipeline()

    for (const medicine of (await extractPrescriptionMeds(pdfFile())).medicines) {
      expect(medicine.name).not.toMatch(/night|daily|apply|weekly|avoid|keep/i)
    }
  })

  it('runs no OCR on a text PDF', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    await extractPrescriptionMeds(pdfFile())

    expect(recognizeMock).not.toHaveBeenCalled()
  })

  it('reports no OCR confidence, because no OCR ran', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    expect((await extractPrescriptionMeds(pdfFile())).stats.ocrConfidence).toBeNull()
  })
})

describe('what the patient is asked to confirm', () => {
  it('accepts the two the catalog governs', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.confident.map((m) => m.name).sort()).toEqual(['Forcan', 'Levosiz'])
  })

  it('asks about the one it does not', async () => {
    // Absence from MediBase is a fact about the catalog, so the medicine still
    // reaches the patient — for confirmation, without a governed identity.
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.unconfirmed.map((m) => m.name)).toEqual(['Zimig'])
    expect(result.unconfirmed[0].medicineId).toBeNull()
  })

  it('does not call the scan a failure for that one', async () => {
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.quality.quality).toBe('good')
    expect(result.needsVisionFallback).toBe(false)
  })
})

describe('the single-column form of the same page still works', () => {
  it('extracts the same three medicines', async () => {
    // The fix must not depend on the layout being two columns.
    const singleColumn = [
      item('Medicines', 50, 690, 48),
      item('1. Levosiz 5mg Tablet', 50, 670, 110),
      item('Night - 1', 50, 656, 45),
      item('2. Zimig 1% w/w Cream', 50, 636, 112),
      item('Apply twice daily', 50, 622, 80),
      item('3. Forcan 150mg Tablet', 50, 602, 115),
      item('Weekly once', 50, 588, 55),
    ]
    pdfWithLayer(singleColumn)
    const { extractPrescriptionMeds } = await loadPipeline()

    const result = await extractPrescriptionMeds(pdfFile())

    expect(result.medicines.map((m) => m.name).sort()).toEqual(['Forcan', 'Levosiz', 'Zimig'])
  })
})
