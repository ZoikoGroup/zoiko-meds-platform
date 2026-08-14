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
import { extractCandidateLines, parseCandidate, titleCase } from './candidate-extract'
import { bestSimilarity, containsName, similarity } from './text-normalize'
import { matchOfflineDictionary } from './known-drugs'
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
  const { name, evidence } = parsed

  if (catalogReachable.value) {
    try {
      const matches = await matchMedicines(name, 5)
      const scored = (matches ?? [])
        .map((match) => {
          // `brands` is the mapped field name from toMedicineIdentity().
          const references = [match.name, match.generic, ...(match.brands ?? [])].filter(Boolean)
          const { score } = bestSimilarity(name, references)
          const contained = references.some((reference) => containsName(name, reference))
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
  if (!evidence.nameLike || name.length < 4) return null

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
    needsConfirmation: needsConfirmation(confidence, resolved.source),
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
    return {
      medicines: [],
      confident: [],
      unconfirmed: [],
      warnings,
      stats: { pages: extracted.pages.length, candidates: 0, ocrConfidence: extracted.ocrConfidence },
      needsVisionFallback: true,
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
    // Offer assisted reading when OCR found nothing, or found nothing it could
    // stand behind without a human check.
    needsVisionFallback: medicines.length === 0 || confident.length === 0,
    pageImages: extracted.pageImages,
    rawText,
  }
}

/**
 * Fold AI/Vision results into an existing extraction result.
 * Vision candidates are always confirmable — they never auto-accept.
 */
export function mergeVisionResults(result, visionMedicines) {
  const converted = (visionMedicines ?? [])
    .filter((entry) => entry?.name && String(entry.name).trim().length >= 3)
    .map((entry) => {
      const confidence = computeConfidence({
        nameSimilarity: typeof entry.confidence === 'number' ? Math.min(1, Math.max(0, entry.confidence)) : 0.7,
        source: MATCH_SOURCE.VISION,
        evidence: { strength: Boolean(entry.strength), form: Boolean(entry.form) },
      })
      const detailParts = [entry.genericName, entry.strength, entry.frequency].filter(Boolean)
      return {
        name: String(entry.name).trim(),
        detail: detailParts.join(' · ') || 'Prescription medicine',
        genericName: entry.genericName ?? '',
        strength: entry.strength ?? '',
        form: entry.form ?? '',
        frequency: entry.frequency ?? '',
        duration: entry.duration ?? '',
        medicineId: null,
        source: MATCH_SOURCE.VISION,
        confidence,
        band: bandFor(confidence),
        // Always confirmed by the user: assisted reading is a fallback for text
        // the on-device reader could not resolve, not a source of truth.
        needsConfirmation: true,
        reason: explain(MATCH_SOURCE.VISION, confidence),
        sourceText: '',
      }
    })
    .filter((medicine) => medicine.band !== BAND.REJECTED)

  const medicines = dedupe([...result.medicines, ...converted])
  return {
    ...result,
    medicines,
    confident: medicines.filter((medicine) => !medicine.needsConfirmation),
    unconfirmed: medicines.filter((medicine) => medicine.needsConfirmation),
    needsVisionFallback: false,
    visionUsed: true,
  }
}
