/**
 * ZoikoAvail™ availability model — governed presentation helpers.
 *
 * Per the ZoikoMeds build reference, availability is expressed as a
 * CONFIDENCE band (never exact stock counts). The engine weighs a signal's
 * freshness, pharmacy reliability, and verification to decide whether to
 * display, downgrade, suppress, or route it for confirmation.
 *
 * What a patient reads off each band:
 *
 *   HIGH      → High           · likely available now
 *   MODERATE  → Moderate       · may be limited
 *   LOW       → Out of stock   · the pharmacy has reported it as not available
 *   UNKNOWN   → Out of stock   · no availability the pharmacy stands behind
 *   SUPPRESSED→ hidden entirely (never reaches the client)
 *
 * LOW and UNKNOWN say "out of stock" because that is what the pharmacy said:
 * the portal writes LOW when an operator sets a medicine to Out of stock, and
 * UNKNOWN is a row carrying no availability the pharmacy stands behind. Calling
 * either "not recently confirmed" described our own certainty instead of the
 * pharmacy's answer, and left the two portals saying different things about one
 * record. The pharmacy still appears — it carries the medicine, it just has
 * none right now — and only disappears when the medicine leaves its inventory.
 */
export const AVAILABILITY = {
  high: { label: 'High', tone: 'good', plain: 'Likely available now', order: 0 },
  moderate: { label: 'Moderate', tone: 'serious', plain: 'May be limited — confirm first', order: 1 },
  low: { label: 'Out of stock', tone: 'critical', plain: 'Out of stock', order: 2 },
  unknown: { label: 'Out of stock', tone: 'critical', plain: 'Out of stock', order: 3 },
}

/** Availability band as a patient-facing label + badge tone, never undefined. */
export function availabilityMeta(band) {
  return AVAILABILITY[band] ?? AVAILABILITY.unknown
}

/** Sort helper: strongest confidence first. */
export function byConfidence(a, b) {
  return (AVAILABILITY[a]?.order ?? 9) - (AVAILABILITY[b]?.order ?? 9)
}

/** Standard governance disclaimer shown wherever availability is presented. */
export const CONFIRM_NOTE =
  'Availability is a governed confidence signal from verified pharmacies — not exact stock. Please confirm with the pharmacy before visiting.'

/** ZoikoMeds is not a pharmacy/marketplace/dispensing/delivery/advice tool. */
export const SCOPE_NOTE =
  'ZoikoMeds shows where medicines may be available. It is not a pharmacy, marketplace, dispensing, or delivery service and does not provide medical advice.'

/** Directions via the user's maps provider (navigation only). */
export function mapsHref(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * Directions to a verified pharmacy — exact coordinates when the record has
 * been located, otherwise a name/address lookup. Coordinates matter for chains
 * where several branches share a name.
 */
export function pharmacyDirectionsHref(pharmacy) {
  if (pharmacy?.latitude != null && pharmacy?.longitude != null) {
    return mapsHref(`${pharmacy.latitude},${pharmacy.longitude}`)
  }
  return mapsHref([pharmacy?.name, pharmacy?.address].filter(Boolean).join(', '))
}

/** Click-to-call a verified pharmacy. */
export function telHref(phone) {
  return `tel:${String(phone).replace(/[^+\d]/g, '')}`
}
