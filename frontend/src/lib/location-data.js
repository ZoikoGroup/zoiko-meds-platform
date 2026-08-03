/**
 * Location API compatibility layer.
 * Delegates all validation and suggestion lookups to the live dynamic location API (location-api.js).
 */

import { validateLocationLive, getLiveLocationSuggestions } from './location-api'

/**
 * Async live location validation function replacing static allowlists.
 */
export async function validateLocation(input) {
  return await validateLocationLive(input)
}

/**
 * Async live location suggestions function.
 */
export async function getLocationSuggestions(query) {
  return await getLiveLocationSuggestions(query)
}
