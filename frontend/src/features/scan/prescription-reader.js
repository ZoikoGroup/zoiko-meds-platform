// Reading a prescription, server-side.
//
// The whole file — photo or PDF — is posted to the ZoikoMeds backend, which
// reads it with a document model and then verifies every medicine against
// MediBase. Nothing is read in the browser any more: no OCR worker, no PDF text
// extraction. A document model reads handwriting, two-column directions and
// page four of a PDF; the on-device pipeline could not, and the quality
// guidance it produced was mostly an apology for that.
//
// The provider is never named to the patient and never reachable from here. The
// browser talks to ZoikoMeds and nothing else; the model key is a server secret.
//
// WHAT THIS MODULE IS RESPONSIBLE FOR
//
// Turning the backend's verification contract into the shape the existing
// results UI already renders. That adaptation lives here rather than in the
// component so the component kept its markup: MATCHED becomes a confident row,
// AMBIGUOUS and NOT_FOUND become rows that ask the patient to confirm, which is
// exactly the distinction the UI was already drawing.

import { apiFetch } from '@/lib/api-client'

/** Mirrors the backend's verification vocabulary. */
export const VERIFICATION = {
  MATCHED: 'MATCHED',
  AMBIGUOUS: 'AMBIGUOUS',
  NOT_FOUND: 'NOT_FOUND',
  /** The line itself could not be read, so the patient is asked what it says. */
  USER_CONFIRMATION_REQUIRED: 'USER_CONFIRMATION_REQUIRED',
}

/**
 * How long to wait for a prescription to be read.
 *
 * Generous: a multi-page PDF is a real document-understanding call, and a
 * deadline that fires on a scan which would have succeeded turns a slow answer
 * into a wrong one. The backend has its own 60s per-attempt ceiling plus
 * bounded retries, so this only needs to outlast that.
 */
export const READ_TIMEOUT_MS = 120_000

/** Raised when reading failed in a way the patient can act on. */
export class PrescriptionReadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PrescriptionReadError'
  }
}

/**
 * Is scanning configured on this deployment? Returns false rather than throwing
 * when the endpoint is missing or the key is unset, so the UI can simply not
 * offer it.
 */
export async function isPrescriptionScanAvailable() {
  try {
    const status = await apiFetch('/scan/prescription-status')
    return Boolean(status?.available)
  } catch {
    return false
  }
}

/**
 * Read one prescription and return the medicines, already verified.
 *
 * Shaped like the on-device extractor it replaces, so the results UI did not
 * have to change: `{ medicines, confident, unconfirmed, warnings, stats, … }`.
 */
export async function readPrescription(file, { onProgress } = {}) {
  onProgress?.({ phase: 'preparing' })
  const dataUrl = await fileToDataUrl(file)

  onProgress?.({ phase: 'reading' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)

  let response
  try {
    response = await apiFetch('/scan/prescription', {
      method: 'POST',
      body: { file: dataUrl },
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new PrescriptionReadError(
        'Reading this prescription took too long. Try a smaller or clearer file.',
      )
    }
    // The API client already surfaces the backend's own message, which is
    // written for a patient. Anything without one gets a plain fallback rather
    // than a provider error.
    throw new PrescriptionReadError(
      err?.message || 'Could not read this prescription. Please try again, or search by name.',
    )
  } finally {
    clearTimeout(timer)
  }

  return adapt(response)
}

/** The backend contract, as the existing results UI expects to receive it. */
function adapt(response) {
  const rows = Array.isArray(response?.medicines) ? response.medicines : []
  const medicines = rows.map(toUiMedicine).filter(Boolean)
    // A stable per-row handle. The displayed name is no longer unique, or even
    // present — an unread line has none — so selection state is keyed on this
    // rather than on anything the patient can see.
    .map((medicine, index) => ({ ...medicine, key: `rx-${index}` }))

  return {
    medicines,
    confident: medicines.filter((medicine) => !medicine.needsConfirmation),
    unconfirmed: medicines.filter((medicine) => medicine.needsConfirmation),
    warnings: [],
    stats: {
      pages: null,
      candidates: medicines.length,
      ocrConfidence: null,
    },
    quality: null,
    // Reuses the "we couldn't read this clearly" guidance the UI already has.
    // It no longer offers to upload anywhere — the upload has already happened —
    // but the advice (lighting, flat, sharp, whole page, prefer the PDF) is
    // exactly what helps when a scan comes back empty.
    needsVisionFallback: medicines.length === 0,
    visionUsed: false,
    pageImages: [],
    sourceType: response?.source?.type ?? null,
    message: response?.message ?? null,
  }
}

function toUiMedicine(row) {
  const extracted = row?.extracted
  const verification = row?.verification
  // `rawText` is the one thing every row has. A name is no longer guaranteed:
  // a line the reader could not make out arrives with name null, and that row
  // is precisely the one the patient most needs to see.
  if (!extracted?.rawText || !verification?.status) return null

  const canonical = verification.medicine ?? null
  const matched = verification.status === VERIFICATION.MATCHED && canonical

  // A matched medicine is carried forward under the catalog's own name, not the
  // reading — the point of verifying is that everything downstream, the pharmacy
  // availability search included, uses the identity MediBase settled on rather
  // than whatever was written on the page.
  //
  // Unmatched rows keep the reading, with the strength appended when it is not
  // already part of the name: it is the honest label, and it keeps two
  // strengths of the same medicine from collapsing into one row.
  // A line whose name could not be read is labelled with what was actually on
  // the page — "Amo... 500" — rather than a tidy guess. That is the honest
  // label, and it is what the patient compares against their prescription.
  const readingLabel = extracted.name
    ? [extracted.name, includesStrength(extracted) ? null : extracted.strength]
        .filter(Boolean)
        .join(' ')
    : (extracted.uncertainText ?? extracted.rawText)

  const name = matched ? canonical.brandName : readingLabel

  const detail = matched
    ? [canonical.genericName, canonical.strength, canonical.manufacturer].filter(Boolean).join(' · ')
    : [extracted.strength, extracted.dosageForm, extracted.dose, extracted.frequency]
        .filter(Boolean)
        .join(' · ')

  return {
    name,
    detail,
    // Two different lengths of the same fact. `note` is one short line for the
    // collapsed row, where fourteen medicines have to fit on a screen; `reason`
    // is the fuller explanation, shown only in the row the patient opened.
    note: noteFor(verification.status),
    reason: verification.reason ?? null,
    needsConfirmation: !matched,
    status: verification.status,
    // The canonical identity, when there is one. `medicineId` is what a
    // downstream lookup should key on.
    medicineId: canonical?.id ?? null,
    genericName: canonical?.genericName ?? null,
    manufacturer: canonical?.manufacturer ?? null,
    strength: canonical?.strength ?? extracted.strength ?? '',
    form: canonical?.dosageForm ?? extracted.dosageForm ?? '',
    // Alternatives for an ambiguous reading, so the patient can choose rather
    // than have one picked for them.
    candidates: Array.isArray(verification.candidates) ? verification.candidates : [],
    // The reading itself, always kept so a human can check what was on the page.
    sourceText: extracted.rawText,
    extracted,
  }
}

/**
 * The one-line version of why a row is not settled.
 *
 * Returned as a translation key plus an English fallback rather than a finished
 * string: this module has no access to the language provider, and the component
 * that renders the row does.
 */
function noteFor(status) {
  switch (status) {
    case VERIFICATION.NOT_FOUND:
      return {
        key: 'notFoundInCatalog',
        text: 'Read from your prescription but not found in the catalog',
      }
    case VERIFICATION.AMBIGUOUS:
      return { key: 'moreThanOnePossible', text: 'More than one catalog medicine could be this' }
    case VERIFICATION.USER_CONFIRMATION_REQUIRED:
      return { key: 'unclearConfirmWhich', text: "Couldn't be read clearly — confirm which medicine this is" }
    default:
      return null
  }
}

/** Does the written name already carry its strength ("Dolo 650")? */
function includesStrength(extracted) {
  if (!extracted.strength || !extracted.name) return true
  const digits = extracted.strength.match(/\d+(?:\.\d+)?/)?.[0]
  return Boolean(digits && extracted.name.includes(digits))
}

/**
 * Adopt a catalog medicine the patient chose for a row.
 *
 * The identity comes from MediBase either way — it was returned as a candidate,
 * or it came back from a catalog search — so confirming is a local promotion,
 * not a new verification. The reading is kept beside it: the point of showing
 * "we read Amo... 500, you said Amoxicillin 500 mg" is that it stays checkable.
 *
 * The prescription is never re-read, and no new medicine record is created.
 */
export function confirmMedicine(medicine, chosen) {
  return {
    ...medicine,
    name: chosen.brandName ?? chosen.name ?? medicine.name,
    detail: [chosen.genericName, chosen.strength, chosen.manufacturer].filter(Boolean).join(' · '),
    medicineId: chosen.id,
    genericName: chosen.genericName ?? null,
    manufacturer: chosen.manufacturer ?? null,
    strength: chosen.strength ?? '',
    form: chosen.dosageForm ?? '',
    needsConfirmation: false,
    confirmedByUser: true,
    status: VERIFICATION.MATCHED,
    reason: null,
    candidates: [],
  }
}

/** A File as a base64 data URL, which is what the endpoint accepts. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new PrescriptionReadError('That file could not be read.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}
