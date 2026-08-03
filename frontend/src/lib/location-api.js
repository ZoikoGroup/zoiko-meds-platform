/**
 * Live Dynamic Location API & Geocoding Service for ZoikoMeds Platform.
 * Connects to live geocoding endpoints (OpenStreetMap Nominatim + India Post API)
 * to perform real-time verification and typeahead search without static allowlists.
 */

const PINCODE_REGEX = /^[1-9][0-9]{5}$/
const SEARCH_CACHE = new Map()

/**
 * Perform live location validation and lookup against dynamic APIs.
 * Returns { isValid: boolean, formatted?: string, suggestions?: Array, error?: boolean, message?: string }
 */
export async function validateLocationLive(query) {
  if (!query || !query.trim()) {
    return {
      isValid: false,
      message: 'Please enter a city, area, or 6-digit PIN code.',
    }
  }

  const trimmed = query.trim()

  // Check cache first to prevent redundant network requests
  if (SEARCH_CACHE.has(trimmed.toLowerCase())) {
    return SEARCH_CACHE.get(trimmed.toLowerCase())
  }

  // Handle pre-formatted location strings containing (PIN XXXXXX)
  const pinInStringMatch = trimmed.match(/\(PIN\s*([1-9][0-9]{5})\)/i)
  if (pinInStringMatch) {
    const result = {
      isValid: true,
      formatted: trimmed,
      suggestions: [{ name: trimmed, pin: pinInStringMatch[1] }],
    }
    SEARCH_CACHE.set(trimmed.toLowerCase(), result)
    return result
  }

  try {
    // 1. PIN Code Pre-filter (India Post API)
    if (PINCODE_REGEX.test(trimmed)) {
      const pinRes = await fetch(`https://api.postalpincode.in/pincode/${trimmed}`, {
        headers: { Accept: 'application/json' },
      })

      if (!pinRes.ok) {
        throw new Error('PIN code service unavailable')
      }

      const data = await pinRes.json()
      if (Array.isArray(data) && data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
        const po = data[0].PostOffice[0]
        const formatted = `${po.Name}, ${po.District}, ${po.State} (PIN ${trimmed})`
        const suggestions = data[0].PostOffice.slice(0, 5).map((office) => ({
          name: `${office.Name}, ${office.District}, ${office.State} (PIN ${trimmed})`,
          pin: trimmed,
          city: office.District,
        }))

        const result = {
          isValid: true,
          formatted,
          suggestions,
        }
        SEARCH_CACHE.set(trimmed.toLowerCase(), result)
        return result
      } else {
        const result = {
          isValid: false,
          message: `PIN code "${trimmed}" was not found in postal records.`,
        }
        SEARCH_CACHE.set(trimmed.toLowerCase(), result)
        return result
      }
    }

    // 2. OpenStreetMap / Nominatim Live Geocoding API for Cities, Areas, and Towns
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&addressdetails=1&limit=6`
    const geoRes = await fetch(geoUrl, {
      headers: {
        'Accept-Language': 'en',
      },
    })

    if (!geoRes.ok) {
      throw new Error('Geocoding service returned status ' + geoRes.status)
    }

    const geoData = await geoRes.json()

    if (Array.isArray(geoData) && geoData.length > 0) {
      const suggestions = geoData.map((place) => {
        const addr = place.address || {}
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.county || ''
        const state = addr.state || ''
        const country = addr.country || ''
        
        // Build concise, clean display label
        const parts = [place.name || addr.suburb || addr.city, city, state, country].filter(
          (item, idx, arr) => item && arr.indexOf(item) === idx
        )
        const name = parts.join(', ')

        return {
          name,
          rawDisplayName: place.display_name,
          lat: parseFloat(place.lat),
          lng: parseFloat(place.lon),
          city: city || name,
        }
      })

      const topMatch = suggestions[0].name
      const result = {
        isValid: true,
        formatted: topMatch,
        suggestions,
      }
      SEARCH_CACHE.set(trimmed.toLowerCase(), result)
      return result
    } else {
      const result = {
        isValid: false,
        message: `No matching city, area, or PIN code found for "${trimmed}".`,
      }
      SEARCH_CACHE.set(trimmed.toLowerCase(), result)
      return result
    }
  } catch (err) {
    // Network or API failure state
    return {
      isValid: false,
      error: true,
      message: 'Network connection issue while verifying location. Please check your network and retry.',
    }
  }
}

/**
 * Get dynamic location suggestions with debouncing support.
 */
export async function getLiveLocationSuggestions(query) {
  if (!query || !query.trim()) {
    return []
  }
  const result = await validateLocationLive(query)
  return result.suggestions || []
}
