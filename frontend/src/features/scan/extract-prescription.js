// Prescription → medicine list orchestrator.
//
//   image / PDF
//     → preprocessing (HEIC guard, per-page routing)
//     → Tesseract OCR (shared worker) or PDF text layer
//     → complete text extraction (every page, nothing silently dropped)
//     → generic candidate extraction (structural, not sample-specific)
//     → OCR-error-tolerant fuzzy matching
//     → MediBase catalog matching
//     → confidence scoring
//     → [AI/Vision fallback, user-initiated, when OCR yields nothing confident]
//     → user confirmation for uncertain results
//     → final medicine list
//
// Every candidate line is carried through the whole pipeline — the extractor
// does not stop after the first medicine.

import { matchMedicines } from '@/services/medicine-api'
import { recognize, OcrUnavailableError } from './ocr-worker'
import { prepareImageForOcr } from './image-preprocess'
import { extractPdf } from './pdf-text'
import {
  extractCandidateLines,
  isNonMedicineProse,
  parseCandidate,
  titleCase,
} from './candidate-extract'
import { bestSimilarity, containsName, similarity } from './text-normalize'
import { matchOfflineDictionary } from './known-drugs'
import { assessScanQuality } from './scan-quality'
import {
  BAND,
  MATCH_SOURCE,
  bandFor,
  computeConfidence,
  explain,
  needsConfirmation,
} from './confidence'

export { BAND, MATCH_SOURCE } from './confidence'

/** Raised for a file we can accept in theory but cannot decode in the browser. */
export class UnsupportedFormatError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedFormatError'
  }
}

/** Raised when text extraction produced nothing at all to work with. */
export class NoTextExtractedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NoTextExtractedError'
  }
}

const HEIC_RE = /\.(heic|heif)$/i
const PDF_RE = /\.pdf$/i

/** How many MediBase lookups run concurrently. */
const MATCH_CONCURRENCY = 4

/**
 * Minimum similarity for a MediBase result to be claimed as THE medicine.
 *
 * Set well above a coin-flip so garbled OCR is not forced onto the nearest
 * catalog entry: genuine character confusions fold to ~0.95+ ("ParacetamoI",
 * "Amoxcillin", "Metf0rmin"), whereas a badly-read word such as "Amescitin"
 * scores ~0.55 against "Amoxicillin" and is correctly left unmatched rather
 * than being renamed into a medicine the page never named.
 */
const MEDIBASE_MATCH_FLOOR = 0.72

/**
 * Containment floor for a candidate whose strength matches the catalog entry's.
 *
 * Three characters is enough for "Pan 40" against a "Pan 40 mg" identity when
 * the page also said 40 mg — the number is the corroboration. Without it the
 * default floor in text-normalize applies.
 */
const CORROBORATED_CONTAINMENT_CHARS = 3

/** Same strength, allowing for spacing and case ("40mg" vs "40 mg"). */
function strengthCorroborates(parsedStrength, catalogStrength) {
  const a = normalizeStrengthKey(parsedStrength)
  const b = normalizeStrengthKey(catalogStrength)
  return Boolean(a) && a === b
}

function normalizeStrengthKey(value) {
  return (value ?? '').toLowerCase().replace(/\s+/g, '')
}

function isHeic(file) {
  return HEIC_RE.test(file.name ?? '') || /image\/hei[cf]/i.test(file.type ?? '')
}

function isPdf(file) {
  return file.type === 'application/pdf' || PDF_RE.test(file.name ?? '')
}

/** Run `task` over `items` with bounded concurrency, preserving order. */
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Resolve one parsed candidate to a medicine.
 * MediBase first, offline dictionary only if the catalog is unreachable, and a
 * structural fallback that is always flagged for confirmation.
 */
async function resolveCandidate(parsed, { ocrConfidence, catalogReachable }) {
  const { evidence } = parsed
  // A line written as brand + bare dose ("Pan 40") names the product with the
  // number: the catalog holds "Pan 40", not "Pan". Querying and scoring on the
  // stripped name alone left a three-letter fragment to be rescued by the
  // containment shortcut, which is exactly the promotion that made an uncertain
  // reading confident. The fuller text is both a better query and a safer score.
  const name = evidence.bareDose && parsed.displayName ? parsed.displayName : parsed.name

  if (catalogReachable.value) {
    try {
      const matches = await matchMedicines(name, 5)
      const scored = (matches ?? [])
        .map((match) => {
          // `brands` is the mapped field name from toMedicineIdentity().
          const references = [match.name, match.generic, ...(match.brands ?? [])].filter(Boolean)
          const { score } = bestSimilarity(name, references)
          // Containment is worth near-certainty only when the shared run is
          // substantial. A short name may still earn it, but only with
          // corroboration the page itself supplied: a strength that matches the
          // catalog entry's own. Evidence, not a shorter yardstick.
          const minChars = strengthCorroborates(parsed.strength, match.strength)
            ? CORROBORATED_CONTAINMENT_CHARS
            : undefined
          const contained = references.some((reference) =>
            containsName(name, reference, minChars ? { minChars } : undefined),
          )
          return { match, score: contained ? Math.max(score, 0.95) : score }
        })
        .sort((a, b) => b.score - a.score)

      const best = scored[0]
      if (best && best.score >= MEDIBASE_MATCH_FLOOR) {
        const exact = similarity(name, best.match.name) >= 0.995
        const source = exact ? MATCH_SOURCE.MEDIBASE_EXACT : MATCH_SOURCE.MEDIBASE_FUZZY
        return {
          name: best.match.name,
          genericName: best.match.generic ?? '',
          catalogStrength: best.match.strength ?? '',
          medicineId: best.match.id ?? null,
          nameSimilarity: best.score,
          source,
          evidence,
          ocrConfidence,
        }
      }
      // Catalog answered but holds no such medicine — fall through to the
      // structural path rather than inventing a match.
    } catch {
      // Network/API failure. Mark the catalog unreachable so the remaining
      // candidates skip straight to the offline path instead of each waiting
      // on their own timeout.
      catalogReachable.value = false
    }
  }

  if (!catalogReachable.value) {
    const offline = matchOfflineDictionary(name)
    if (offline) {
      return {
        name: offline.drug.name,
        genericName: offline.drug.generic ?? '',
        catalogStrength: offline.drug.defaultStrength ?? '',
        medicineId: null,
        nameSimilarity: offline.similarity,
        source: MATCH_SOURCE.OFFLINE_DICTIONARY,
        evidence,
        ocrConfidence,
      }
    }
  }

  // Nothing matched the catalog. An unmatched reading is only ever surfaced
  // when the line reads as a medicine NAME.
  //
  // Dosage structure alone is NOT sufficient: dispensing directions live
  // inside the Rx block and carry the same markers a medicine does — "Sig:
  // Take 1 capsule by mouth every 8 hours for 10 days" has a dosage form and a
  // duration, and accepting it on that basis turned an instruction into a
  // medicine called "SI Take BY Mouth Avery Hours For Oays".
  // A brand written with a bare dose ("Pan 40") is a medicine line even though
  // the name alone is too short to read as one — the dose is what makes it a
  // prescription entry rather than a stray word.
  if (!(evidence.nameLike || evidence.bareDose) || name.length < 4) return null

  return {
    // Display what was written. With no catalog identity we have no authority
    // to decide which trailing token is dosage and which is part of the brand.
    name: titleCase(parsed.displayName || name),
    genericName: '',
    catalogStrength: '',
    medicineId: null,
    // Read verbatim off the page — the text is what it is, but we have no
    // catalog corroboration, so the source weight keeps this out of the
    // auto-accept band.
    nameSimilarity: 1,
    source: MATCH_SOURCE.UNMATCHED,
    evidence,
    ocrConfidence,
  }
}

/** Build the user-facing record for a resolved medicine. */
function toMedicine(resolved, parsed) {
  const confidence = computeConfidence({
    nameSimilarity: resolved.nameSimilarity,
    source: resolved.source,
    evidence: resolved.evidence,
    ocrConfidence: resolved.ocrConfidence,
  })

  const detailParts = []
  if (resolved.genericName && resolved.genericName.toLowerCase() !== resolved.name.toLowerCase()) {
    detailParts.push(resolved.genericName)
  }
  if (parsed.strength) detailParts.push(parsed.strength)
  else if (resolved.catalogStrength) detailParts.push(resolved.catalogStrength)
  if (parsed.frequency) detailParts.push(parsed.frequency.toUpperCase())

  return {
    name: resolved.name,
    // `detail` is kept for the existing result card layout.
    detail: detailParts.join(' · ') || 'Prescription medicine',
    genericName: resolved.genericName,
    strength: parsed.strength || resolved.catalogStrength || '',
    form: parsed.form || '',
    frequency: parsed.frequency || '',
    duration: parsed.duration || '',
    medicineId: resolved.medicineId,
    source: resolved.source,
    confidence,
    band: bandFor(confidence),
    // The identity and how closely it matched, not just where the text came
    // from. A catalog source carries an identity by construction; passing both
    // keeps the two paths deciding on the same evidence.
    needsConfirmation: needsConfirmation(confidence, resolved.source, {
      medicineId: resolved.medicineId,
      matchScore: resolved.nameSimilarity,
    }),
    reason: explain(resolved.source, confidence),
    sourceText: parsed.raw,
  }
}

/** Collapse duplicates, keeping the highest-confidence reading of each name. */
function dedupe(medicines) {
  const byName = new Map()
  for (const medicine of medicines) {
    const key = medicine.name.trim().toLowerCase()
    const existing = byName.get(key)
    if (!existing || medicine.confidence > existing.confidence) byName.set(key, medicine)
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence)
}

/** Read the raw text out of an image or a PDF. */
async function extractText(file, { onProgress }) {
  if (isPdf(file)) {
    const result = await extractPdf(file, { onProgress })
    return result
  }

  onProgress?.({ phase: 'preparing' })
  // Upscale and normalize before OCR — a low-resolution photo is where
  // "Amoxicillin" becomes "Amescitin", and no downstream matching recovers
  // characters that were never read correctly.
  const prepared = await prepareImageForOcr(file)

  onProgress?.({ phase: 'ocr', page: 1, totalPages: 1, progress: 0 })
  const { text, confidence } = await recognize(prepared, {
    onProgress: (progress) => onProgress?.({ phase: 'ocr', page: 1, totalPages: 1, progress }),
  })
  return {
    text,
    pages: [{ page: 1, text, source: 'ocr', confidence }],
    warnings: [],
    pageImages: [],
    ocrConfidence: confidence,
  }
}

/**
 * Extract medicines from an uploaded prescription.
 *
 * @returns {Promise<{
 *   medicines: Array<object>,
 *   confident: Array<object>,
 *   unconfirmed: Array<object>,
 *   warnings: string[],
 *   stats: { pages: number, candidates: number, ocrConfidence: number|null },
 *   needsVisionFallback: boolean,
 *   pageImages: string[],
 *   rawText: string,
 * }>}
 */
export async function extractPrescriptionMeds(file, { onProgress } = {}) {
  if (!file) throw new UnsupportedFormatError('No file was provided.')

  if (isHeic(file)) {
    // Browsers cannot decode HEIC to a canvas and Tesseract cannot read it, so
    // accepting one would return "0 medicines found" with no explanation. Fail
    // loudly with something the user can act on instead.
    throw new UnsupportedFormatError(
      'HEIC/HEIF photos cannot be read in the browser. On iPhone, use "Take a photo" here, ' +
        'or re-save the image as JPEG or PNG and upload it again.',
    )
  }

  onProgress?.({ phase: 'preparing' })

  let extracted
  try {
    extracted = await extractText(file, { onProgress })
  } catch (err) {
    if (err instanceof OcrUnavailableError) throw err
    throw new NoTextExtractedError(
      `Could not read this file (${err?.message ?? 'unknown error'}). Try a clearer photo or a PDF.`,
    )
  }

  const warnings = [...extracted.warnings]
  const rawText = extracted.text ?? ''

  if (!rawText.trim()) {
    const quality = assessScanQuality({
      rawText,
      ocrConfidence: extracted.ocrConfidence,
      candidateCount: 0,
      medicines: [],
    })
    return {
      medicines: [],
      confident: [],
      unconfirmed: [],
      warnings,
      stats: { pages: extracted.pages.length, candidates: 0, ocrConfidence: extracted.ocrConfidence },
      quality,
      needsVisionFallback: quality.shouldOfferVision,
      pageImages: extracted.pageImages,
      rawText,
    }
  }

  onProgress?.({ phase: 'matching' })

  const candidates = extractCandidateLines(rawText)
  const parsedCandidates = candidates.map(parseCandidate).filter(Boolean)

  const catalogReachable = { value: true }
  const resolved = await mapWithConcurrency(parsedCandidates, MATCH_CONCURRENCY, (parsed) =>
    resolveCandidate(parsed, { ocrConfidence: extracted.ocrConfidence, catalogReachable }),
  )

  const medicines = dedupe(
    resolved
      .map((entry, index) => (entry ? toMedicine(entry, parsedCandidates[index]) : null))
      .filter(Boolean)
      .filter((medicine) => medicine.band !== BAND.REJECTED),
  )

  if (!catalogReachable.value) {
    warnings.push('The medicine catalog was unreachable, so names were matched offline. Please confirm each one.')
  }

  const confident = medicines.filter((medicine) => !medicine.needsConfirmation)
  const unconfirmed = medicines.filter((medicine) => medicine.needsConfirmation)

  // Whether the extraction is worth standing behind, rather than whether it
  // produced anything. `confident.length === 0` was the old test, and it called
  // a scan of three genuinely uncatalogued medicines a failure while passing a
  // page of instruction text that happened to contain one recognisable brand.
  const quality = assessScanQuality({
    rawText,
    ocrConfidence: extracted.ocrConfidence,
    candidateCount: parsedCandidates.length,
    medicines,
    catalogReachable: catalogReachable.value,
  })

  return {
    medicines,
    confident,
    unconfirmed,
    warnings,
    stats: {
      pages: extracted.pages.length,
      candidates: parsedCandidates.length,
      ocrConfidence: extracted.ocrConfidence,
    },
    quality,
    needsVisionFallback: quality.shouldOfferVision,
    pageImages: extracted.pageImages,
    rawText,
  }
}

/**
 * Fold assisted-reading results into an existing extraction.
 *
 * Vision output used to be trusted as far as its own name string: it was turned
 * straight into a card without passing the non-medicine filter every on-device
 * candidate goes through, and without ever being looked up in MediBase. So an
 * instruction the model transcribed became a medicine the patient was asked to
 * confirm, and a medicine it read perfectly arrived with no governed identity
 * behind it — the patient confirmed a free-text name rather than a catalog entry.
 *
 * Now it takes the same path everything else does: reject what is not a
 * medicine, then resolve the name against the catalog so a match carries its
 * MediBase id.
 *
 * What does NOT change is the confirmation rule. `needsConfirmation` keeps
 * returning true for MATCH_SOURCE.VISION whatever the catalog says, because
 * assisted reading is a second attempt at text the on-device reader could not
 * resolve — a catalog hit makes the identity trustworthy, not the reading.
 */
export async function mergeVisionResults(result, visionMedicines) {
  const named = (visionMedicines ?? [])
    .filter((entry) => entry?.name && String(entry.name).trim().length >= 3)
    // The same prose filter the on-device path applies. A transcribed
    // "Take after food" is not a medicine just because a model read it clearly.
    .filter((entry) => !isNonMedicineProse(String(entry.name).trim()))

  const catalogReachable = { value: true }
  const converted = await mapWithConcurrency(named, MATCH_CONCURRENCY, async (entry) => {
    const name = String(entry.name).trim()
    const modelConfidence =
      typeof entry.confidence === 'number' ? Math.min(1, Math.max(0, entry.confidence)) : 0.7

    // Resolve against MediBase. The identity is what makes acceptance possible
    // at all, and the strength of the match is what decides whether it happens.
    let medicineId = null
    let matchScore = null
    let genericName = entry.genericName ?? ''
    let catalogName = null
    if (catalogReachable.value) {
      try {
        const matches = await matchMedicines(name, 5)
        const scored = (matches ?? [])
          .map((match) => {
            const references = [match.name, match.generic, ...(match.brands ?? [])].filter(Boolean)
            const { score } = bestSimilarity(name, references)
            return { match, score }
          })
          .sort((a, b) => b.score - a.score)
        const best = scored[0]
        if (best && best.score >= MEDIBASE_MATCH_FLOOR) {
          medicineId = best.match.id ?? null
          matchScore = best.score
          catalogName = best.match.name
          genericName = genericName || (best.match.generic ?? '')
        }
      } catch {
        catalogReachable.value = false
      }
    }

    // Scored the same way every other source is: the catalog match carries the
    // name signal, and the model's own certainty about the line takes the place
    // OCR confidence holds on the on-device path — it is the same quantity, how
    // sure the reader was of the characters.
    const confidence = computeConfidence({
      nameSimilarity: matchScore ?? modelConfidence,
      source: MATCH_SOURCE.VISION,
      evidence: { strength: Boolean(entry.strength), form: Boolean(entry.form) },
      ocrConfidence: modelConfidence,
    })
    const detailParts = [genericName, entry.strength, entry.frequency].filter(Boolean)

    return {
      // The catalog's spelling when it recognised the name, the model's
      // otherwise — the same precedence the on-device path uses.
      name: catalogName ?? name,
      detail: detailParts.join(' · ') || 'Prescription medicine',
      genericName,
      strength: entry.strength ?? '',
      form: entry.form ?? '',
      frequency: entry.frequency ?? '',
      duration: entry.duration ?? '',
      medicineId,
      source: MATCH_SOURCE.VISION,
      confidence,
      band: bandFor(confidence),
      // Accepted only on a governed identity matched well above the floor that
      // merely permits a match — see VISION_AUTO_ACCEPT_MATCH. Anything the
      // catalog did not recognise, or recognised only loosely, still confirms.
      needsConfirmation: needsConfirmation(confidence, MATCH_SOURCE.VISION, {
        medicineId,
        matchScore,
      }),
      reason: explain(MATCH_SOURCE.VISION, confidence),
      sourceText: '',
    }
  })

  const medicines = dedupe([
    ...result.medicines,
    ...converted.filter((medicine) => medicine.band !== BAND.REJECTED),
  ])

  return {
    ...result,
    medicines,
    confident: medicines.filter((medicine) => !medicine.needsConfirmation),
    unconfirmed: medicines.filter((medicine) => medicine.needsConfirmation),
    needsVisionFallback: false,
    visionUsed: true,
  }
}
