// The real pdfjs-dist, against real PDF bytes.
//
// Every other PDF test in this suite mocks pdfjs and hands `textFromContent` a
// hand-built list of text items. That proves the reconstruction arithmetic and
// nothing else. It cannot show that `getTextContent` still returns the item
// shape the reconstruction reads — `str`, `transform[4]`, `transform[5]`,
// `height`, `width` — or that a real PDF's coordinate system is the one the
// two-column split assumes. A pdfjs upgrade changing either would flatten every
// multi-column prescription while the mocked tests stayed green.
//
// So this builds actual PDF bytes and parses them with the installed library.
// The fixtures are synthetic and contain no patient data.
//
// WHAT THIS DOES NOT COVER
//
// Rasterizing a scanned page needs a real Canvas, which Node does not have, so
// the OCR branch of extractPdf is not exercised here. `scanned-pdf-preprocess`
// covers that arithmetic against a stub; only a browser can prove the rest.

import { describe, expect, it, beforeAll, vi } from 'vitest'

/**
 * The one thing stubbed, and it is not the library.
 *
 * `pdfjs-dist/build/pdf.worker.min.mjs?url` is Vite's asset-URL import: in a
 * build it becomes a hashed URL the browser fetches, and outside Vite it does
 * not resolve at all. Everything actually under test — the parser, the text
 * layer, the item geometry — is the installed library doing real work.
 */
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))

/**
 * A minimal, valid single-page PDF.
 *
 * Written by hand rather than with a generator library: the point is to hand
 * pdfjs bytes it must genuinely parse, and another library in between would
 * weaken that. The xref offsets are computed from the serialized objects, so
 * the file is well-formed rather than merely well-formed-looking.
 *
 * @param {Array<{text: string, x: number, y: number, size?: number}>} items
 */
function buildPdf(items) {
  const content = items
    .map(
      ({ text, x, y, size = 10 }) =>
        `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/([()\\])/g, '\\$1')}) Tj ET`,
    )
    .join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  return new TextEncoder().encode(pdf)
}

let pdfjs
let textFromContent

beforeAll(async () => {
  // pdfjs reaches for these from its canvas display module at import time and
  // Node has none of them. Nothing here renders a page — the subject is the
  // text layer — so stand-ins are enough to let the real parser load.
  globalThis.DOMMatrix ??= class DOMMatrix {
    constructor(init = [1, 0, 0, 1, 0, 0]) {
      const [a, b, c, d, e, f] = init
      Object.assign(this, { a, b, c, d, e, f })
    }
  }
  globalThis.Path2D ??= class Path2D {}
  globalThis.ImageData ??= class ImageData {
    constructor(width, height) {
      Object.assign(this, { width, height, data: new Uint8ClampedArray(width * height * 4) })
    }
  }

  // The legacy build is pdfjs's supported entry point outside a browser. Same
  // parser as the app's; only the packaging differs, and the app's packaging is
  // Vite's concern rather than this test's.
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs'
  ;({ textFromContent } = await import('../pdf-text'))
  // Loading the real pdfjs takes longer than vitest's 10s default hook
  // budget once the rest of the scan suite is running in parallel.
}, 60_000)

/** Parse real bytes, then hand the real text content to the reconstruction. */
async function linesFrom(bytes) {
  const document = await pdfjs.getDocument({ data: bytes }).promise
  const page = await document.getPage(1)
  const content = await page.getTextContent()
  const lines = textFromContent(content).split('\n')
  await document.cleanup?.()
  return { lines, items: content.items }
}

const SINGLE = () =>
  buildPdf([
    { text: 'Rx', x: 50, y: 700 },
    { text: 'Tab. Amoxicillin 500mg', x: 50, y: 680 },
    { text: 'Cap. Omeprazole 20mg', x: 50, y: 660 },
    { text: 'Syp. Paracetamol 250mg/5ml', x: 50, y: 640 },
  ])

describe('L. a real single-column PDF', () => {
  it('reads every medicine back out', async () => {
    const { lines } = await linesFrom(SINGLE())
    const text = lines.join('\n')

    expect(text).toContain('Amoxicillin')
    expect(text).toContain('Omeprazole')
    expect(text).toContain('Paracetamol')
  })

  it('puts each medicine on its own line', async () => {
    const { lines } = await linesFrom(SINGLE())

    expect(lines.filter((line) => line.trim()).length).toBe(4)
  })

  it('gives every item the geometry the reconstruction depends on', async () => {
    // The contract between pdfjs and textFromContent, asserted against the real
    // library rather than against a fixture that merely restates it.
    const { items } = await linesFrom(SINGLE())

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(typeof item.str).toBe('string')
      expect(typeof item.transform[4]).toBe('number')
      expect(typeof item.transform[5]).toBe('number')
      expect(typeof item.height).toBe('number')
      expect(typeof item.width).toBe('number')
    }
  })

  it('reports the coordinates the fixture asked for', async () => {
    // If pdfjs ever flipped its Y axis, row grouping would still "work" and the
    // reading order would silently invert.
    const { items } = await linesFrom(SINGLE())
    const rx = items.find((item) => item.str.includes('Rx'))

    expect(rx.transform[4]).toBeCloseTo(50, 1)
    expect(rx.transform[5]).toBeCloseTo(700, 1)
  })
})

describe('L. a real two-column PDF keeps its columns apart', () => {
  // The layout the X/Y work exists for: medicines left, directions right,
  // sharing a baseline. Grouping by Y alone merged them into one line.
  const TWO_COLUMN = () =>
    buildPdf([
      { text: 'Medicines', x: 50, y: 700 },
      { text: '1. Levosiz 5mg Tablet', x: 50, y: 680 },
      { text: 'Night - 1', x: 320, y: 680 },
      { text: '2. Zimig 1% w/w Cream', x: 50, y: 660 },
      { text: 'Apply twice daily', x: 320, y: 660 },
      { text: '3. Forcan 150mg Tablet', x: 50, y: 640 },
      { text: 'Weekly once', x: 320, y: 640 },
    ])

  it('never joins a medicine to the direction beside it', async () => {
    const { lines } = await linesFrom(TWO_COLUMN())

    for (const line of lines) {
      expect(line).not.toMatch(/Tablet\s+Night/)
      expect(line).not.toMatch(/Cream\s+Apply/)
      expect(line).not.toMatch(/Tablet\s+Weekly/)
    }
  })

  it('keeps each medicine whole', async () => {
    const { lines } = await linesFrom(TWO_COLUMN())

    expect(lines.some((line) => line.includes('Levosiz 5mg Tablet'))).toBe(true)
    expect(lines.some((line) => line.includes('Zimig 1% w/w Cream'))).toBe(true)
    expect(lines.some((line) => line.includes('Forcan 150mg Tablet'))).toBe(true)
  })

  it('emits the directions as lines of their own', async () => {
    const { lines } = await linesFrom(TWO_COLUMN())

    expect(lines.some((line) => line.trim() === 'Night - 1')).toBe(true)
    expect(lines.some((line) => line.trim() === 'Apply twice daily')).toBe(true)
    expect(lines.some((line) => line.trim() === 'Weekly once')).toBe(true)
  })

  it('reads across then down, which is the order of a table', async () => {
    const { lines } = await linesFrom(TWO_COLUMN())
    const at = (needle) => lines.findIndex((line) => line.includes(needle))

    expect(at('Levosiz')).toBeLessThan(at('Night - 1'))
    expect(at('Night - 1')).toBeLessThan(at('Zimig'))
  })
})

describe('the real library on input it cannot use', () => {
  it('rejects bytes that are not a PDF', async () => {
    const junk = new TextEncoder().encode('this is not a pdf at all')

    await expect(pdfjs.getDocument({ data: junk }).promise).rejects.toBeTruthy()
  })
})
