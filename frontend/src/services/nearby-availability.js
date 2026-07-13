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
    .map((p, i) => ({
      ...p,
      status: STATUS_CYCLE[(seed + i) % STATUS_CYCLE.length],
      updated: UPDATED_SAMPLES[(seed + i) % UPDATED_SAMPLES.length],
    }))
  return summarize(q, items)
}

const settle = (value, ms = 320) => new Promise((resolve) => setTimeout(() => resolve(value), ms))

export async function searchNearbyAvailability({ q, maxDistanceKm }) {
  try {
    const data = await searchMedicines({ q, maxDistance: maxDistanceKm })
    const ph = data?.pharmacies ?? []
    if (ph.length) {
      const items = ph.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        distance: p.distance,
        phone: p.phone,
        is24x7: p.open24h,
        status: STATUS_BY_CONFIDENCE[p.confidence] ?? 'unconfirmed',
        updated: p.updated,
      }))
      return { source: 'live', ...summarize(q, items) }
    }
  } catch {
    /* no session / API error — fall through to the demo dataset */
  }
  return { source: 'demo', ...(await settle(demoResult(q, maxDistanceKm))) }
}
