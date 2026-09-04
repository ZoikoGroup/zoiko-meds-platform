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
import { normalizeCanvasForOcr } from './image-preprocess'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

/** Hard ceiling on pages rasterized for OCR. Exceeding it warns, never silent. */
export const MAX_OCR_PAGES = 20

/** Render scale for OCR. 2.0 is a good accuracy/-memory trade for 300dpi scans. */
const OCR_RENDER_SCALE = 2.0

/**
 * How far apart two items may sit vertically and still be the same row.
 *
 * Floored at 4 units for items that report no height, which is what the
 * previous implementation used for every comparison.
 */
const ROW_TOLERANCE = 4

/**
 * A horizontal gap wider than this many times the line height is a column
 * boundary rather than a word space.
 *
 * A word space in a 10pt face is roughly 0.25 em; a table gutter is several em.
 * 2.5 sits far above ordinary inter-word spacing and far below any real gutter,
 * so ordinary prose is never split and a two-column table always is. It is a
 * ratio rather than an absolute, so it holds at any font size, and it is
 * derived from the item's own metrics rather than from any page geometry — this
 * has to work for an invoice as well as a prescription.
 */
const COLUMN_GAP_EMS = 2.5

/** Above this fraction of the line height, a gap is a word space. */
const SPACE_GAP_EMS = 0.2

/** The geometry pdfjs reports, reduced to what layout needs. */
function positioned(item) {
  const transform = item.transform ?? []
  return {
    str: item.str,
    x: typeof transform[4] === 'number' ? transform[4] : 0,
    y: typeof transform[5] === 'number' ? transform[5] : 0,
    width: typeof item.width === 'number' ? item.width : 0,
    // Height is the font size in text space. Zero disables the gap rules for
    // that item rather than dividing by nothing.
    height: typeof item.height === 'number' && item.height > 0 ? item.height : 0,
    hasEOL: Boolean(item.hasEOL),
  }
}

/** Join one run of items, restoring the spaces the PDF encoded as position. */
function joinRun(run) {
  let text = ''
  let previous = null
  for (const item of run) {
    if (previous) {
      const gap = item.x - (previous.x + previous.width)
      const em = item.height || previous.height || 0
      const spaced =
        em > 0 &&
        gap > em * SPACE_GAP_EMS &&
        !text.endsWith(' ') &&
        !item.str.startsWith(' ')
      if (spaced) text += ' '
    }
    text += item.str
    previous = item
  }
  return text.trim()
}

/**
 * Reconstruct a page's text with its columns intact.
 *
 * The previous implementation grouped items by Y alone: anything within four
 * units vertically became one line, whatever its X. On a prescription laid out
 * as medicines beside instructions — which is most of them — the two columns
 * share a Y, so "Levosiz 5mg Tablet" and "Night - 1" arrived as a single line.
 * Everything downstream then had to unpick a row that should never have been
 * joined, and the instruction text travelled attached to the medicine name.
 *
 * Rows are still found by Y, because that is what a row is. Within a row the
 * items are ordered by X and split where the gap between them is too wide to be
 * a word space — so a table becomes one line per cell, read left to right and
 * then down, and ordinary single-column text is untouched because it never
 * contains a gap that large.
 *
 * Nothing here knows what a prescription is. It is generic PDF text layout.
 */
export function textFromContent(textContent) {
  const items = []
  for (const item of textContent?.items ?? []) {
    if (!item || item.str === undefined) continue
    items.push(positioned(item))
  }
  if (items.length === 0) return ''

  // --- rows -----------------------------------------------------------------
  // Grouped in document order rather than by sorting on Y: a PDF's text layer
  // is already in reading order, and re-sorting a page whose items share a
  // baseline would shuffle it. `hasEOL` closes a row explicitly, which is the
  // only signal available when a producer writes every item at the same Y.
  const rows = []
  let current = null
  for (const item of items) {
    const tolerance = Math.max(ROW_TOLERANCE, item.height * 0.5)
    if (!current || Math.abs(current.y - item.y) > tolerance) {
      current = { y: item.y, items: [] }
      rows.push(current)
    }
    current.items.push(item)
    if (item.hasEOL) current = null
  }

  // --- columns within each row ---------------------------------------------
  const lines = []
  for (const row of rows) {
    const ordered = [...row.items].sort((a, b) => a.x - b.x)
    let run = []
    let previous = null

    for (const item of ordered) {
      if (previous) {
        const gap = item.x - (previous.x + previous.width)
        const em = item.height || previous.height || 0
        // A gutter, not a space: close this cell and start the next.
        if (em > 0 && gap > em * COLUMN_GAP_EMS) {
          const text = joinRun(run)
          if (text) lines.push(text)
          run = []
        }
      }
      run.push(item)
      previous = item
    }

    const text = joinRun(run)
    if (text) lines.push(text)
  }

  return lines.join('\n')
}

/**
 * Rasterize a page to a canvas.
 *
 * `normalize` grayscales and stretches the result, which is what OCR wants and
 * what the image path has always done. It is off for rasters kept to send
 * elsewhere, so those stay a faithful picture of the page.
 */
async function renderPageToCanvas(page, scale = OCR_RENDER_SCALE, { normalize = true } = {}) {
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
  return normalize ? normalizeCanvasForOcr(canvas) : canvas
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
      const canvas = await renderPageToCanvas(page, scale, { normalize: false })
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
