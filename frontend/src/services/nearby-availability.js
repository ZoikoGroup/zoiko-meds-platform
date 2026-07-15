// "Is this medicine available near me?" — the core patient question.
//
// Prefers the governed /me/search API (which returns nearby verified pharmacies
// with an availability CONFIDENCE band per medicine). When that returns nothing
// — e.g. no session or empty demo DB — it falls back to a deterministic demo
// dataset so the experience stays populated. Availability is always a confidence
// signal, never exact stock, per the ZoikoMeds governance model.
import { searchMedicines } from './user-api'

// status ∈ available | limited | unconfirmed | unavailable
const STATUS_RANK = { available: 0, limited: 1, unconfirmed: 2, unavailable: 3 }

// Map the API's confidence band onto an availability status.
const STATUS_BY_CONFIDENCE = {
  high: 'available',
  moderate: 'limited',
  low: 'unconfirmed',
  unknown: 'unavailable',
}

// Inverse: derive the governed ZoikoAvail™ confidence band from a status. The
// demo dataset is keyed by status, so this keeps the confidence vocabulary
// (high/moderate/low/unknown) available as the primary signal in the UI.
const CONFIDENCE_BY_STATUS = {
  available: 'high',
  limited: 'moderate',
  unconfirmed: 'low',
  unavailable: 'unknown',
}

const titleCase = (s) => (s || '').trim().replace(/\b\w/g, (c) => c.toUpperCase())

// MediBase™ identity shown above the availability list. Only the display name
// is known for the demo dataset; clinical fields are left blank, not fabricated.
function demoIdentity(q) {
  const name = titleCase(q)
  return name ? { id: null, name, generic: '', manufacturer: '', strength: '', form: '', rx: null } : null
}

const DEMO_PHARMACIES = [
  { id: 'p1', name: 'MedPlus', address: 'Bachupally, Hyderabad', distance: 1.2, phone: '+914012345670', is24x7: true },
  { id: 'p2', name: 'Sri Sai Kanaka Durga Medical', address: 'Nizampet, Hyderabad', distance: 2.4, phone: '+914012345671', is24x7: false },
  { id: 'p3', name: 'Sri Sai Datta Medical & General Stores', address: 'Kistaipally, Hyderabad', distance: 3.1, phone: '+914012345672', is24x7: false },
  { id: 'p4', name: 'Life Line Medical & Pharmacy', address: 'Miyapur, Hyderabad', distance: 4.6, phone: '+914012345673', is24x7: true },
  { id: 'p5', name: 'Balaji Medical Store', address: 'Bowrampet, Hyderabad', distance: 6.0, phone: '+914012345674', is24x7: false },
  { id: 'p6', name: 'Sri Venkateshwara Pharmacy', address: 'Bachupally Rd, Hyderabad', distance: 8.3, phone: '+914012345675', is24x7: false },
  { id: 'p7', name: 'Mahalakshmi Pharmacy', address: 'Dundigal, Hyderabad', distance: 11.5, phone: '+914012345676', is24x7: true },
]

const UPDATED_SAMPLES = ['just now', '6 minutes ago', '18 minutes ago', '40 minutes ago', '1 hour ago', '2 hours ago', '3 hours ago']
// Deterministic status spread so the same medicine yields stable results.
const STATUS_CYCLE = ['available', 'available', 'limited', 'available', 'unconfirmed', 'limited', 'unavailable']

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function summarize(medicine, items) {
  const sorted = [...items].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.distance ?? 999) - (b.distance ?? 999),
  )
  const availableCount = sorted.filter((i) => i.status === 'available' || i.status === 'limited').length
  return { medicine: medicine?.trim() || '', items: sorted, availableCount, total: sorted.length }
}

function demoResult(q, maxDistanceKm) {
  const seed = hashString((q || 'medicine').toLowerCase())
  const items = DEMO_PHARMACIES
    .filter((p) => p.distance <= maxDistanceKm)
    .map((p, i) => {
      const status = STATUS_CYCLE[(seed + i) % STATUS_CYCLE.length]
      return {
        ...p,
        status,
        confidence: CONFIDENCE_BY_STATUS[status],
        updated: UPDATED_SAMPLES[(seed + i) % UPDATED_SAMPLES.length],
      }
    })
  return summarize(q, items)
}

const settle = (value, ms = 320) => new Promise((resolve) => setTimeout(() => resolve(value), ms))

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

export async function searchNearbyAvailability({ q, maxDistanceKm, lat, lng, city }) {
  try {
    const data = await searchMedicines({ q, maxDistance: maxDistanceKm, lat, lng, city })
    const ph = data?.pharmacies ?? []
    const internet = mapInternet(data?.internetPharmacies)
    if (ph.length || internet) {
      const items = ph.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        distance: p.distance,
        phone: p.phone,
        is24x7: p.open24h,
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
        : demoIdentity(q)
      return { source: 'live', identity, ...summarize(q, items), internet }
    }
  } catch {
    /* no session / API error — fall through to the demo dataset */
  }
  return { source: 'demo', identity: demoIdentity(q), ...(await settle(demoResult(q, maxDistanceKm))), internet: null }
}
