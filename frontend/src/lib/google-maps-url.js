/**
 * Pull a coordinate pair out of a Google Maps link.
 *
 * Pharmacies are invisible to patient search until they have coordinates, and
 * asking an operator for latitude and longitude is asking them for something
 * they do not have. A Maps link is something they can get in two taps, and it
 * already contains the numbers.
 *
 * Everything here is pure string work — no network, no API key. Short links
 * (maps.app.goo.gl, goo.gl/maps) carry no coordinates in the URL itself, so
 * they are detected and reported separately; only the server can follow those.
 */

/** Latitudes run −90..90, longitudes −180..180. */
export function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Atlantic. It is far more often a parse artefact than a
    // pharmacy, so treat it as a failure rather than silently storing it.
    !(lat === 0 && lng === 0)
  )
}

/** Round to ~1 cm. Longer tails are noise and make stored values hard to read. */
const trim = (n) => Math.round(n * 1e7) / 1e7

/**
 * Short links hide their coordinates behind a redirect, which the browser
 * cannot follow cross-origin. Recognising them lets the UI say "resolving…"
 * instead of "invalid link".
 */
export function isShortMapsLink(url) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test((url ?? '').trim())
}

/**
 * The patterns Google actually produces, most specific first.
 *
 * `!3d<lat>!4d<lng>` wins over `@<lat>,<lng>` deliberately: on a place URL the
 * `@` pair is the map's viewport centre, while 3d/4d is the pin itself. They
 * differ by tens of metres, and the pin is the pharmacy.
 */
const PATTERNS = [
  // .../data=...!3d17.5561!4d78.4181  — the placed pin
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  // ?q=17.5561,78.4181  |  ?query=  |  ?ll=  |  ?destination=  |  ?center=
  /[?&](?:q|query|ll|destination|center|daddr|sll)=(-?\d+(?:\.\d+)?)%2C\s*(-?\d+(?:\.\d+)?)/i,
  /[?&](?:q|query|ll|destination|center|daddr|sll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  // /@17.5561,78.4181,17z  — the viewport centre
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  // /place/17.5561,78.4181  and  /dir//17.5561,78.4181
  /\/(?:place|dir)\/(?:[^/]*\/)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
]

/** A bare "17.5561, 78.4181" pasted straight from the Maps place card. */
const BARE_PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

/**
 * Parse `input` into `{ latitude, longitude }`.
 *
 * Returns `null` when nothing usable is present, so a caller can distinguish
 * "could not read this" from a coordinate at the equator.
 */
export function parseGoogleMapsUrl(input) {
  const text = (input ?? '').trim()
  if (!text) return null

  const bare = text.match(BARE_PAIR)
  if (bare) {
    const lat = Number(bare[1])
    const lng = Number(bare[2])
    return isValidCoordinate(lat, lng) ? { latitude: trim(lat), longitude: trim(lng) } : null
  }

  // A URL-encoded link (?q=17.55%2C78.41) has to be decoded before matching,
  // but a malformed escape must not throw the whole parse away.
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    /* keep the raw text */
  }

  for (const pattern of PATTERNS) {
    for (const candidate of [decoded, text]) {
      const m = candidate.match(pattern)
      if (!m) continue
      const lat = Number(m[1])
      const lng = Number(m[2])
      if (isValidCoordinate(lat, lng)) {
        return { latitude: trim(lat), longitude: trim(lng) }
      }
    }
  }
  return null
}

/** Coordinates formatted for display, e.g. "17.556100, 78.418100". */
export function formatCoordinates(lat, lng) {
  if (!isValidCoordinate(Number(lat), Number(lng))) return null
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`
}

/** A Maps link back to a stored pair, so the operator can check the pin. */
export function mapsLinkFor(lat, lng) {
  if (!isValidCoordinate(Number(lat), Number(lng))) return null
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
