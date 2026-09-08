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
/**
 * How many numbered rows may go unaccounted for before the scan is doubted.
 *
 * One. This was two, which meant a four-medicine prescription that produced
 * three medicines was reported as a good scan with no warning at all — the
 * patient saw three cards and nothing to suggest a fourth had been missed. A
 * missing medicine is the most consequential thing this feature can get wrong,
 * so a single one is worth saying out loud.
 */
export const ROW_SHORTFALL = 1
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
 * @param {number}     [input.primaryCount]     How many of those came from a primary
 *                                              prescription row. Defaults to the whole
 *                                              list for callers with no structural pass.
 * @param {number}     [input.declaredRows]     How many primary rows the page was found
 *                                              to have, from the structural reader.
 *                                              Falls back to counting list markers.
 * @param {boolean}    [input.catalogReachable] False when MediBase could not be consulted.
 */
export function assessScanQuality({
  rawText = '',
  ocrConfidence = null,
  candidateCount = 0,
  medicines = [],
  primaryCount = null,
  declaredRows = null,
  catalogReachable = true,
} = {}) {
  const reasons = []
  const lines = meaningfulLines(rawText)
  const matched = medicines.filter((medicine) => CATALOG_SOURCES.has(medicine.source))
  const numberedRows = countNumberedRows(rawText)

  // How many medicines the page is believed to prescribe.
  //
  // The structural reader's count when it has one, because it recognises more
  // than a list marker: "TAB. ABCIXIMAB" opens a prescription row whether or
  // not anybody numbered it. Counting markers alone made those rows invisible,
  // so a page of four TAB./CAP. rows that yielded three medicines had an
  // expected count of zero and was reported as a good scan.
  //
  // The same hole opened whenever OCR damaged the numbering — a measured
  // confusion on this engine reads "2)" as "7)", and a mangled marker is a
  // marker that no longer counts.
  //
  // Marker counting remains the fallback: it still answers for pages the
  // structural reader found nothing in, and it is the only evidence there.
  const structuralRows = typeof declaredRows === 'number' ? declaredRows : 0
  const expectedRows = structuralRows > 0 ? structuralRows : numberedRows
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
        expectedRows: 0,
        declaredRows: null,
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

  // F. The page had more prescription rows than came out of it.
  //
  // Counted against PRIMARY medicines, not the whole list. A composition line
  // promoted to its own card, or a stray candidate the line scorer picked up,
  // both inflate `medicines.length` — and a four-row prescription that lost two
  // medicines but gained three ingredient names came out at five and read as a
  // good scan. Padding is not recovery, and it must not be able to hide a loss.
  //
  // `primaryCount` falls back to the full list for callers that have no
  // structural pass to distinguish them, which is the honest answer there: with
  // nothing marked primary, every medicine is one.
  const primaries = primaryCount === null ? medicines.length : primaryCount
  if (expectedRows > 0 && expectedRows - primaries >= ROW_SHORTFALL) {
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
      // What the comparison actually used, and where it came from.
      expectedRows,
      declaredRows: structuralRows || null,
      primaryCount: primaries,
      corrupted,
      ocrConfidence,
      extractionConfidence,
    },
  }
}
