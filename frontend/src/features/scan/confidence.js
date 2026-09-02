// Confidence scoring for an extracted medicine.
//
// A score is only ever built from evidence that actually exists: how closely
// the OCR text matched a governed MediBase identity, how sure Tesseract was of
// the underlying characters, and which structural markers (dosage form,
// strength, frequency) the source line carried. Nothing is invented — a
// candidate with no match and no structure scores below the floor and is
// dropped rather than guessed at.

/** Where a match came from, and how much that origin is trusted. */
export const MATCH_SOURCE = {
  MEDIBASE_EXACT: 'medibase-exact',
  MEDIBASE_FUZZY: 'medibase-fuzzy',
  VISION: 'vision',
  OFFLINE_DICTIONARY: 'offline-dictionary',
  UNMATCHED: 'unmatched',
}

const SOURCE_WEIGHT = {
  [MATCH_SOURCE.MEDIBASE_EXACT]: 1.0,
  [MATCH_SOURCE.MEDIBASE_FUZZY]: 0.94,
  [MATCH_SOURCE.VISION]: 0.9,
  // Offline dictionary is a small local list used only when MediBase is
  // unreachable. It can confirm a spelling but is not a governed identity.
  [MATCH_SOURCE.OFFLINE_DICTIONARY]: 0.78,
  // Read off the page but absent from the catalog — always user-confirmed.
  // Weighted so a clean, name-shaped reading still lands in the low band and
  // reaches the user, rather than being silently discarded.
  [MATCH_SOURCE.UNMATCHED]: 0.55,
}

const EVIDENCE_BONUS = {
  formPrefix: 0.1,
  form: 0.06,
  strength: 0.1,
  frequency: 0.08,
  duration: 0.04,
  listItem: 0.03,
  inMedicineSection: 0.05,
  // The line reads as a medicine name (pronounceable, no header signal) even
  // when it carries no dosage markup — the shape of a bare repeat list.
  nameLike: 0.1,
}

export const BAND = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  REJECTED: 'rejected',
}

/** Auto-accept at or above this. */
export const HIGH_THRESHOLD = 0.8
/** Accept but flag for confirmation at or above this. */
export const MEDIUM_THRESHOLD = 0.6
/** Show as needs-confirmation at or above this; below it, drop entirely. */
export const LOW_THRESHOLD = 0.4

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Combine matching evidence into a single confidence in [0, 1].
 *
 * @param {object}  input
 * @param {number}  input.nameSimilarity  0..1 similarity to the matched name.
 * @param {string}  input.source          One of MATCH_SOURCE.
 * @param {object}  input.evidence        Structural markers from the source line.
 * @param {number} [input.ocrConfidence]  0..1 mean OCR confidence, when known.
 */
export function computeConfidence({ nameSimilarity, source, evidence = {}, ocrConfidence }) {
  const weight = SOURCE_WEIGHT[source] ?? SOURCE_WEIGHT[MATCH_SOURCE.UNMATCHED]

  // The name match carries most of the signal; structure only corroborates it.
  // Weighted so that an exact match against the governed catalog clears the
  // auto-accept bar on its own — a bare repeat list has no dosage markup to
  // contribute, and MediBase is the authority on what is a medicine.
  let score = clamp01(nameSimilarity) * 0.8

  let bonus = 0
  for (const [key, value] of Object.entries(EVIDENCE_BONUS)) {
    if (evidence[key]) bonus += value
  }
  score += Math.min(bonus, 0.2)
  score *= weight

  // Blend in OCR certainty when we have it. A perfectly matched name read off
  // a barely-legible scan should not present as certain. Digital PDF text has
  // no OCR step, so `undefined` correctly skips this.
  if (typeof ocrConfidence === 'number') {
    score *= 0.75 + 0.25 * clamp01(ocrConfidence)
  }

  return clamp01(score)
}

export function bandFor(confidence) {
  if (confidence >= HIGH_THRESHOLD) return BAND.HIGH
  if (confidence >= MEDIUM_THRESHOLD) return BAND.MEDIUM
  if (confidence >= LOW_THRESHOLD) return BAND.LOW
  return BAND.REJECTED
}

/**
 * Only high-confidence governed-catalog matches are accepted without a human
 * look. Two sources always require confirmation regardless of score:
 * UNMATCHED (read off the page but absent from MediBase) and VISION (an
 * assisted second attempt at text on-device OCR could not resolve).
 */
export function needsConfirmation(confidence, source) {
  if (source === MATCH_SOURCE.UNMATCHED || source === MATCH_SOURCE.VISION) return true
  return confidence < HIGH_THRESHOLD
}

/** Short, honest explanation of why a result is presented the way it is. */
export function explain(source, confidence) {
  switch (source) {
    case MATCH_SOURCE.MEDIBASE_EXACT:
      return 'Matched to the MediBase catalog'
    case MATCH_SOURCE.MEDIBASE_FUZZY:
      return confidence >= HIGH_THRESHOLD
        ? 'Matched to the MediBase catalog'
        : 'Close match in the MediBase catalog — please confirm'
    case MATCH_SOURCE.VISION:
      return 'Read by assisted reading — please confirm'
    case MATCH_SOURCE.OFFLINE_DICTIONARY:
      return 'Matched offline — catalog was unreachable'
    case MATCH_SOURCE.UNMATCHED:
      return 'Read from your prescription but not found in the catalog'
    default:
      return 'Please confirm this medicine'
  }
}
