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

import { normalize, repairStrengthText, toAscii } from './text-normalize'

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

/**
 * Numeric strength with a unit, a percentage, or a ratio such as 250/5.
 *
 * The percentage arm carries its optional w/w, w/v or v/v tail. Without it
 * "Zimig 1% w/w Cream" matched only "1%": the tail then survived the strip that
 * removes strength from the name, lost its slash to the punctuation pass, and
 * the medicine came out as "Zimig w w" with no strength at all.
 */
export const STRENGTH_RE =
  /(\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|iu|u)\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:ml|l|g|kg|dose|doses|puff|puffs|tab|tablet|actuation)\b)|(\b\d+(?:\.\d+)?\s*%(?:\s*(?:w\s*\/\s*w|w\s*\/\s*v|v\s*\/\s*v))?)|(\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|kg|ml|l|iu|u)\b)|(\(\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\))|(\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b)/i

/** Latin and numeric dosing frequencies. 1-0-1 is the numeric convention. */
export const FREQUENCY_RE =
  /(\b(?:od|bd|bid|tid|tds|qid|qds|qhs|hs|prn|sos|stat|nocte|mane|om|on|ac|pc)\b)|(\bq\s*\d+\s*h\b)|(\b\d\s*[-x]\s*\d\s*[-x]\s*\d\b)|(\b(?:once|twice|thrice)\s+(?:a\s+)?(?:day|daily)\b)/i

/** Treatment duration. */
export const DURATION_RE =
  /(\bx\s*\d+\s*(?:d|day|days|w|wk|week|weeks|m|month|months)?\b)|(\bfor\s+\d+\s*(?:d|day|days|w|week|weeks|month|months)\b)|(\b\d+\s*(?:day|days|week|weeks|month|months)\b)/i

/** Route of administration. */
const ROUTE_RE = /\b(po|per\s?oral|oral|iv|im|sc|sl|pr|pv|topical|inhaled|nasal|ophthalmic|otic)\b/i

/**
 * A brand written with a bare dose — "Pan 40", "Zifi 200", "Shelcal 500".
 *
 * A very common way to write a prescription, and one the structural rules
 * missed entirely: no unit means no strength match, and the name left after the
 * number is stripped is too short to read as a medicine name. The line scored
 * zero and was dropped, or was folded into the medicine above it.
 *
 * Kept narrow on purpose. Two or more digits, because page furniture counts in
 * ones ("Page 2"); a head word of three letters or more; and a short stop-list
 * of the words that actually precede a number on a prescription form.
 */
const BARE_DOSE_RE = /^\s*([a-z][a-z+-]{2,})\s+(\d{2,4})\s*$/i

const NON_MEDICINE_HEADS = new Set([
  'page', 'room', 'bed', 'ward', 'floor', 'ref', 'age', 'sex', 'opd', 'ipd',
  'bill', 'phone', 'mobile', 'tel', 'reg', 'lic', 'uhid', 'mrn', 'wt', 'ht',
  'bp', 'temp', 'pulse', 'date', 'time', 'qty', 'no', 'sr', 'sl',
])

/** Does this line read as a medicine name followed by a bare dose number? */
export function hasBareDose(line) {
  const match = BARE_DOSE_RE.exec(toAscii(line ?? '').trim())
  if (!match) return false
  return !NON_MEDICINE_HEADS.has(match[1].toLowerCase())
}

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

/**
 * Prescription form labels as they arrive with no colon to give them away.
 *
 * `hasFieldLabel` needs the "Label: value" shape. OCR of a printed form loses
 * the colon constantly, and the label then arrives as a bare token — "Disp",
 * "Qty 30", "Refill 2", "Dr. Test". Those are name-shaped, so they took the
 * plausible-name path, matched nothing in MediBase, and were shown to the
 * patient as an unmatched medicine to confirm.
 */
const FIELD_LABEL_TOKENS = new Set([
  'disp', 'dispense', 'dispensed', 'sig', 'signa', 'qty', 'quantity',
  'refill', 'refills', 'ref', 'rx', 'dr', 'doctor', 'prescriber', 'patient',
  'date', 'dob', 'age', 'sex', 'gender', 'address', 'direction', 'directions',
  'instruction', 'instructions', 'frequency', 'route', 'duration', 'days',
  'take', 'dose', 'dosage', 'mitte', 'dea', 'npi', 'signature', 'stamp',
])

/**
 * Labels whose value is a person, not a drug.
 *
 * "Dr. Test" and "Prescriber Smith" leave a remainder that is name-shaped by
 * every structural measure — which is exactly what a person's name is. The
 * label already said what follows it, so the line is metadata whatever it holds.
 */
const PERSON_LABEL_TOKENS = new Set([
  'dr', 'doctor', 'prescriber', 'patient', 'physician', 'consultant',
  'surgeon', 'pharmacist', 'signature', 'name',
])

/**
 * The labels the one-edit arm is allowed to guess at.
 *
 * A deliberate subset. Every label is matched exactly; only these are also
 * matched approximately, because widening it costs real medicines: "Signa" is
 * one substitution from "Sigma", so allowing that label to be guessed at would
 * refuse a brand on the strength of a single letter. These are the short,
 * high-frequency form labels OCR actually mangles, and none has a real medicine
 * name within one edit.
 */
const FUZZY_LABEL_TOKENS = [
  'disp', 'sig', 'qty', 'refill', 'refills', 'date', 'dose', 'dosage', 'days',
]

/** Digits OCR substitutes for letters, folded back before a label is matched. */
const OCR_DIGIT_FOLD = { 1: 'i', 0: 'o', 5: 's', 8: 'b', 2: 'z' }

/** Reduce a word to the letters a label comparison should see. */
function labelKey(word) {
  return (word ?? '')
    .toLowerCase()
    .replace(/[0-9]/g, (d) => OCR_DIGIT_FOLD[d] ?? d)
    .replace(/[^a-z]/g, '')
}

/** Damerau-Levenshtein distance of at most one — one slip, not a resemblance. */
function withinOneEdit(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  let j = 0
  while (j < short.length - i && short[short.length - 1 - j] === long[long.length - 1 - j]) j++

  if (a.length === b.length) {
    // One substitution: the words agree either side of a single position.
    // "Disp"/"Diap" and "Qty"/"Oty" are both this.
    if (i + j >= a.length - 1) return true
    // Or two adjacent letters have swapped places.
    return (
      i + 2 <= a.length &&
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    )
  }
  // Lengths differ by one: an insertion or a deletion, so the shorter word must
  // be fully explained by its shared prefix and suffix. "Refil"/"Refill".
  return i + j >= short.length
}

/**
 * Is this word one of the form labels, allowing for a single OCR slip?
 *
 * The fuzzy arm is deliberately narrow: a closed list, a length window, and one
 * edit. It exists for "Diap" (Disp), "Oty" (Qty), "Refil" (Refill) — not as
 * general fuzzy matching, which would start refusing real medicines.
 */
function isLabelWord(word) {
  const key = labelKey(word)
  if (!key) return false
  if (FIELD_LABEL_TOKENS.has(key)) return true
  if (key.length < 3 || key.length > 9) return false
  for (const label of FUZZY_LABEL_TOKENS) {
    if (withinOneEdit(key, label)) return true
  }
  return false
}

/**
 * A form label standing on its own line, with no medicine on it.
 *
 * Strength or dosage form anywhere on the line means the label is a prefix in
 * front of a real medicine — "Rx: Amoxicillin 500 mg" — and prefixes are
 * stripped elsewhere, never rejected here. Without either, a label-led line is
 * dispensing metadata: a count, a date, a prescriber, or nothing at all.
 */
export function isFieldLabelLine(line) {
  const text = toAscii(line ?? '').trim()
  if (!text) return false
  if (STRENGTH_RE.test(text) || FORM_RE.test(text)) return false

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || !isLabelWord(words[0])) return false

  const rest = words.slice(1).join(' ').trim()
  // "Disp", "Sig", "Refill" — the label alone.
  if (!rest) return true
  // "Dr. Test", "Patient: A Sharma" — whatever follows is a person.
  if (PERSON_LABEL_TOKENS.has(labelKey(words[0]))) return true
  // "Qty 30", "Refill 2", "Date 16/06/2026" — a label and its value.
  if (/^[\d\s.,:;/%()-]*$/.test(rest)) return true
  // "Rx Amoxicillin" — the remainder may be the medicine, so keep the line and
  // let the prefix strip deal with the label.
  return !isPlausibleMedicineName(rest)
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
  /^\s*(diagnosis|dx|complaints?|c\/o|chief\s+complaints?|symptoms?|hopi|history|h\/o|examination|o\/e|findings?|investigations?|labs?|lab\s+tests?|vitals?|allergies|impression|plan|follow[\s-]?up|review|remarks?|notes?|precautions?|side\s+effects?|(?:general\s+)?instructions?|(?:general\s+)?advice)\b\s*[:.\-–]?/i

// --- Prose that shares a prescription with the medicines --------------------

/**
 * Text that is about a medicine without being one.
 *
 * A prescription's instruction column, its symptom list and its investigations
 * are all name-shaped: capitalised, short, no punctuation. The candidate tiers
 * accepted them for exactly that reason — "Avoid alcohol", "Keep area dry",
 * "Weekly once", "itching and redness" and "Kidney Function Test" all reached
 * the confirmation card as medicines to check against the prescription.
 *
 * Recognised by structure rather than by a list of phrases: an instruction opens
 * with an imperative, a schedule opens with a cadence word, an investigation
 * ends in the name of a test. The vocabularies below are the words those shapes
 * are built from, not an attempt to enumerate the sentences.
 */

/** An imperative opener — the grammar of an instruction. */
const INSTRUCTION_VERB_RE =
  /^\s*(?:apply|take|taken|avoid|keep|use|using|do\s+not|don'?t|continue|stop|drink|eat|rinse|gargle|shake|store|maintain|follow|report|repeat|check|monitor|consult|revisit|return|wash|clean|cover|elevate|rest|sip|swallow|chew|dissolve|inhale|instil|instill|massage|dab)\b/i

/** Cadence words a schedule opens with. Fuzzy-matched for OCR slips. */
const SCHEDULE_WORDS = [
  'daily', 'weekly', 'monthly', 'nightly', 'morning', 'afternoon', 'evening',
  'night', 'bedtime', 'once', 'twice', 'thrice', 'alternate', 'hourly',
]

/** The name of an investigation, which is what these lines end with. */
const INVESTIGATION_RE =
  /\b(?:function\s+tests?|tests?|profile|panel|scan|x-?ray|ultrasound|biopsy|culture|count|levels?|screening)\s*$/i

/** Complaint vocabulary — a symptom line, not a product. */
const SYMPTOM_RE =
  /\b(?:itching|itch|redness|swelling|pain|fever|rash|burning|dryness|irritation|nausea|vomiting|cough|headache|dizziness|weakness|soreness|bleeding|discharge|inflammation)\b/i

/** Is the first word a cadence word, allowing one OCR slip ("Daly")? */
function opensWithSchedule(text) {
  const first = (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!first || first.length < 4) return false
  return SCHEDULE_WORDS.some((word) => withinOneEdit(first, word))
}

/**
 * Is this line prose about the treatment rather than a medicine in it?
 *
 * Guarded on dosage evidence: a line carrying a strength or a dosage form is a
 * medicine line whatever else it says, so "Pain Relief Gel 30 g" and
 * "Cough syrup 100ml" are never rejected here. Only text with no dosage
 * evidence at all is judged on its grammar.
 */
export function isNonMedicineProse(line) {
  const text = toAscii(line ?? '').trim()
  if (!text) return false
  if (STRENGTH_RE.test(text) || FORM_RE.test(text)) return false

  return (
    INSTRUCTION_VERB_RE.test(text) ||
    opensWithSchedule(text) ||
    INVESTIGATION_RE.test(text) ||
    SYMPTOM_RE.test(text)
  )
}

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
    bareDose: false,
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
  if (STRENGTH_RE.test(text) || STRENGTH_RE.test(repairStrengthText(text))) {
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
  if (hasBareDose(text)) {
    evidence.bareDose = true
    score += 2
  }
  if (inMedicineSection) score += 2

  // Negative structure. A field label or a credential outweighs a stray
  // strength-looking number (e.g. "Weight: 62 kg", "BP: 120/80").
  if (hasFieldLabel(text)) score -= 5
  // A label with no colon carries the same weight as one with it.
  if (isFieldLabelLine(text)) score -= 5
  // An instruction, a schedule, a symptom or an investigation. Weighted to
  // outrun the +2 a line gets merely for sitting in the medicine section, which
  // is what carried the instruction column into the results.
  if (isNonMedicineProse(text)) score -= 6
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
    isFieldLabelLine(line) ||
    isNonMedicineProse(line) ||
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
    const inlineRx = text.match(/^\s*(rx|r\/|℞|advice|advise|treatment|medications?|medicines?|drugs?|prescription)\s*[:.\-–]\s*(?=\S)/i)
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
/**
 * Does this candidate stand on its own, whatever its name looks like?
 *
 * A wrapped continuation carries dosage and nothing else — "500mg BD x 5 days"
 * on the line below its medicine. A short medicine line carries the markers of
 * an entry in its own right: its own strength, its own dosage form, a list
 * marker that numbered it, or a bare dose after the brand. Reading only the
 * name meant "Pan 40" — three letters after the number is stripped — was
 * indistinguishable from a continuation, and disappeared into the medicine
 * above it.
 */
function startsNewEntry(evidence = {}) {
  // Deliberately NOT `strength` or a form appearing anywhere: a wrapped tail —
  // "500mg BD x 5 days" — carries both, and it belongs to the medicine above.
  // What marks a new entry is the way the line opens (a list number, a leading
  // "Tab."), or a shape only a medicine has (brand + bare dose, a name).
  return Boolean(
    evidence.listItem || evidence.formPrefix || evidence.bareDose || evidence.nameLike,
  )
}

function mergeContinuations(candidates) {
  const merged = []
  for (const candidate of candidates) {
    const namePart = stripDosageNoise(candidate.text)
    // Three letters, not four. A dosage tail strips to nothing at all, so the
    // shorter threshold costs nothing there — and it is the difference between
    // keeping "Pan 40" and folding it into the medicine above.
    const hasOwnName = /[a-z]{3,}/i.test(namePart)
    if (!hasOwnName && !startsNewEntry(candidate.evidence) && merged.length > 0) {
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
  // Strip from the repaired copy when the raw text hides its strength behind an
  // OCR slip, so "Amoxicillin 65O rng" leaves "Amoxicillin" rather than
  // "Amoxicillin O rng".
  const source = STRENGTH_RE.test(text) ? text : repairStrengthText(text)
  let out = source
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
  // Strength is read from a repaired copy — "65O mg" and "650 rng" are the same
  // dose as "650 mg" and the raw regex sees neither. `raw` below still carries
  // the original line, so what the user is shown and asked to confirm is what
  // the page actually said.
  const strengthMatch = text.match(STRENGTH_RE) ?? repairStrengthText(text).match(STRENGTH_RE)
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
  // "Pan 40" is how the product is named — on the page and in the catalog. The
  // stripped name drops the number, so the display (and the catalog query built
  // from it) keeps the line as written.
  const displayName = evidence.bareDose
    ? text.trim()
    : frequencyIsOnlySignal
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
