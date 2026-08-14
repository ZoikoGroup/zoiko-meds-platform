// Generic prescription line classification.
//
// Replaces the previous hardcoded reject-list (which named a specific hospital,
// city, doctor and patient from one sample prescription) with structural rules
// that hold for any prescription: a medicine line carries a dosage form, a
// strength, a frequency, a duration, or sits under an Rx/medication heading;
// a header line carries a field label, a date, a phone number, a clinical
// credential, or an organization suffix.
//
// Two principles the old implementation conflated:
//
//   1. REJECT decides whether a line is a medicine at all.
//   2. STRIP removes dosage/frequency noise from a line already accepted.
//
// Timing words ("morning", "after food") are STRIP signals — they appear on
// genuine medicine lines — so using them to reject dropped real medicines.

import { normalize, toAscii } from './text-normalize'

// --- Structural signals a medicine line carries -----------------------------

/** Dosage-form vocabulary, shared by the "anywhere" and "prefix" matchers. */
const FORM_WORDS = [
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syp', 'syr', 'syrup', 'susp', 'suspension', 'sol', 'soln', 'solution',
  'inj', 'injection', 'amp', 'ampoule', 'vial', 'drop', 'drops', 'gtt',
  'oint', 'ointment', 'cream', 'gel', 'lotion', 'spray', 'inhaler', 'puff',
  'respule', 'respules', 'nebule', 'neb', 'sachet', 'powder', 'patch',
  'supp', 'suppository', 'pessary', 'lozenge', 'granules', 'elixir',
  'emulsion', 'foam', 'shampoo', 'paste',
].join('|')

/** Dosage forms, as a leading token or anywhere in the line. */
export const FORM_RE = new RegExp(`\\b(?:${FORM_WORDS})\\b\\.?`, 'i')

/** A dosage form used as a leading prefix — a strong medicine signal. */
const FORM_PREFIX_RE = new RegExp(`^\\s*(?:${FORM_WORDS})\\b\\.?`, 'i')

/** Numeric strength with a unit, or a ratio such as 250/5. */
export const STRENGTH_RE =
  /(\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|kg|ml|l|iu|u|%)\b)|(\(\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\))|(\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b)/i

/** Latin and numeric dosing frequencies. 1-0-1 is the numeric convention. */
export const FREQUENCY_RE =
  /(\b(?:od|bd|bid|tid|tds|qid|qds|qhs|hs|prn|sos|stat|nocte|mane|om|on|ac|pc)\b)|(\bq\s*\d+\s*h\b)|(\b\d\s*[-x]\s*\d\s*[-x]\s*\d\b)|(\b(?:once|twice|thrice)\s+(?:a\s+)?(?:day|daily)\b)/i

/** Treatment duration. */
export const DURATION_RE =
  /(\bx\s*\d+\s*(?:d|day|days|w|wk|week|weeks|m|month|months)?\b)|(\bfor\s+\d+\s*(?:d|day|days|w|week|weeks|month|months)\b)|(\b\d+\s*(?:day|days|week|weeks|month|months)\b)/i

/** Route of administration. */
const ROUTE_RE = /\b(po|per\s?oral|oral|iv|im|sc|sl|pr|pv|topical|inhaled|nasal|ophthalmic|otic)\b/i

/** Numbered or bulleted list item — prescriptions enumerate medicines. */
const LIST_ITEM_RE = /^\s*(?:\(?\d{1,2}[).\]]|[-*•·—]|[ivx]{1,4}[).])\s+/i

// --- Structural signals a NON-medicine line carries -------------------------

/**
 * Vocabulary that marks the short phrase before a colon as a header field.
 *
 * Includes the dispensing-metadata labels that surround a prescribed medicine
 * — Sig (directions), Disp (quantity dispensed), Refills, DEA/NPI prescriber
 * identifiers, generic-substitution consent. Those lines sit inside the Rx
 * block and often carry a dosage form and a duration, so without an explicit
 * label they score as medicines.
 */
const FIELD_LABEL_WORDS_RE =
  /\b(name|patient|pt|age|sex|gender|dob|d\.?o\.?b|date|address|addr|ph|phone|mobile|tel|telephone|contact|email|e-mail|reg|regn|registration|lic|licence|license|uhid|mrn|ip|op|ward|bed|room|weight|wt|height|ht|bmi|bp|pulse|temp|spo2|resp|dept|department|doctor|dr|consultant|physician|surgeon|prescriber|pharmacist|ref|referred|referring|signature|sign|stamp|visit|admission|discharge|bill|invoice|receipt|gst|tin|vat|sig|directions?|instructions?|disp|dispense|dispensed|refills?|qty|quantity|mitte|dea|npi|substitution|label|prescription)\b/i

/**
 * `Label: value` header field?
 *
 * Anchoring the label on the first word missed every multi-word form —
 * "Patient Name:", "Pt. Age :", "Referring Doctor:" — so those lines fell
 * through to the generic scorer. The label is instead read as the short phrase
 * before the first colon.
 */
function hasFieldLabel(text) {
  const match = /^([^:：]{1,40})[:：]/.exec(text ?? '')
  if (!match) return false
  const label = match[1]
  // A real label is short; a medicine line that happens to contain a colon is not.
  if (label.split(/\s+/).filter(Boolean).length > 4) return false
  return FIELD_LABEL_WORDS_RE.test(label)
}

/** Clinical qualifications — mark a prescriber line, not a medicine. */
const CREDENTIAL_RE =
  /\b(mbbs|md|ms|mch|dm|dnb|bds|mds|bams|bhms|bums|phd|frcs|mrcp|mrcgp|frcp|facp|fics|dch|dgo|dpm|dnb|rmp|rph|pharm\.?\s?d|do)\b/i

/** Organization / facility names. */
const ORG_RE =
  /\b(hospital|hospitals|clinic|clinics|medical\s+(?:centre|center|college|college|store)|nursing\s+home|health\s?care|healthcare|polyclinic|dispensary|laborator(?:y|ies)|diagnostics?|pharmacy|chemist|druggist|surgery|practice|institute|foundation|trust|nhs|ltd|limited|pvt|inc|llp)\b/i

/** Street/postal vocabulary — marks an address line, not a medicine. */
const ADDRESS_RE =
  /\b(avenue|street|road|lane|boulevard|blvd|highway|nagar|colony|sector|block|floor|suite|apartment|po\s?box|zip\s?code|postcode|pin\s?code)\b/i

/** Dates in the common written forms. */
const DATE_RE =
  /(\b\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}\b)|(\b\d{4}-\d{2}-\d{2}\b)|(\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b)/i

/** Phone numbers and other long digit runs (IDs, licence numbers). */
const LONG_DIGITS_RE = /\d[\d\s\-()]{7,}/

/** Clock times. Generic — no hardcoded sample values. */
const CLOCK_RE = /\b\d{1,2}\s*[:.]\s*\d{2}\s*(?:am|pm|hrs)?\b/i

/** Non-medicine clinical section headings. */
const CLINICAL_SECTION_RE =
  /^\s*(diagnosis|dx|complaints?|c\/o|chief\s+complaints?|history|h\/o|examination|o\/e|findings?|investigations?|labs?|vitals?|allergies|impression|plan|follow[\s-]?up|review|remarks?|notes?|instructions?)\b\s*[:.\-–]?/i

/** Headings that introduce the medicine list. */
const MEDICINE_SECTION_RE =
  /^\s*(rx|r\/|℞|advice|advise|treatment|medication[s]?|medicine[s]?|drugs?|prescription|to\s+take|take\s+home|discharge\s+medication)\b\s*[:.\-–]?\s*$/i

/** Timing / instruction words — STRIPPED from a line, never used to reject. */
const TIMING_RE =
  /\b(morning|afternoon|evening|night|bedtime|breakfast|lunch|dinner|before\s+food|after\s+food|with\s+food|empty\s+stomach|daily|alternate\s+days?)\b/gi

/**
 * Does this text look like it contains real prescription content, rather than
 * page furniture (page numbers, dates, a stray header)? Used to decide whether
 * a PDF's embedded text layer is usable or the page needs OCR.
 */
export function isMeaningfulText(text) {
  if (!text) return false
  const usableLines = text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(line)) return false
      if (/^\d+$/.test(line)) return false
      if (DATE_RE.test(line) && line.length < 20) return false
      return true
    })
  const alphaCount = usableLines.join(' ').replace(/[^a-zA-Z]/g, '').length
  return usableLines.length >= 2 && alphaCount >= 25
}

/**
 * Score how strongly a line looks like a prescribed medicine.
 * Positive evidence is structural; negative evidence is header-shaped.
 */
export function scoreLine(line, { inMedicineSection = false } = {}) {
  const text = toAscii(line).trim()
  const evidence = {
    formPrefix: false,
    form: false,
    strength: false,
    frequency: false,
    duration: false,
    route: false,
    listItem: false,
    inMedicineSection,
  }
  if (!text) return { score: -10, evidence }

  let score = 0

  if (FORM_PREFIX_RE.test(text)) {
    evidence.formPrefix = true
    evidence.form = true
    score += 3
  } else if (FORM_RE.test(text)) {
    evidence.form = true
    score += 2
  }
  if (STRENGTH_RE.test(text)) {
    evidence.strength = true
    score += 2
  }
  if (FREQUENCY_RE.test(text)) {
    evidence.frequency = true
    score += 2
  }
  if (DURATION_RE.test(text)) {
    evidence.duration = true
    score += 1
  }
  if (ROUTE_RE.test(text)) {
    evidence.route = true
    score += 1
  }
  if (LIST_ITEM_RE.test(text)) {
    evidence.listItem = true
    score += 2
  }
  if (inMedicineSection) score += 2

  // Negative structure. A field label or a credential outweighs a stray
  // strength-looking number (e.g. "Weight: 62 kg", "BP: 120/80").
  if (hasFieldLabel(text)) score -= 5
  if (CREDENTIAL_RE.test(text)) score -= 4
  if (ORG_RE.test(text)) score -= 3
  if (DATE_RE.test(text)) score -= 3
  if (ADDRESS_RE.test(text)) score -= 3
  if (LONG_DIGITS_RE.test(text)) score -= 3
  if (CLOCK_RE.test(text)) score -= 2
  if (CLINICAL_SECTION_RE.test(text)) score -= 4

  const letters = text.replace(/[^a-zA-Z]/g, '').length
  const digits = text.replace(/[^0-9]/g, '').length
  if (letters < 3) score -= 4
  if (digits > letters) score -= 2

  return { score, evidence }
}

/** Common English function words — a run of them means prose, not a name. */
const FUNCTION_WORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'without', 'please', 'take', 'taken',
  'after', 'before', 'from', 'this', 'that', 'your', 'you', 'will', 'should',
  'must', 'may', 'can', 'has', 'have', 'been', 'was', 'were', 'are', 'is',
  'not', 'any', 'all', 'per', 'as', 'if', 'in', 'on', 'at', 'to', 'of',
])

/**
 * Does this line read like a medicine NAME, independent of any dosage markup?
 *
 * Prescriptions are not always written as "Tab. X 500mg BD" — a repeat list, a
 * patient's own list, or a typed note is frequently just the brand names, one
 * per line. Structure-only scoring rejected all of those, so a name-shaped line
 * gets its own path into the pipeline (and is then resolved against MediBase
 * like any other candidate).
 *
 * The vowel rule is what keeps OCR garbage out: a real medicine name is
 * pronounceable, so every substantial token carries a vowel. "Becosules" and
 * "Carbamide Forte" pass; "xxvv zzqq" does not.
 */
export function isPlausibleMedicineName(line) {
  const name = stripDosageNoise(toAscii(line ?? ''))
  if (name.length < 3 || name.length > 60) return false

  // A comma joining proper nouns marks a letterhead or an address
  // ("St Bartholomew Clinic, Leeds"). Medicine names combine with "+" or "/",
  // not commas, so this is a cheap and generic discriminator for the tier that
  // has no dosage evidence to lean on.
  if (/,/.test(line)) return false

  // Header-shaped text is never a bare medicine name.
  if (
    hasFieldLabel(line) ||
    CREDENTIAL_RE.test(line) ||
    ORG_RE.test(line) ||
    ADDRESS_RE.test(line) ||
    DATE_RE.test(line) ||
    CLOCK_RE.test(line) ||
    LONG_DIGITS_RE.test(line) ||
    CLINICAL_SECTION_RE.test(line)
  ) {
    return false
  }

  const tokens = name.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 4) return false

  // Prose reads as a sentence, not a label.
  const functionWordCount = tokens.filter((token) => FUNCTION_WORDS.has(token.toLowerCase())).length
  if (functionWordCount > 1) return false

  const letters = name.replace(/[^a-zA-Z]/g, '').length
  const digits = name.replace(/[^0-9]/g, '').length
  if (letters < 3 || letters / (letters + digits) < 0.6) return false

  // Every substantial token must be pronounceable, and at least one must be a
  // real word-length token.
  const substantial = tokens.filter((token) => token.replace(/[^a-zA-Z]/g, '').length >= 4)
  if (substantial.length === 0) return false
  return substantial.every((token) => /[aeiouy]/i.test(token))
}

/** Score at which structural evidence alone accepts a line. */
const ACCEPT_THRESHOLD = 2
/** Below this, a line carries an explicit header signal and is never a medicine. */
const WEAK_ACCEPT_FLOOR = 0

/**
 * Split raw OCR/PDF text into candidate medicine lines.
 *
 * Returns EVERY line that qualifies — there is no early exit, so a prescription
 * listing eight medicines yields eight candidates. Two tiers qualify:
 *
 *   strong — carries dosage structure (form, strength, frequency, Rx section)
 *   weak   — carries no structure but reads as a medicine name
 *
 * Weak candidates only become results if MediBase matches them, or if they are
 * plainly name-shaped; they are always flagged for confirmation.
 */
export function extractCandidateLines(rawText) {
  const lines = (rawText ?? '').split(/[\r\n]+/)
  const candidates = []
  let inMedicineSection = false
  let inClinicalSection = false

  for (const original of lines) {
    const line = toAscii(original).trim()
    if (!line) continue

    // Section transitions. A medicine heading opens the section; a clinical
    // heading closes it so "Diagnosis: ..." prose is not swept up.
    if (MEDICINE_SECTION_RE.test(line)) {
      inMedicineSection = true
      inClinicalSection = false
      continue
    }
    if (CLINICAL_SECTION_RE.test(line)) {
      inMedicineSection = false
      inClinicalSection = true
      // fall through — the heading itself scores negatively and is dropped
    }

    // An inline "Rx:" prefix opens the section and leaves the rest of the line
    // as a candidate ("Rx: Tab Amoxicillin 500mg").
    let text = line
    const inlineRx = text.match(/^\s*(rx|r\/|℞|advice|advise|treatment|medications?)\s*[:.\-–]\s*(?=\S)/i)
    if (inlineRx) {
      inMedicineSection = true
      inClinicalSection = false
      text = text.slice(inlineRx[0].length).trim()
      if (!text) continue
    }

    // A single OCR line can hold several numbered medicines. Split on list
    // markers that appear mid-line, keeping the marker with its item.
    const segments = splitListItems(text)

    for (const segment of segments) {
      if (!segment.trim()) continue
      const { score, evidence } = scoreLine(segment, { inMedicineSection })
      const withName = { ...evidence, nameLike: isPlausibleMedicineName(segment) }

      const strong = score >= ACCEPT_THRESHOLD
      // A name-shaped line with no header signal qualifies even without dosage
      // structure — but not while we are inside a clinical section, where
      // "Acute bronchitis" would otherwise read as a medicine.
      const weak = score >= WEAK_ACCEPT_FLOOR && withName.nameLike && !inClinicalSection

      if (strong || weak) {
        candidates.push({ text: segment.trim(), score, evidence: withName, weak: !strong })
      }
    }
  }

  return mergeContinuations(candidates)
}

/** Split "1. Tab A 500mg  2. Cap B 250mg" into separate items. */
function splitListItems(text) {
  const marker = /(?:^|\s)(?=(?:\(?\d{1,2}[).\]]|[-*•·])\s+\S)/g
  const parts = text.split(marker).filter(Boolean)
  return parts.length > 1 ? parts : [text]
}

/**
 * Merge a wrapped continuation into the line above it.
 *
 * OCR frequently breaks "Tab. Amoxicillin 500mg BD x 5 days" across two lines.
 * A fragment carrying only dosage signal and no name-shaped token belongs to
 * the previous candidate, not to a medicine of its own.
 */
function mergeContinuations(candidates) {
  const merged = []
  for (const candidate of candidates) {
    const namePart = stripDosageNoise(candidate.text)
    const hasOwnName = /[a-z]{4,}/i.test(namePart)
    if (!hasOwnName && merged.length > 0) {
      const previous = merged[merged.length - 1]
      previous.text = `${previous.text} ${candidate.text}`.trim()
      previous.evidence = { ...previous.evidence, ...pickTrue(candidate.evidence) }
      previous.score = Math.max(previous.score, candidate.score)
      continue
    }
    merged.push({ ...candidate })
  }
  return merged
}

function pickTrue(evidence) {
  const out = {}
  for (const [key, value] of Object.entries(evidence)) if (value) out[key] = true
  return out
}

/**
 * Remove dosage/frequency/duration/timing noise, leaving the name.
 *
 * `keepFrequency` retains tokens like OD/SR/MR, which are dosing abbreviations
 * in "Amoxicillin 500mg TDS" but part of the brand in "Nurokind OD".
 */
function stripDosageNoise(text, { keepFrequency = false } = {}) {
  let out = text
    .replace(LIST_ITEM_RE, ' ')
    .replace(new RegExp(FORM_RE.source, 'gi'), ' ')
    .replace(new RegExp(STRENGTH_RE.source, 'gi'), ' ')
  if (!keepFrequency) out = out.replace(new RegExp(FREQUENCY_RE.source, 'gi'), ' ')
  return out
    .replace(new RegExp(DURATION_RE.source, 'gi'), ' ')
    .replace(new RegExp(ROUTE_RE.source, 'gi'), ' ')
    .replace(TIMING_RE, ' ')
    .replace(/\([^)]*\)/g, ' ')
    // Strength has already been removed, so any standalone number left here is
    // a dose count ("1 morning, 1 night"). The word boundaries mean an
    // embedded figure such as the 12 in "B12" is preserved.
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[^a-zA-Z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^[\s+-]+)|([\s+-]+$)/g, '')
    .trim()
}

/**
 * Parse an accepted candidate line into its medicine name and dosage detail.
 * Returns null when nothing name-shaped survives.
 */
export function parseCandidate(candidate) {
  const text = candidate.text ?? candidate
  const evidence = candidate.evidence ?? {}

  const formMatch = text.match(FORM_RE)
  const strengthMatch = text.match(STRENGTH_RE)
  const frequencyMatch = text.match(FREQUENCY_RE)
  const durationMatch = text.match(DURATION_RE)

  const name = stripDosageNoise(text)
  // A name needs a real word, not a stray initial or a number.
  if (!/[a-z]{3,}/i.test(name)) return null

  // When a frequency token is the ONLY dosage signal on the line, it is far
  // more likely a brand suffix than a dosing instruction — "Nurokind OD" and
  // "Metformin SR" are product names. Keep it for display; the MediBase query
  // still uses the stripped form so the catalog lookup is unaffected.
  const frequencyIsOnlySignal = Boolean(frequencyMatch) && !strengthMatch && !durationMatch && !formMatch
  const displayName = frequencyIsOnlySignal
    ? stripDosageNoise(text, { keepFrequency: true }).replace(/^[\s+-]+|[\s+-]+$/g, '')
    : name.replace(/^[\s+-]+|[\s+-]+$/g, '')

  return {
    raw: text,
    displayName,
    name: name.replace(/^[\s+-]+|[\s+-]+$/g, ''),
    form: formMatch ? normalize(formMatch[0]).replace(/\.$/, '') : '',
    strength: strengthMatch ? strengthMatch[0].trim() : '',
    frequency: frequencyMatch ? frequencyMatch[0].trim() : '',
    duration: durationMatch ? durationMatch[0].trim() : '',
    evidence,
  }
}

/** Title-case a name for display without destroying embedded capitals. */
export function titleCase(value) {
  return (value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ')
}
