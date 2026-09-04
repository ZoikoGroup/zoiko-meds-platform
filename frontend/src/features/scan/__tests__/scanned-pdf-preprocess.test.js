// A scanned PDF page gets the same preparation a photo does.
//
// An uploaded image goes through prepareImageForOcr — upscaled, flattened onto
// white, grayscaled, contrast stretched — because a low-contrast scan is where
// Tesseract starts substituting visually similar words. A PDF page took the
// render scale and the white ground and then went to Tesseract as rendered, so
// a photocopied prescription, which is the low-contrast case this exists for,
// was the one input that never got the treatment.
//
// Two things are checked: the pixel maths on its own, and that the OCR path is
// wired to it while the raster kept for sending elsewhere is not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFile } from './setup'
import { normalizeCanvasForOcr } from '../image-preprocess'

/**
 * A canvas that reports real pixels.
 *
 * `installDomStub` returns a context with no getImageData at all, which is the
 * "browser refused pixel access" branch — useful, but it cannot show that the
 * stretch happened.
 */
function pixelCanvas(luminances, { width = null } = {}) {
  const data = new Uint8ClampedArray(luminances.length * 4)
  luminances.forEach((luma, index) => {
    data[index * 4] = luma
    data[index * 4 + 1] = luma
    data[index * 4 + 2] = luma
    data[index * 4 + 3] = 255
  })
  const calls = { getImageData: 0, putImageData: 0 }
  return {
    width: width ?? luminances.length,
    height: 1,
    calls,
    data,
    getContext: () => ({
      fillStyle: '',
      fillRect: () => {},
      drawImage: () => {},
      getImageData: () => {
        calls.getImageData += 1
        return { data, width: luminances.length, height: 1 }
      },
      putImageData: () => {
        calls.putImageData += 1
      },
    }),
    toDataURL: () => 'data:image/jpeg;base64,STUBBEDPAGE',
  }
}

/** Read back the red channel, which grayscaling makes the luminance. */
const lumaOf = (canvas) => [...canvas.data].filter((_, i) => i % 4 === 0)

describe('the contrast stretch itself', () => {
  it('pushes a narrow band out to the full range', () => {
    // A photocopy: everything between 100 and 160, nothing near black or white.
    const canvas = pixelCanvas([100, 130, 160])

    normalizeCanvasForOcr(canvas)

    expect(lumaOf(canvas)).toEqual([0, 128, 255])
  })

  it('keeps the order of the tones it stretches', () => {
    const canvas = pixelCanvas([90, 100, 120, 150])

    normalizeCanvasForOcr(canvas)
    const out = lumaOf(canvas)

    expect(out).toEqual([...out].sort((a, b) => a - b))
  })

  it('leaves an already-full-range page alone', () => {
    const canvas = pixelCanvas([0, 128, 255])

    normalizeCanvasForOcr(canvas)

    expect(lumaOf(canvas)).toEqual([0, 128, 255])
  })

  it('does not try to stretch a blank page', () => {
    // Dividing a flat page by its range would amplify sensor noise into text.
    const canvas = pixelCanvas([200, 202, 204])

    normalizeCanvasForOcr(canvas)

    expect(lumaOf(canvas)).toEqual([200, 202, 204])
    expect(canvas.calls.putImageData).toBe(0)
  })

  it('writes the pixels back exactly once when it does stretch', () => {
    const canvas = pixelCanvas([100, 130, 160])

    normalizeCanvasForOcr(canvas)

    expect(canvas.calls.putImageData).toBe(1)
  })
})

describe('it never fails a scan', () => {
  it.each([
    ['a context that refuses pixel access', { width: 10, height: 10, getContext: () => ({}) }],
    ['a canvas with no context at all', { width: 10, height: 10, getContext: () => null }],
    ['a zero-sized canvas', { width: 0, height: 0, getContext: () => ({}) }],
    ['nothing', null],
  ])('survives %s', (_label, canvas) => {
    expect(() => normalizeCanvasForOcr(canvas)).not.toThrow()
    expect(normalizeCanvasForOcr(canvas)).toBe(canvas)
  })

  it('returns the same canvas rather than a copy', () => {
    // Callers hand the result straight to Tesseract and to toDataURL.
    const canvas = pixelCanvas([100, 130, 160])

    expect(normalizeCanvasForOcr(canvas)).toBe(canvas)
  })

  it('survives a context that throws on getImageData', () => {
    // A tainted canvas does exactly this.
    const canvas = {
      width: 4,
      height: 1,
      getContext: () => ({
        getImageData: () => {
          throw new Error('SecurityError')
        },
      }),
    }

    expect(normalizeCanvasForOcr(canvas)).toBe(canvas)
  })
})

describe('18. the scanned-PDF path is wired to it', () => {
  const getDocumentMock = vi.fn()
  const recognizeMock = vi.fn()
  let canvases

  beforeEach(() => {
    vi.resetModules()
    canvases = []
    globalThis.document = {
      createElement: (tag) => {
        if (tag !== 'canvas') return {}
        // Mid-grey band, so a normalized page is distinguishable from one that
        // was handed over as rendered.
        const canvas = pixelCanvas([100, 130, 160], { width: 800 })
        canvases.push(canvas)
        return canvas
      },
    }
    recognizeMock.mockResolvedValue({ text: 'Tab. Amoxicillin 500mg', confidence: 0.8 })
  })

  afterEach(() => {
    delete globalThis.document
    vi.clearAllMocks()
  })

  const loadPdfText = async () => {
    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: (...a) => getDocumentMock(...a),
    }))
    vi.doMock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))
    vi.doMock('../ocr-worker', () => ({ recognize: (...a) => recognizeMock(...a) }))
    return import('../pdf-text')
  }

  /** A PDF with no text layer, which is what forces the OCR path. */
  const scannedPdf = () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] }),
          getViewport: () => ({ width: 800, height: 1000 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
        cleanup: async () => {},
        destroy: async () => {},
      }),
    })
    return fakeFile('scan.pdf', 'application/pdf')
  }

  it('normalizes the page it is about to read', async () => {
    const { extractPdf } = await loadPdfText()

    await extractPdf(scannedPdf(), {})

    expect(canvases).toHaveLength(1)
    expect(lumaOf(canvases[0])).toEqual([0, 128, 255])
  })

  it('still hands that page to OCR', async () => {
    // The normalization must not have replaced what gets recognized.
    const { extractPdf } = await loadPdfText()

    await extractPdf(scannedPdf(), {})

    expect(recognizeMock).toHaveBeenCalledTimes(1)
    expect(recognizeMock.mock.calls[0][0]).toBe(canvases[0])
  })

  it('leaves a raster kept for sending elsewhere untouched', async () => {
    // renderPdfPageImages exists to produce a picture of the page, not an OCR
    // input, so it must stay a faithful one.
    const { renderPdfPageImages } = await loadPdfText()

    await renderPdfPageImages(scannedPdf(), { maxPages: 1 })

    expect(canvases).toHaveLength(1)
    expect(lumaOf(canvases[0])).toEqual([100, 130, 160])
  })

  it('reads a text PDF without rasterizing anything', async () => {
    // Normalization is for pages that must be OCR'd; a text layer needs none.
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            // Two usable lines and enough letters to count as a real text
            // layer; one short line reads as page furniture and is OCR'd.
            items: [
              'Tab. Amoxicillin 500mg Capsule',
              'Cap. Omeprazole 20mg Once daily',
              'Syp. Paracetamol 250mg/5ml',
            ].map((str, index) => ({
              str,
              width: str.length * 5,
              height: 10,
              transform: [10, 0, 0, 10, 50, 700 - index * 20],
              hasEOL: true,
            })),
          }),
          getViewport: () => ({ width: 800, height: 1000 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
        cleanup: async () => {},
        destroy: async () => {},
      }),
    })
    const { extractPdf } = await loadPdfText()

    await extractPdf(fakeFile('typed.pdf', 'application/pdf'), {})

    expect(canvases).toHaveLength(0)
    expect(recognizeMock).not.toHaveBeenCalled()
  })
})
