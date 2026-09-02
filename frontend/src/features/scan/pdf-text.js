// PDF text extraction with a per-page OCR fallback.
//
// The previous implementation made one all-or-nothing decision for the whole
// document ("if the text layer has >= 3 characters, trust it") and then capped
// the OCR fallback at three pages. Both were silent data loss: a scanned PDF
// carrying a single "Page 1 of 6" footer skipped OCR entirely, and page four
// onwards of any scanned prescription was dropped without a word to the user.
//
// Here every page is judged on its own. If its embedded text layer looks like
// real prescription content it is used as-is (fast, exact); otherwise that page
// is rasterized and OCR'd. Nothing is dropped without a warning.

import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { recognize } from './ocr-worker'
import { isMeaningfulText } from './candidate-extract'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

/** Hard ceiling on pages rasterized for OCR. Exceeding it warns, never silent. */
export const MAX_OCR_PAGES = 20

/** Render scale for OCR. 2.0 is a good accuracy/-memory trade for 300dpi scans. */
const OCR_RENDER_SCALE = 2.0

/**
 * Pull the embedded text layer out of one page, preserving line breaks.
 * pdf.js emits positioned runs, so lines are reconstructed from the y offset.
 */
export function textFromContent(textContent) {
  const lines = []
  let currentLine = ''
  let lastY = null

  for (const item of textContent?.items ?? []) {
    if (!item || item.str === undefined) continue
    const y = item.transform ? item.transform[5] : null
    const isNewLine = item.hasEOL || (lastY !== null && y !== null && Math.abs(y - lastY) > 4)

    if (isNewLine && currentLine.trim()) {
      lines.push(currentLine.trim())
      currentLine = ''
    }
    currentLine += (currentLine && !item.str.startsWith(' ') ? ' ' : '') + item.str
    lastY = y
  }
  if (currentLine.trim()) lines.push(currentLine.trim())
  return lines.join('\n')
}

/** Rasterize a page to a canvas for OCR. */
async function renderPageToCanvas(page, scale = OCR_RENDER_SCALE) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  // A white ground matters: pages with transparent backgrounds otherwise
  // rasterize to black-on-black and OCR returns nothing.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise
  return canvas
}

/**
 * Rasterize the first `maxPages` pages of a PDF, on demand.
 *
 * Extraction keeps a raster only for pages it had to OCR, which is the right
 * trade for the common case — rasterizing a text PDF that read perfectly is
 * memory and time spent for nothing. But it left assisted reading with nothing
 * to send when a text layer parsed cleanly and still yielded no medicines: the
 * page images were never made, and the fallback refused PDFs outright.
 *
 * So they are made here instead, when the user actually asks for assisted
 * reading. The document is re-opened from the original file, only the pages
 * that will be sent are rendered, and the document is released immediately —
 * so a 20-page PDF costs four rasters, not twenty, and only if asked.
 */
export async function renderPdfPageImages(file, { maxPages = 4, scale = OCR_RENDER_SCALE } = {}) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const images = []

  try {
    const limit = Math.min(maxPages, pdf.numPages)
    for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const canvas = await renderPageToCanvas(page, scale)
      images.push(canvas.toDataURL('image/jpeg', 0.85))
      // Drop the page's own resources as we go; the whole point is not holding
      // a document's worth of rendered pages in memory at once.
      page.cleanup?.()
    }
  } finally {
    try {
      await pdf.cleanup?.()
      await pdf.destroy?.()
    } catch {
      /* nothing to release */
    }
  }

  return images
}

/**
 * Extract text from every page of a PDF.
 *
 * @returns {Promise<{
 *   text: string,
 *   pages: Array<{ page: number, text: string, source: 'text-layer'|'ocr'|'failed', confidence: number|null }>,
 *   warnings: string[],
 *   ocrConfidence: number|null,
 *   pageImages: string[],
 * }>}
 */
export async function extractPdf(file, { onProgress } = {}) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pages = []
  const warnings = []
  const pageImages = []
  const ocrConfidences = []
  let ocrPagesUsed = 0

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.({ phase: 'page', page: pageNumber, totalPages: pdf.numPages, progress: 0 })

      const page = await pdf.getPage(pageNumber)
      let pageText = ''
      try {
        pageText = textFromContent(await page.getTextContent())
      } catch {
        pageText = ''
      }

      if (isMeaningfulText(pageText)) {
        pages.push({ page: pageNumber, text: pageText, source: 'text-layer', confidence: null })
        continue
      }

      // The text layer is empty, or it is only page furniture — this page is a
      // scan. OCR it rather than accepting the near-empty text.
      if (ocrPagesUsed >= MAX_OCR_PAGES) {
        warnings.push(
          `This PDF has ${pdf.numPages} pages. Only the first ${MAX_OCR_PAGES} scanned pages were read — ` +
            `pages ${pageNumber}–${pdf.numPages} were skipped. Split the file to read the rest.`,
        )
        pages.push({ page: pageNumber, text: '', source: 'failed', confidence: null })
        break
      }

      try {
        const canvas = await renderPageToCanvas(page)
        // Keep the raster for a possible vision fallback; JPEG keeps it small
        // enough to post without blowing the request limit.
        pageImages.push(canvas.toDataURL('image/jpeg', 0.85))

        const { text, confidence } = await recognize(canvas, {
          onProgress: (progress) =>
            onProgress?.({ phase: 'ocr', page: pageNumber, totalPages: pdf.numPages, progress }),
        })
        ocrPagesUsed += 1
        ocrConfidences.push(confidence)
        pages.push({ page: pageNumber, text, source: 'ocr', confidence })

        if (!text.trim()) {
          warnings.push(`Page ${pageNumber} could not be read — it may be blank or too low-resolution.`)
        }
      } catch (err) {
        warnings.push(`Page ${pageNumber} could not be read (${err?.message ?? 'reader error'}).`)
        pages.push({ page: pageNumber, text: '', source: 'failed', confidence: null })
      }
    }
  } finally {
    // Release the pdf.js worker's page cache regardless of how we exited.
    try {
      await pdf.cleanup?.()
      await pdf.destroy?.()
    } catch {
      /* nothing to release */
    }
  }

  const text = pages
    .map((entry) => entry.text)
    .filter(Boolean)
    .join('\n')

  return {
    text,
    pages,
    warnings,
    pageImages,
    ocrConfidence: ocrConfidences.length
      ? ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length
      : null,
  }
}
