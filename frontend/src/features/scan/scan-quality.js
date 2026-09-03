// How much to trust what the on-device reader produced.
//
// Assisted reading used to be offered on `medicines.length === 0 ||
// confident.length === 0`, which is wrong in both directions.
//
// Too weak: a page that OCRs into instruction text plus one recognisable brand
// yields one confident medicine, so the offer is withheld from exactly the scan
// that needed it. A prescription can produce plenty of text and still extract
// almost nothing that was written on it.
//
// Too aggressive: a medicine the catalog has not seen yet is UNMATCHED, and
// UNMATCHED always requires confirmation, so three genuine new medicines produce
// zero confident rows and the scan is treated as a failure. Absence from
// MediBase is a fact about the catalog, not evidence that the reader misread the
// page.
//
// So the question changes from "did OCR return anything" to "did OCR produce an
// extraction worth standing behind", answered from evidence the pipeline already
// has: how sure Tesseract was, how much of the page survived extraction, how
// much of what survived the catalog recognised, and whether the page's own
// structure implies more rows than came out of it.

import { MATCH_SOURCE } from './confidence'

/** Below this mean Tesseract confidence, characters are being guessed at. */
export const LOW_OCR_CONFIDENCE = 0.55
/** Below this, the read is bad enough to say so on its own. */
export const VERY_LOW_OCR_CONFIDENCE = 0.4
/** A page with at least this many non-trivial lines had something on it. */
export const SUBSTANTIAL_LINES = 6
/** Enough candidates that a total catalog miss is about the reading, not the catalog. */
export const MANY_CANDIDATES = 3
/** Discarding this share of considered lines suggests the lines were malformed. */
export const HIGH_REJECTION_RATE = 0.75
/** Fewer extracted medicines than numbered rows by this much means rows were lost. */
export const ROW_SHORTFALL = 2
/** Mean extraction confidence below this is not worth presenting unaided. */
export const WEAK_EXTRACTION_CONFIDENCE = 0.5

/** The reasons serious enough to call an extraction poor on their own. */
const STRONG_REASONS = [
  'NO_TEXT',
  'NO_MEDICINES',
  'VERY_LOW_OCR_CONFIDENCE',
  'TEXT_BUT_NO_CANDIDATES',
  'NO_CATALOG_MATCHES',
  'CORRUPTED_NAMES',
]

/** Sources that mean a governed identity recognised the name. */
const CATALOG_SOURCES = new Set([MATCH_SOURCE.MEDIBASE_EXACT, MATCH_SOURCE.MEDIBASE_FUZZY])

/** A numbered prescription row: "1.", "2)", "(3]". */
const NUMBERED_ROW_RE = /^\s*\(?\d{1,2}[).\]]\s+\S/

const VOWELS = /[aeiouy]/gi
const CONSONANT_RUN_RE = /[bcdfghjklmnpqrstvwxz]{5,}/i

/**
 * Does this name look like characters the reader guessed at?
 *
 * Not a spell check. An unrecognised name may be a perfectly real medicine the
 * catalog has not seen, and rejecting it for that would be the same mistake as
 * the old rule. These are shapes human-legible words do not take: a
 * five-consonant run, almost no vowels, or a digit sitting inside a word where
 * Tesseract substituted one for a letter.
 */
export function looksCorrupted(name) {
  const word = String(name ?? '').trim()
  if (word.length < 5) return false

  const letters = word.replace(/[^a-z]/gi, '')
  if (letters.length < 5) return false

  const vowels = (letters.match(VOWELS) ?? []).length
  if (vowels / letters.length < 0.2) return true
  if (CONSONANT_RUN_RE.test(letters)) return true
  // A digit between two letters — never how a strength is written, and the
  // classic OCR letter/digit substitution.
  if (/[a-z]\d[a-z]/i.test(word)) return true

  return false
}

/** Lines with enough on them to have been worth reading. */
function meaningfulLines(rawText) {
  return String(rawText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.replace(/[^a-z0-9]/gi, '').length >= 3)
}

/** Numbered rows the page itself claims to have. */
export function countNumberedRows(rawText) {
  return meaningfulLines(rawText).filter((line) => NUMBERED_ROW_RE.test(line)).length
}

const mean = (values) =>
  values.length === 0 ? null : values.reduce((sum, n) => sum + n, 0) / values.length

/**
 * Judge one extraction.
 *
 * `reasons` are machine-readable codes, for tests and for deciding what to
 * offer — never shown to a patient. The card says the reader was unsure about
 * this page, not HIGH_REJECTION_RATE.
 *
 * @param {object}      input
 * @param {string}      input.rawText           Everything the reader produced.
 * @param {number|null} input.ocrConfidence     Mean Tesseract confidence; null for a PDF text layer.
 * @param {number}      input.candidateCount    Lines that survived candidate extraction.
 * @param {Array}       input.medicines         Resolved medicines, after matching.
 * @param {boolean}    [input.catalogReachable] False when MediBase could not be consulted.
 */
export function assessScanQuality({
  rawText = '',
  ocrConfidence = null,
  candidateCount = 0,
  medicines = [],
  catalogReachable = true,
} = {}) {
  const reasons = []
  const lines = meaningfulLines(rawText)
  const matched = medicines.filter((medicine) => CATALOG_SOURCES.has(medicine.source))
  const numberedRows = countNumberedRows(rawText)
  const extractionConfidence = mean(medicines.map((medicine) => medicine.confidence ?? 0))

  // A. Nothing to work with.
  if (lines.length === 0) {
    return {
      quality: 'poor',
      reasons: ['NO_TEXT'],
      shouldOfferVision: true,
      signals: {
        lines: 0,
        candidateCount: 0,
        matched: 0,
        numberedRows: 0,
        corrupted: 0,
        ocrConfidence,
        extractionConfidence: null,
      },
    }
  }

  // B. The characters themselves are unreliable. A PDF text layer has no OCR
  //    step and correctly reports null, which skips this entirely.
  if (typeof ocrConfidence === 'number') {
    if (ocrConfidence < VERY_LOW_OCR_CONFIDENCE) reasons.push('VERY_LOW_OCR_CONFIDENCE')
    else if (ocrConfidence < LOW_OCR_CONFIDENCE) reasons.push('LOW_OCR_CONFIDENCE')
  }

  // C. A page full of text with nothing on it that reads as a medicine.
  if (candidateCount === 0 && lines.length >= SUBSTANTIAL_LINES) {
    reasons.push('TEXT_BUT_NO_CANDIDATES')
  }

  // D. Several readings, none of which the catalog recognised.
  //
  //    Guarded at MANY_CANDIDATES deliberately. One or two unmatched names is
  //    the ordinary case of a medicine MediBase has not seen yet, and treating
  //    that as a failed scan would call for assisted reading every time the
  //    catalog is merely incomplete.
  if (
    catalogReachable &&
    matched.length === 0 &&
    candidateCount >= MANY_CANDIDATES &&
    medicines.length >= MANY_CANDIDATES
  ) {
    reasons.push('NO_CATALOG_MATCHES')
  }

  // E. Most of what was considered had to be thrown away.
  if (candidateCount >= MANY_CANDIDATES) {
    const rejected = candidateCount - medicines.length
    if (rejected / candidateCount >= HIGH_REJECTION_RATE) reasons.push('HIGH_REJECTION_RATE')
  }

  // F. The page numbered more rows than came out of it.
  if (numberedRows > 0 && numberedRows - medicines.length >= ROW_SHORTFALL) {
    reasons.push('ROWS_LOST')
  }

  // G. Names that read as guessed characters. Half or more, so one odd brand
  //    among several good readings does not condemn the scan.
  const corrupted = medicines.filter((medicine) => looksCorrupted(medicine.name)).length
  if (corrupted > 0 && corrupted / Math.max(1, medicines.length) >= 0.5) {
    reasons.push('CORRUPTED_NAMES')
  }

  // H. Nothing extracted is worth presenting unaided.
  if (
    medicines.length > 0 &&
    extractionConfidence !== null &&
    extractionConfidence < WEAK_EXTRACTION_CONFIDENCE
  ) {
    reasons.push('WEAK_EXTRACTION')
  }

  // The page had text and produced no medicine at all.
  if (medicines.length === 0) reasons.push('NO_MEDICINES')

  const quality = reasons.some((reason) => STRONG_REASONS.includes(reason))
    ? 'poor'
    : reasons.length > 0
      ? 'uncertain'
      : 'good'

  return {
    quality,
    reasons,
    // Offered, never taken. The page still only leaves the browser when the
    // patient asks it to.
    shouldOfferVision: quality !== 'good',
    signals: {
      lines: lines.length,
      candidateCount,
      matched: matched.length,
      numberedRows,
      corrupted,
      ocrConfidence,
      extractionConfidence,
    },
  }
}
