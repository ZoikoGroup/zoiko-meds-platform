// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Reading moved to the server, and this is the seam where the backend's
 * verification contract becomes the shape the results UI already rendered.
 *
 * Two things are held here. The adaptation itself — MATCHED is a confident row,
 * AMBIGUOUS and NOT_FOUND are rows that ask the patient to confirm — and the
 * fact that a matched medicine is carried forward under the *catalog's* name
 * rather than the reading, because everything downstream (the pharmacy
 * availability search included) should key on the identity MediBase settled on.
 *
 * The third thing, further down, is a guard rather than a behaviour: the active
 * scan path must not pull in Tesseract or pdf.js again.
 */

const apiFetchMock = vi.fn()
vi.mock('@/lib/api-client', () => ({
  apiFetch: (...args) => apiFetchMock(...args),
}))

const { readPrescription, VERIFICATION, PrescriptionReadError } = await import(
  '../prescription-reader'
)

const MATCHED = {
  extracted: {
    rawText: 'Dolo 650 mg Tablet', name: 'Dolo', strength: '650 mg', dosageForm: 'tablet',
    dose: '1 tablet', frequency: 'BD', duration: '3 days', route: null, instructions: null,
  },
  verification: {
    status: 'MATCHED',
    medicine: {
      id: 'med_dolo', brandName: 'Dolo 650', genericName: 'Paracetamol',
      strength: '650 mg', manufacturer: 'Micro Labs Ltd', dosageForm: 'Tablet',
    },
    candidates: [],
    reason: null,
  },
}

const AMBIGUOUS = {
  extracted: { rawText: 'Pan 40', name: 'Pan', strength: '40 mg', dosageForm: null,
    dose: null, frequency: null, duration: null, route: null, instructions: null },
  verification: {
    status: 'AMBIGUOUS',
    medicine: null,
    candidates: [
      { id: 'a', brandName: 'Pan 40', genericName: 'Pantoprazole', strength: '40 mg', manufacturer: null, dosageForm: 'Tablet' },
      { id: 'b', brandName: 'Pantop 40', genericName: 'Pantoprazole', strength: '40 mg', manufacturer: null, dosageForm: 'Tablet' },
    ],
    reason: 'More than one medicine in the catalog could be this. Choose the right one.',
  },
}

const NOT_FOUND = {
  extracted: { rawText: 'Zyxiva 100 mg', name: 'Zyxiva', strength: '100 mg', dosageForm: null,
    dose: null, frequency: null, duration: null, route: null, instructions: null },
  verification: {
    status: 'NOT_FOUND', medicine: null, candidates: [],
    reason: 'This medicine is not in the ZoikoMeds catalog. Search by name to check.',
  },
}

const file = (name = 'rx.png', type = 'image/png') =>
  new File([new Uint8Array([1, 2, 3, 4])], name, { type })

beforeEach(() => {
  apiFetchMock.mockReset()
})

describe('what it sends', () => {
  it('posts the whole file to the backend as a data URL', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [] })

    await readPrescription(file())

    const [path, options] = apiFetchMock.mock.calls[0]
    expect(path).toBe('/scan/prescription')
    expect(options.method).toBe('POST')
    expect(options.body.file).toMatch(/^data:image\/png;base64,/)
  })

  it('sends a PDF the same way, without reading it in the browser first', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'pdf' }, medicines: [] })

    await readPrescription(file('rx.pdf', 'application/pdf'))

    const [, options] = apiFetchMock.mock.calls[0]
    expect(options.body.file).toMatch(/^data:application\/pdf;base64,/)
    // One request. No page rasterization, no per-page round trip.
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('never sends a provider name or a credential', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [] })

    await readPrescription(file())

    const sent = JSON.stringify(apiFetchMock.mock.calls[0])
    expect(sent.toLowerCase()).not.toContain('gemini')
    expect(sent.toLowerCase()).not.toContain('api_key')
    expect(sent.toLowerCase()).not.toContain('apikey')
  })
})

describe('MATCHED', () => {
  it('becomes a confident row carrying the catalog identity', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [MATCHED] })

    const result = await readPrescription(file())

    expect(result.confident).toHaveLength(1)
    expect(result.unconfirmed).toHaveLength(0)
    const [medicine] = result.confident
    expect(medicine.status).toBe(VERIFICATION.MATCHED)
    expect(medicine.needsConfirmation).toBe(false)
    expect(medicine.medicineId).toBe('med_dolo')
  })

  it('carries the medicine forward under the catalog name, not the reading', async () => {
    // "Dolo" was on the page; "Dolo 650" is what MediBase settled on, and that
    // is what the availability search should be given.
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [MATCHED] })

    const [medicine] = (await readPrescription(file())).confident

    expect(medicine.name).toBe('Dolo 650')
    expect(medicine.detail).toContain('Paracetamol')
    expect(medicine.detail).toContain('Micro Labs Ltd')
  })

  it('still keeps the raw reading, so a human can check it', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [MATCHED] })

    const [medicine] = (await readPrescription(file())).confident

    expect(medicine.sourceText).toBe('Dolo 650 mg Tablet')
  })
})

describe('AMBIGUOUS', () => {
  it('asks the patient to confirm rather than choosing one', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [AMBIGUOUS] })

    const result = await readPrescription(file())

    expect(result.confident).toHaveLength(0)
    expect(result.unconfirmed).toHaveLength(1)
    const [medicine] = result.unconfirmed
    expect(medicine.needsConfirmation).toBe(true)
    expect(medicine.medicineId).toBeNull()
    expect(medicine.candidates).toHaveLength(2)
    expect(medicine.reason).toMatch(/choose/i)
  })

  it('labels it with the reading plus its strength, so two strengths stay apart', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [AMBIGUOUS] })

    const [medicine] = (await readPrescription(file())).unconfirmed

    expect(medicine.name).toBe('Pan 40 mg')
  })

  it('does not repeat a strength the name already carries', async () => {
    const already = {
      ...AMBIGUOUS,
      extracted: { ...AMBIGUOUS.extracted, name: 'Dolo 650', strength: '650 mg' },
    }
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [already] })

    const [medicine] = (await readPrescription(file())).unconfirmed

    expect(medicine.name).toBe('Dolo 650')
  })
})

describe('NOT_FOUND', () => {
  it('keeps the reading so the patient can search by hand', async () => {
    apiFetchMock.mockResolvedValue({ success: true, source: { type: 'image' }, medicines: [NOT_FOUND] })

    const [medicine] = (await readPrescription(file())).unconfirmed

    expect(medicine.status).toBe(VERIFICATION.NOT_FOUND)
    expect(medicine.needsConfirmation).toBe(true)
    expect(medicine.medicineId).toBeNull()
    expect(medicine.name).toBe('Zyxiva 100 mg')
    expect(medicine.sourceText).toBe('Zyxiva 100 mg')
    expect(medicine.reason).toMatch(/not in the ZoikoMeds catalog/i)
  })
})

describe('several medicines at once', () => {
  it('splits them by whether the catalog could confirm them', async () => {
    apiFetchMock.mockResolvedValue({
      success: true,
      source: { type: 'pdf' },
      medicines: [MATCHED, AMBIGUOUS, NOT_FOUND],
    })

    const result = await readPrescription(file('rx.pdf', 'application/pdf'))

    expect(result.medicines).toHaveLength(3)
    expect(result.confident.map((m) => m.name)).toEqual(['Dolo 650'])
    expect(result.unconfirmed.map((m) => m.status)).toEqual(['AMBIGUOUS', 'NOT_FOUND'])
  })
})

describe('nothing could be read', () => {
  it('reports an empty result and offers the retry guidance the UI already has', async () => {
    apiFetchMock.mockResolvedValue({
      success: true,
      source: { type: 'image' },
      medicines: [],
      message: "We couldn't confidently identify any medicines from this prescription.",
    })

    const result = await readPrescription(file())

    expect(result.medicines).toEqual([])
    expect(result.needsVisionFallback).toBe(true)
    expect(result.message).toMatch(/couldn't confidently identify/i)
  })

  it('surfaces a backend failure as something the patient can act on', async () => {
    apiFetchMock.mockRejectedValue(new Error('That file is larger than 10 MB.'))

    await expect(readPrescription(file())).rejects.toBeInstanceOf(PrescriptionReadError)
    await expect(readPrescription(file())).rejects.toThrow(/larger than 10 MB/)
  })
})

describe('the on-device readers are off this path', () => {
  const sourceOf = (relative) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it('does not pull Tesseract into the scan component or the reader', () => {
    // The guard that keeps the active path server-side. ocr-worker.js and
    // pdf-text.js still exist and are still tested — they are simply not
    // reachable from a scan any more.
    for (const file of ['../scan-prescription.jsx', '../prescription-reader.js']) {
      const source = sourceOf(file)
      expect(source).not.toMatch(/from\s+['"]tesseract\.js['"]/)
      expect(source).not.toMatch(/from\s+['"]\.\/ocr-worker['"]/)
    }
  })

  it('does not pull pdf.js or local PDF text extraction into them either', () => {
    for (const file of ['../scan-prescription.jsx', '../prescription-reader.js']) {
      const source = sourceOf(file)
      expect(source).not.toMatch(/from\s+['"]pdfjs-dist/)
      expect(source).not.toMatch(/from\s+['"]\.\/pdf-text['"]/)
    }
  })

  it('does not reach the old on-device extractor', () => {
    expect(sourceOf('../scan-prescription.jsx')).not.toMatch(
      /from\s+['"]\.\/extract-prescription['"]/,
    )
  })
})
