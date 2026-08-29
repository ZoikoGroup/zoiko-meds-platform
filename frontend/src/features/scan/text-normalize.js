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

/**
 * Letters OCR substitutes for digits, and the digits they were.
 *
 * Only the unambiguous shapes. `g` is left out because it is a unit (gram), and
 * `z`/`b` are left out because they cost more in false repairs than they save.
 */
const DIGIT_LOOKALIKES = { o: '0', l: '1', i: '1', '|': '1', s: '5' }

/** Unit spellings OCR produces from the real ones. `rn` is the classic m. */
const UNIT_REPAIRS = [
  [/\brn(g|l|cg)\b/gi, 'm$1'],
  [/\bm9\b/gi, 'mg'],
  [/\bmq\b/gi, 'mg'],
]

/**
 * Repair OCR damage inside numeric strengths, on a copy used for parsing only.
 *
 * "65O mg" and "650 rng" are the same prescription as "650 mg"; the regex that
 * finds strengths sees neither, so the strength was dropped and the stray token
 * left glued to the medicine name. Reading it back is a small, bounded repair.
 *
 * Deliberately conservative, because a wrong strength is worse than none:
 *
 *  - a letter becomes a digit only inside a token that already holds a digit,
 *    so "OO mg" stays as it is while "65O mg" is repaired — the surrounding
 *    digits are what make the reading safe;
 *  - only the numeric run is touched, never the whole line, so a medicine name
 *    is never rewritten by this;
 *  - the result is a comparison copy. Callers keep the original text for
 *    display and for the confirmation the user is asked for.
 */
export function repairStrengthText(value) {
  const text = toAscii(value ?? '')
  if (!text) return ''

  const withUnits = UNIT_REPAIRS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  )

  // A run of digits and digit-lookalikes, immediately before a unit.
  return withUnits.replace(
    /\b([0-9a-z|]{1,6})(\s*)(mg|mcg|ug|g|gm|kg|ml|l|iu|u|%)\b/gi,
    (match, numeric, gap, unit) => {
      if (!/[0-9]/.test(numeric)) return match
      const repaired = Array.from(numeric)
        .map((ch) => DIGIT_LOOKALIKES[ch.toLowerCase()] ?? ch)
        .join('')
      // Only accept a repair that produced a clean number — anything else is a
      // guess, and a guessed dose is not worth having.
      return /^[0-9]+(\.[0-9]+)?$/.test(repaired) ? `${repaired}${gap}${unit}` : match
    },
  )
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
 * Shortest side of a containment check that still counts as evidence.
 *
 * Four alphanumerics. "Dolo" inside "Dolo 650" is a real reading; "Pan" inside
 * "Pantoprazole" is three characters of a word that could have been anything.
 */
export const MIN_CONTAINMENT_CHARS = 4

/** Whole-token containment: are `needle`'s tokens a consecutive run in `hay`'s? */
function tokenRunIncludes(hayTokens, needleTokens) {
  if (needleTokens.length === 0 || needleTokens.length > hayTokens.length) return false
  for (let start = 0; start + needleTokens.length <= hayTokens.length; start++) {
    let matched = true
    for (let offset = 0; offset < needleTokens.length; offset++) {
      if (hayTokens[start + offset] !== needleTokens[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/**
 * True when one name contains the other as a whole-token run — "amoxicillin"
 * inside "amoxicillin clavulanate".
 *
 * Both sides are length-guarded, not just the reference. Guarding only one of
 * them was the substring trap in a different disguise: a three-character OCR
 * fragment ("Pan", "Met", "Ome") satisfied `includes` against every catalog
 * entry that happened to contain those letters, and the caller then promoted it
 * to near-certainty. A fragment that short is not evidence of anything.
 *
 * Containment is token-aligned for the same reason — "Amox" is a prefix of
 * "Amoxicillin", not a reading of it, and a prefix match on a garbled word is
 * how OCR noise becomes a confident diagnosis of the wrong medicine.
 *
 * `minChars` may be lowered by a caller that holds corroborating evidence of
 * its own (a strength that matches the catalog entry, say) — see
 * resolveCandidate in extract-prescription.js.
 */
export function containsName(haystack, needle, { minChars = MIN_CONTAINMENT_CHARS } = {}) {
  const h = normalize(haystack)
  const n = normalize(needle)
  if (!h || !n) return false
  if (h === n) return true

  const shorter = h.length <= n.length ? h : n
  if (shorter.replace(/[^a-z0-9]/g, '').length < minChars) return false

  const hTokens = h.split(/\s+/).filter(Boolean)
  const nTokens = n.split(/\s+/).filter(Boolean)
  return tokenRunIncludes(hTokens, nTokens) || tokenRunIncludes(nTokens, hTokens)
}
