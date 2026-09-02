// The patient's chosen location, as the whole app stores it.
//
// One key, written by the location modal, the home page, the scan panel and the
// search screen alike, so every surface that asks "near me" is asking about the
// same place. It holds a human label — a city, an area, a PIN code, or a
// "17.5561, 78.4181" pair when the browser's geolocation was used — and the API
// geocodes whatever it is given.
export const USER_LOCATION_KEY = 'zoiko-user-loc'

/** Default search radius in km. Matches the backend's own default. */
export const DEFAULT_RADIUS_KM = 15

/** The stored label, or '' when the patient has not set one. */
export function readUserLocation() {
  try {
    return localStorage.getItem(USER_LOCATION_KEY) || ''
  } catch {
    // Private mode, or storage disabled. No location is a valid state.
    return ''
  }
}

/**
 * Location query params for an API call that ranks by distance.
 *
 * A "lat, lng" label is passed through as coordinates rather than sent back for
 * geocoding — it came from the browser's own GPS, so re-resolving it through a
 * place-name lookup could only make it less precise. Returns `{}` when no
 * location is set; the API then answers without distances instead of measuring
 * from somewhere the patient has never been.
 */
export function userLocationParams(maxDistanceKm = DEFAULT_RADIUS_KM) {
  const raw = readUserLocation().trim()
  if (!raw) return {}

  const coords = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (coords) {
    return { lat: Number(coords[1]), lng: Number(coords[2]), maxDistance: maxDistanceKm }
  }
  return { city: raw, maxDistance: maxDistanceKm }
}

/**
 * A distance for display, or '—' when there is none.
 *
 * `approximate` marks a pharmacy the platform placed by geocoding an area — a
 * city or a PIN code — rather than its street address. The pin is the middle of
 * that area, so the pharmacy is genuinely around there and worth showing, but
 * "4.2 km" claims a precision nobody has. Those read as "~4 km": near enough to
 * act on, honest about not being surveyed.
 */
export function formatDistanceKm(distance, approximate = false) {
  if (distance == null) return '—'
  if (approximate) return `~${Math.round(distance)} km`
  return `${distance.toFixed(1)} km`
}
