// "Is this medicine available near me?" — the core patient question.
//
// Registered-pharmacy availability comes from the governed /me/search API and
// nowhere else: every pharmacy name, address, coordinate, distance, confidence
// band, signal age and phone number in the "Availability near you" section is a
// field of that response.
//
// There is deliberately NO local pharmacy dataset. A fabricated pharmacy on a
// medicine-availability screen is worse than an empty one: a patient could
// travel to a pharmacy that does not exist, or that never reported the
// medicine. When the API returns nothing, or fails, the caller receives an
// empty, well-formed result and the UI shows its empty state.
//
// Availability is always a confidence signal, never exact stock, per the
// ZoikoMeds governance model.
import { searchMedicines } from './user-api'
import { toSearchQuery } from '@/lib/inn'

// status ∈ available | limited | unconfirmed | unavailable
const STATUS_RANK = { available: 0, limited: 1, unconfirmed: 2, unavailable: 3 }

// Map the API's confidence band onto an availability status.
const STATUS_BY_CONFIDENCE = {
  high: 'available',
  moderate: 'limited',
  low: 'unconfirmed',
  unknown: 'unavailable',
}

const titleCase = (s) => (s || '').trim().replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Fallback identity for a medicine MediBase does not hold.
 *
 * This is NOT invented data: the name is the patient's own search term, and
 * every clinical field is left empty rather than guessed. It exists so a
 * medicine absent from the catalog can still be named on screen and saved —
 * see the off-catalog save flow. `id: null` tells the UI there is no governed
 * identity behind it, so no detail page is offered.
 */
function identityFromQuery(q) {
  const name = titleCase(q)
  return name
    ? { id: null, name, generic: '', manufacturer: '', strength: '', form: '', rx: null }
    : null
}

/** An honest "nothing to show" result. No pharmacies are ever fabricated. */
function emptyResult(q, internet = null) {
  return {
    source: 'live',
    identity: identityFromQuery(q),
    medicine: (q ?? '').trim(),
    items: [],
    availableCount: 0,
    total: 0,
    internet,
  }
}

function summarize(medicine, items) {
  const sorted = [...items].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.distance ?? 999) - (b.distance ?? 999),
  )
  const availableCount = sorted.filter((i) => i.status === 'available' || i.status === 'limited').length
  return { medicine: medicine?.trim() || '', items: sorted, availableCount, total: sorted.length }
}

// Map the backend `internetPharmacies` block (Google Places) onto the shape the
// UI renders. These are nearby pharmacies discovered on the web — geographic
// only, with no stock/availability claim.
function mapInternet(internet) {
  if (!internet) return null
  return {
    configured: internet.configured ?? false,
    note: internet.note ?? null,
    origin: internet.origin ?? null,
    pharmacies: (internet.pharmacies ?? []).map((p) => ({
      id: p.placeId || `${p.name}-${p.latitude},${p.longitude}`,
      name: p.name,
      address: p.address,
      distance: p.distanceKm,
      phone: p.phone,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      openNow: p.openNow,
      mapsUri: p.googleMapsUri,
    })),
  }
}

/**
 * Availability for a medicine near the caller.
 *
 * Every registered-pharmacy field below is read straight off the API response —
 * nothing is defaulted to a made-up value. An empty list means the API returned
 * no verified pharmacy stocking this medicine in range, and the UI says so.
 */
export async function searchNearbyAvailability({ q, maxDistanceKm, lat, lng, city }) {
  let data
  try {
    // A query typed in Arabic or Chinese is resolved to its INN first; the
    // catalog is stored in Latin script, so otherwise it could never match.
    // Latin input passes through untouched — MediBase's own variant expansion
    // and brand-name matching already cover it and see more of the catalog.
    data = await searchMedicines({
      q: toSearchQuery(q),
      maxDistance: maxDistanceKm,
      lat,
      lng,
      city,
    })
  } catch {
    // No session, or the API is unreachable. Report nothing rather than
    // showing pharmacies that were never confirmed to hold this medicine.
    return emptyResult(q)
  }

  const internet = mapInternet(data?.internetPharmacies)

  const items = (data?.pharmacies ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    distance: p.distance,
    phone: p.phone,
    // Exact coordinates when the pharmacy has been located, so Directions
    // pins the branch rather than searching its name.
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    // NOTE: the API's `open24h` is deliberately not mapped. No opening-hours
    // field exists on the pharmacy record, so that flag is inferred from the
    // reliability score — a claim about the branch's hours that nobody made.
    // Governed confidence band is the primary signal; status is derived.
    confidence: p.confidence ?? 'unknown',
    status: STATUS_BY_CONFIDENCE[p.confidence] ?? 'unconfirmed',
    updated: p.updated,
  }))

  // MediBase™ identity for the best-matching medicine (API ranks medicines[]).
  const m = data?.medicines?.[0]
  const identity = m
    ? {
        id: m.id ?? null,
        name: m.name,
        generic: m.generic,
        manufacturer: m.manufacturer,
        strength: m.strength,
        form: m.form,
        rx: m.rx ?? null,
      }
    : identityFromQuery(q)

  return { source: 'live', identity, ...summarize(q, items), internet }
}
