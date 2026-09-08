// Which medicines were actually prescribed, and which lines merely describe
// them.
//
// A prescription is a list, and its shape carries meaning that no per-line
// classifier can see:
//
//   2) TAB. VOMILAST
//      DOXYLAMINE 10 MG + PYRIDOXINE 10 MG + FOLIC ACID 2.5 MG
//
// Two lines, one prescription. The second is the composition of the first —
// what is *in* Vomilast, printed underneath it. Judged line by line, both look
// like medicines, and both a regular expression and a biomedical NER model will
// say so: the ingredients genuinely are drug names. The evidence that they are
// not separate prescriptions is positional, not lexical. Only the numbered row
// is a prescription; the line under it is metadata belonging to that row.
//
// The extractor emitted all of them, so a four-medicine prescription produced
// eight cards, and the patient was left to work out which four to believe.
//
// This module reads the rows, attaches what belongs to each, and emits one
// candidate per prescribed medicine. It works on the text alone — no model, no
// dictionary — which is what makes it cheap enough to run on every scan and
// predictable enough to test exhaustively.

import {
  DURATION_RE,
  FORM_RE,
  FREQUENCY_RE,
  isFieldLabelLine,
  isNonMedicineProse,
} from './candidate-extract'

/** "1)" / "2." / "(3)" / "-" — the marker that opens a prescribed row. */
const LIST_MARKER_RE = /^\s*(?:\(?\d{1,2}[).\]]|[-*•·—])\s+/

/** "TAB." / "CAP" / "SYP." — a dosage form written before the name. */
const FORM_PREFIX_RE =
  /^\s*(tab|tabs|tablet|cap|caps|capsule|syp|syr|syrup|inj|injection|oint|ointment|crm|cream|gel|susp|suspension|drops|lotion|spray|sachet|powder|solution)\b\.?\s*/i

/** A section heading that ends the medicine block. */
const SECTION_HEADING_RE =
  /^\s*(diagnosis|advice|advise|investigation|investigations|lab tests?|complaints?|symptoms?|history|clinic|follow[- ]?up|notes?|remarks?)\b\s*:?\s*$/i

/**
 * A number carrying a unit — a strength.
 *
 * The unit is what separates a strength from part of a brand name, and it is
 * the whole rule for suffix preservation. "Zoclar 500" and "Gestakind 10/SR"
 * have no unit, so the number belongs to the name the doctor wrote; stripping
 * it produced "Zoclar" and "Gestakind SR", which are different products.
 * "Paracetamol 500mg" has one, so 500mg is a strength and the name is
 * Paracetamol.
 */
const STRENGTH_WITH_UNIT_RE =
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|kg|ml|l|iu|units?|%\s*w\/w|%\s*w\/v|%)\b(?:\s*\/\s*\d*\s*(?:ml|l|mg|g))?/i

/** Several ingredients joined by "+" — the shape of a composition line. */
const COMPOSITION_JOIN_RE = /\s\+\s|\s\+|\+\s/

/**
 * Written dosage forms, spelled out.
 *
 * A prescriber writes "TAB."; a patient reading the result should see
 * "Tablet". Abbreviations only — anything already written in full passes
 * through capitalized.
 */
const FORM_NAMES = {
  tab: 'Tablet',
  tabs: 'Tablet',
  tablet: 'Tablet',
  cap: 'Capsule',
  caps: 'Capsule',
  capsule: 'Capsule',
  syp: 'Syrup',
  syr: 'Syrup',
  syrup: 'Syrup',
  inj: 'Injection',
  injection: 'Injection',
  oint: 'Ointment',
  ointment: 'Ointment',
  crm: 'Cream',
  cream: 'Cream',
  susp: 'Suspension',
  suspension: 'Suspension',
}

/**
 * Capitalize a written medicine name without rewriting it.
 *
 * Title-casing the whole string turned "GESTAKIND 10/SR" into
 * "Gestakind 10/sr" — SR is a release-profile marker, part of the product, and
 * lowercasing it makes a different name. So only purely alphabetic words are
 * recapitalized; any token carrying a digit or a slash is the doctor's exact
 * text and is left alone.
 */
function capitalizeName(value) {
  return String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      /[\d/]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ')
}

/**
 * Does this line open a new prescribed medicine?
 *
 * A list marker or a written dosage form is what a prescriber uses to start a
 * row. Either is enough on its own: plenty of prescriptions number their rows
 * without writing "TAB.", and plenty write "TAB." without numbering.
 */
export function isPrimaryRow(line) {
  const text = String(line ?? '').trim()
  if (!text) return false
  if (SECTION_HEADING_RE.test(text)) return false
  if (isFieldLabelLine(text)) return false
  return LIST_MARKER_RE.test(text) || FORM_PREFIX_RE.test(text)
}

/**
 * Does this line read as the composition of the row above it?
 *
 * Ingredients joined by "+", or a single ingredient with a strength — the two
 * ways a pack prints what is inside it. Deliberately not "does it look like a
 * medicine": it always does, which is exactly why position has to decide.
 */
export function looksLikeComposition(line) {
  const text = String(line ?? '').trim()
  if (!text) return false
  if (isPrimaryRow(text)) return false
  if (SECTION_HEADING_RE.test(text)) return false

  const joined = COMPOSITION_JOIN_RE.test(text) && STRENGTH_WITH_UNIT_RE.test(text)
  const singleIngredient = STRENGTH_WITH_UNIT_RE.test(text) && text.split(/\s+/).length <= 6
  return joined || singleIngredient
}

/**
 * Pull the medicine's written identity out of a primary row.
 *
 * Order matters: the list marker and the form prefix come off first, then a
 * strength is taken only if it carries a unit. What is left is the name as
 * written, suffix and all.
 */
export function parsePrimaryRow(line) {
  const raw = String(line ?? '').trim()
  let rest = raw.replace(LIST_MARKER_RE, '')

  let form = ''
  const formPrefix = rest.match(FORM_PREFIX_RE)
  if (formPrefix) {
    form = formPrefix[1].toLowerCase()
    rest = rest.replace(FORM_PREFIX_RE, '')
  }

  // A form written after the name — "Levosiz 5mg Tablet".
  if (!form) {
    const trailing = rest.match(FORM_RE)
    if (trailing) {
      form = trailing[0].replace(/\.$/, '').toLowerCase()
      rest = rest.replace(FORM_RE, ' ')
    }
  }

  let strength = ''
  const withUnit = rest.match(STRENGTH_WITH_UNIT_RE)
  if (withUnit) {
    strength = withUnit[0].replace(/\s+/g, ' ').trim()
    rest = rest.replace(STRENGTH_WITH_UNIT_RE, ' ')
  }

  // Directions written on the same row — "BD x 5 days", "TDS", "1-0-1". They
  // are about how to take the medicine, not what it is called, and leaving them
  // attached produced catalog queries for "Amoxicillin BD x 5 days", which
  // match nothing. Captured rather than discarded so the row can still report
  // them.
  const frequencyMatch = rest.match(FREQUENCY_RE)
  if (frequencyMatch) rest = rest.replace(FREQUENCY_RE, ' ')
  const durationMatch = rest.match(DURATION_RE)
  if (durationMatch) rest = rest.replace(DURATION_RE, ' ')

  // Whatever "x" or "for" joined the two together.
  rest = rest.replace(/\s+(?:x|for)\s*$/i, ' ').replace(/\s+x\s+/i, ' ')

  const name = rest.replace(/\s{2,}/g, ' ').replace(/[,;:\-x]+$/i, '').trim()
  return {
    name,
    strength,
    form,
    frequency: frequencyMatch ? frequencyMatch[0].trim() : '',
    duration: durationMatch ? durationMatch[0].trim() : '',
    raw,
  }
}

/**
 * Group a prescription's lines into one candidate per prescribed medicine.
 *
 * Text alone. An earlier revision also accepted biomedical NER spans and used
 * them to strike out a numbered row the model called a diagnosis; that model
 * was removed because its weights could never be fetched here, so it was never
 * run and never benchmarked. The structural reading is what produced the
 * measured improvement and is what remains.
 *
 * @param {string} text  Everything the reader produced.
 */
export function groupPrescriptionRows(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())

  const rows = []
  let current = null

  for (const line of lines) {
    if (!line) continue

    if (SECTION_HEADING_RE.test(line)) {
      // Diagnosis, advice, clinic hours — everything after this heading is
      // about the patient or the practice, not a prescription.
      current = null
      continue
    }

    if (isPrimaryRow(line)) {
      const parsed = parsePrimaryRow(line)
      if (!parsed.name) continue
      current = { ...parsed, compositionLines: [], sourceLines: [line] }
      rows.push(current)
      continue
    }

    if (current && looksLikeComposition(line)) {
      current.compositionLines.push(line)
      current.sourceLines.push(line)
      continue
    }

    // Anything else closes the current row rather than being swept into it.
    current = null
  }

  return rows
    .filter((row) => !isNonMedicineProse(row.name))
    .map((row) => {
      const compositionText = row.compositionLines.join(' ').trim()

      return {
        name: capitalizeName(row.name),
        frequency: row.frequency || '',
        duration: row.duration || '',
        form: row.form ? (FORM_NAMES[row.form] ?? capitalizeName(row.form)) : '',
        strength: row.strength || null,
        compositionText: compositionText || null,
        sourceLines: row.sourceLines,
      }
    })
}
