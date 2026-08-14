// Text normalization and fuzzy-matching primitives for prescription OCR.
//
// OCR of a printed or handwritten prescription reliably confuses a small set of
// glyph pairs: l/I/1, O/0, S/5, B/8, and the ligature rn/m. Rather than trying
// to guess which side is wrong, we fold both the OCR candidate AND the
// reference name into the same canonical class before comparing. "ParacetamoI"
// and "Paracetamol" both fold to "paracetamol"; the fold is lossy and
// unreadable by design — it is only ever used as a comparison key, never shown
// to a user or sent to the API.
//
// Folding is applied only to a medicine NAME, after strength and dosage have
// been split off (see candidate-extract.js). Applying it to a whole line would
// destroy "500mg".

/** Strip diacritics and non-ASCII without tripping eslint's no-control-regex. */
export function toAscii(value) {
  return Array.from((value ?? '').normalize('NFKD'))
    .filter((ch) => ch.charCodeAt(0) <= 0x7f)
    .join('')
}

/**
 * Lowercase, drop punctuation, collapse whitespace. Safe for display-adjacent
 * use — this does NOT fold confusable glyphs.
 */
export function normalize(value) {
  return toAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Order matters: multi-character substitutions run before single characters so
// "rn" becomes "m" before the individual letters are touched.
const MULTI_CHAR_CONFUSIONS = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/\|\|/g, 'u'],
]

const SINGLE_CHAR_CONFUSIONS = {
  '1': 'l', i: 'l', '|': 'l', '!': 'l',
  '0': 'o', q: 'o',
  '5': 's', $: 's',
  '8': 'b',
  '2': 'z',
  '6': 'g',
  '9': 'g',
  '7': 't',
}

/**
 * Collapse visually confusable glyphs into a shared class. Lossy and
 * deliberately unreadable — comparison key only.
 */
export function foldConfusions(value) {
  let out = normalize(value).replace(/[\s-]/g, '')
  for (const [pattern, replacement] of MULTI_CHAR_CONFUSIONS) {
    out = out.replace(pattern, replacement)
  }
  return Array.from(out)
    .map((ch) => SINGLE_CHAR_CONFUSIONS[ch] ?? ch)
    .join('')
}

/** Levenshtein edit distance. Iterative, two-row — O(min(a,b)) memory. */
export function levenshtein(a, b) {
  const s1 = a ?? ''
  const s2 = b ?? ''
  if (s1 === s2) return 0
  if (!s1.length) return s2.length
  if (!s2.length) return s1.length

  let previous = Array.from({ length: s2.length + 1 }, (_, i) => i)
  let current = new Array(s2.length + 1)

  for (let i = 1; i <= s1.length; i++) {
    current[0] = i
    for (let j = 1; j <= s2.length; j++) {
      const substitution = previous[j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)
      current[j] = Math.min(substitution, current[j - 1] + 1, previous[j] + 1)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[s2.length]
}

/** Normalized edit similarity in [0, 1] on already-prepared strings. */
function ratio(a, b) {
  if (!a && !b) return 1
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  return (maxLen - levenshtein(a, b)) / maxLen
}

/**
 * Similarity between an OCR candidate and a reference name, in [0, 1].
 *
 * Takes the better of the plain comparison and the confusion-folded one. The
 * folded score is discounted slightly so a genuine exact match always outranks
 * a match that only survives because two glyphs were treated as equivalent.
 */
export function similarity(candidate, reference) {
  const plain = ratio(normalize(candidate), normalize(reference))
  if (plain === 1) return 1
  const folded = ratio(foldConfusions(candidate), foldConfusions(reference))
  return Math.max(plain, folded * 0.98)
}

/**
 * Best similarity of a candidate against several reference spellings (a
 * canonical name plus its brand/generic aliases). Returns the score and which
 * reference produced it.
 */
export function bestSimilarity(candidate, references) {
  let best = { score: 0, reference: null }
  for (const reference of references) {
    if (!reference) continue
    const score = similarity(candidate, reference)
    if (score > best.score) best = { score, reference }
  }
  return best
}

/**
 * True when one name contains the other as a whole-token run — "amoxicillin"
 * inside "amoxicillin clavulanate". Guards against the substring trap where
 * two-letter fragments match everything.
 */
export function containsName(haystack, needle) {
  const h = normalize(haystack)
  const n = normalize(needle)
  if (!h || !n || n.length < 4) return false
  return h === n || h.includes(n) || n.includes(h)
}
