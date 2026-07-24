gbh// Client-side reverse geocoding (coordinates → human-readable place name).
//
// Uses BigDataCloud's keyless `reverse-geocode-client` endpoint so no API key
// or backend change is required. Returns a short label like "Bachupally,
// Telangana", or null on any failure so the caller can fall back to raw
// coordinates. Only latitude/longitude leave the browser — no PII.
//
// To keep geocoding server-side/governed instead, add a backend
// `GET /api/geocode/reverse` that uses the existing Google Geocoding key and
// point reverseGeocode() at it.
export async function reverseGeocode(lat, lng) {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    const res = await fetch(url)
    if (!res.ok) return null
    const d = await res.json()
    const parts = [d.locality || d.city, d.principalSubdivision].filter(Boolean)
    const label = parts.join(', ')
    return label || d.countryName || null
  } catch {
    return null
  }
}
