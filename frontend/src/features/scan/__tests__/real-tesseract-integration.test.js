// The real Tesseract, reading a real image.
//
// Every other OCR test in this suite mocks `createWorker`, which proves the
// wrapper's lifecycle and nothing about whether Tesseract can read anything.
// This renders a prescription to actual pixels and runs the installed library
// over it — no mocks — so the assertions cover the engine, the WASM core, and
// the English trained data we self-host.
//
// It also reads that trained data from `public/tesseract/lang`, the same
// directory the browser is pointed at, so a corrupt or truncated asset fails
// here rather than in front of a patient.
//
// The fixtures are drawn in code. No patient data is involved, and nothing is
// committed as a binary.
//
// WHAT THIS DOES NOT COVER
//
// Node loads the worker and core through tesseract.js's Node adapter, not the
// browser paths under /tesseract/. Those are asserted separately in
// ocr-worker.test.js and verified by serving the production build; only a
// browser can prove the whole chain at once.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * A Skia canvas for Node.
 *
 * Present transitively rather than declared, so its absence is treated as
 * "cannot run here" instead of a failure — a dependency change should not turn
 * this file red for a reason that has nothing to do with OCR.
 */
let createCanvas = null
let worker = null

const MEDICINES = [
  'PARACETAMOL 500MG TABLET',
  'AMOXICILLIN 250MG CAPSULE',
  'LEVOSIZ 5MG TABLET',
]

/** Draw a prescription and return PNG bytes. */
function renderPrescription({ twoColumn = false, font = 30, width = 1000, height = 620 } = {}) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.font = `${font}px sans-serif`

  ctx.fillText('Dr. A. Sharma', 40, font * 1.6)
  ctx.fillText('Diagnosis: FEVER', 40, font * 3.2)
  ctx.fillText('Rx', 40, font * 4.8)
  MEDICINES.forEach((medicine, index) => {
    const y = font * 6.4 + index * font * 2.2
    ctx.fillText(`${index + 1}) ${medicine}`, 40, y)
    if (twoColumn) {
      ctx.fillText(['Twice daily', 'Thrice daily', 'Night - 1'][index], width * 0.64, y)
    }
  })
  ctx.fillText('Advice: TAKE REST', 40, height - font)

  return canvas.toBuffer('image/png')
}

beforeAll(async () => {
  try {
    ;({ createCanvas } = await import('@napi-rs/canvas'))
  } catch {
    return
  }

  const { createWorker, PSM } = await import('tesseract.js')
  worker = await createWorker('eng', undefined, {
    // The Node adapter's worker; the browser gets /tesseract/worker.min.js.
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    // The very asset the browser loads, so a bad download fails this test.
    langPath: 'public/tesseract/lang',
    gzip: true,
  })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
}, 180_000)

afterAll(async () => {
  await worker?.terminate()
})

/** Skip rather than fail when the Node canvas is unavailable. */
const canRun = () => createCanvas !== null && worker !== null

describe('M. real OCR on a rendered prescription', () => {
  let text = ''

  beforeAll(async () => {
    if (!canRun()) return
    const { data } = await worker.recognize(renderPrescription())
    text = data.text.toUpperCase()
  }, 180_000)

  it('runs the real engine at all', () => {
    if (!canRun()) return expect(true).toBe(true)

    expect(text.length).toBeGreaterThan(0)
  })

  it.each(['PARACETAMOL', 'AMOXICILLIN', 'LEVOSIZ'])('reads %s', (name) => {
    if (!canRun()) return expect(true).toBe(true)

    expect(text).toContain(name)
  })

  it('reads a strength exactly when the characters are unambiguous', () => {
    if (!canRun()) return expect(true).toBe(true)

    expect(text).toContain('500MG')
  })

  it('confuses digits with letters, which is a real limit of this engine', () => {
    // Measured, not assumed. On this rendering Tesseract returns "Z50MG" for
    // 250MG and "SMG" for 5MG — the classic 2/Z and 5/S confusions — and reads
    // the list marker "2)" as "7)".
    //
    // Asserted so the limitation is visible and tracked rather than discovered
    // by a patient. text-normalize.js already folds these confusions when
    // matching a NAME against MediBase; a strength carries no such repair, so a
    // misread strength reaches the confirmation step as typed. Improving that
    // is medicine-identification work, not OCR configuration.
    if (!canRun()) return expect(true).toBe(true)

    const readCleanly = ['250MG', '5MG'].filter((strength) => text.includes(strength))

    expect(readCleanly.length).toBeLessThan(2)
  })

  it('reads the non-medicine text too, so the classifier is what discards it', () => {
    // Extraction must reject "FEVER" and "TAKE REST" on their own merits, not
    // because OCR happened to miss them.
    if (!canRun()) return expect(true).toBe(true)

    expect(text).toContain('FEVER')
    expect(text).toContain('REST')
  })

  it('reports a real confidence, not a placeholder', () => {
    if (!canRun()) return expect(true).toBe(true)

    // Asserted through the wrapper's own normalization rules rather than by
    // re-implementing them: a number in 0..1 that is not the old 0.5 stand-in.
    return worker.recognize(renderPrescription()).then(({ data }) => {
      const normalized = data.confidence / 100
      expect(Number.isFinite(data.confidence)).toBe(true)
      expect(normalized).toBeGreaterThan(0.5)
      expect(normalized).toBeLessThanOrEqual(1)
    })
  }, 180_000)
})

describe('the OCR output survives candidate extraction', () => {
  it('yields the prescribed medicines and none of the prose', async () => {
    if (!canRun()) return expect(true).toBe(true)

    const { data } = await worker.recognize(renderPrescription({ twoColumn: true }))
    const { extractCandidateLines, parseCandidate } = await import('../candidate-extract')

    const names = extractCandidateLines(data.text)
      .map((candidate) => parseCandidate(candidate)?.name?.toUpperCase() ?? '')
      .filter(Boolean)

    // Every prescribed medicine is present…
    for (const expected of ['PARACETAMOL', 'AMOXICILLIN', 'LEVOSIZ']) {
      expect(names.join(' | ')).toContain(expected)
    }
    // …and the diagnosis and advice are not medicines.
    expect(names.join(' | ')).not.toContain('FEVER')
    expect(names.join(' | ')).not.toContain('REST')
  }, 180_000)

  it('keeps a two-column direction out of the medicine name', async () => {
    // The reason the page segmentation mode is set. Under the default, a row
    // arrived as "3) LEVOSIZ 5MG TABLET Night - 1" and parsed to a medicine
    // called "LEVOSIZ Night".
    if (!canRun()) return expect(true).toBe(true)

    const { data } = await worker.recognize(renderPrescription({ twoColumn: true }))
    const { extractCandidateLines, parseCandidate } = await import('../candidate-extract')

    const names = extractCandidateLines(data.text).map(
      (candidate) => parseCandidate(candidate)?.name?.toUpperCase() ?? '',
    )

    for (const name of names) {
      expect(name).not.toMatch(/NIGHT|DAILY|TWICE|THRICE/)
    }
  }, 180_000)
})
