import { apiFetch } from '@/lib/api-client'

// Public MediBase™ / ZoikoAvail™ catalog endpoints (no /me scope, no auth
// required). These power autocomplete, the medicine detail page, and the
// per-medicine availability list. All availability is a governed CONFIDENCE
// band — never exact stock.

// Backend AvailabilityConfidence enum → the frontend's lowercase band vocabulary
// (see lib/availability.js + <ConfidenceBadge>).
const BAND = { HIGH: 'high', MODERATE: 'moderate', LOW: 'low', UNKNOWN: 'unknown', SUPPRESSED: 'unknown' }

const relativeFromMinutes = (mins) => {
  if (mins == null) return 'No recent signal'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.round(mins)} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Map a raw MediBase entity (from /medibase/match or /medibase/:id) to the
// identity shape the patient UI uses. Only the display name is guaranteed;
// clinical fields are surfaced only when the backend provides them.
export function toMedicineIdentity(m) {
  if (!m) return null
  const brands = m.brandNames ?? []
  return {
    id: m.id,
    name: m.canonicalName,
    generic: m.genericName ?? '',
    brands,
    brand: brands[0] ?? '',
    isGeneric: brands.length === 0,
    strength: m.strength ?? '',
    form: m.dosageForm ?? '',
    route: m.route ?? '',
    manufacturer: m.manufacturer ?? '',
    description: m.description ?? '',
    category: m.prescriptionCategory ?? 'UNKNOWN',
    rx: (m.prescriptionCategory ?? 'UNKNOWN') !== 'OTC',
    identifiers: m.identifiers ?? [],
  }
}

/**
 * How long a single catalog lookup may take before it is abandoned.
 *
 * A prescription scan makes one of these per candidate. Without a deadline a
 * stalled connection held the whole scan open with nothing to cancel it, and
 * the caller already treats a failed lookup as "not in the catalog" — which
 * routes the medicine to confirmation rather than losing it. Waiting longer
 * than this buys nothing a patient can use.
 */
const MATCH_TIMEOUT_MS = 10_000

/** Autocomplete / typeahead — governed medicine identity candidates. */
export async function matchMedicines(q, limit = 8) {
  if (!q || !q.trim()) return []
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  // The deadline is supplied per call rather than built into apiFetch: most of
  // the app's requests are user-initiated and should wait as long as the user
  // is willing to. This one is made in bulk by a background scan.
  const rows = await apiFetch(`/medibase/match?${params.toString()}`, {
    auth: false,
    signal: AbortSignal.timeout?.(MATCH_TIMEOUT_MS),
  })
  return (rows ?? []).map(toMedicineIdentity)
}

/** Full MediBase identity for one medicine (detail page). */
export async function getMedicineById(id) {
  const m = await apiFetch(`/medibase/${id}`, { auth: false })
  return toMedicineIdentity(m)
}

/** Per-medicine availability across verified, participating pharmacies. */
export async function getMedicineAvailability(medicineId) {
  const params = new URLSearchParams({ medicineId })
  const rows = await apiFetch(`/availability?${params.toString()}`, { auth: false })
  return (rows ?? []).map((s) => ({
    pharmacy: s.pharmacy,
    confidence: BAND[s.confidence] ?? 'unknown',
    requiresConfirmation: s.requiresConfirmation,
    updated: relativeFromMinutes(s.freshnessMinutes),
  }))
}
