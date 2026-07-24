bggb/**
 * ZoikoAvail™ availability model — governed presentation helpers.
 *
 * Per the ZoikoMeds build reference, availability is expressed as a
 * CONFIDENCE band (never exact stock counts). The engine weighs a signal's
 * freshness, pharmacy reliability, and verification to decide whether to
 * display, downgrade, suppress, or route it for confirmation.
 *
 * Confidence levels align with the shared <ConfidenceBadge> tones:
 *   high → good · moderate → info · low → warning · unknown → neutral
 */
export const AVAILABILITY = {
  high: { plain: 'Likely available now', order: 0 },
  moderate: { plain: 'May be limited — confirm first', order: 1 },
  low: { plain: 'Not recently confirmed', order: 2 },
  unknown: { plain: 'No recent signal', order: 3 },
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

/** Click-to-call a verified pharmacy. */
export function telHref(phone) {
  return `tel:${String(phone).replace(/[^+\d]/g, '')}`
}
