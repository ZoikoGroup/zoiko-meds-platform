import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The medicine search page must never show a pharmacy the backend did not
 * return. This file used to carry a seven-entry demo dataset that was served
 * whenever the API failed or returned nothing — a patient could be sent to a
 * pharmacy that does not exist. These tests pin the honest behaviour.
 */

const searchMedicines = vi.fn()
vi.mock('../user-api', () => ({ searchMedicines: (...a) => searchMedicines(...a) }))

const { searchNearbyAvailability } = await import('../nearby-availability')

/** One pharmacy exactly as /me/search returns it. */
const apiPharmacy = (over = {}) => ({
  id: 'ph_1',
  name: 'Zoiko Group Pharmacy',
  address: '12 Main Rd, Hyderabad, Telangana, 500001',
  distance: 1.4,
  phone: '+914012345670',
  latitude: 17.6871,
  longitude: 78.2311,
  confidence: 'high',
  updated: '10 min ago',
  ...over,
})

beforeEach(() => {
  searchMedicines.mockReset()
})

describe('registered pharmacies come only from the API', () => {
  it('returns nothing when the API returns no pharmacies', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [], medicines: [] })

    const result = await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })

    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.availableCount).toBe(0)
  })

  it('returns nothing — not demo pharmacies — when the API fails', async () => {
    searchMedicines.mockRejectedValue(new Error('401 Unauthorized'))

    const result = await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })

    expect(result.items).toEqual([])
    expect(result.source).toBe('live')
  })

  it('never reports a source other than live', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [apiPharmacy()], medicines: [] })

    const result = await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })

    expect(result.source).toBe('live')
  })

  it('carries every card field straight off the API row', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [apiPharmacy()], medicines: [] })

    const [p] = (await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })).items

    expect(p).toMatchObject({
      id: 'ph_1',
      name: 'Zoiko Group Pharmacy',
      address: '12 Main Rd, Hyderabad, Telangana, 500001',
      distance: 1.4,
      phone: '+914012345670',
      latitude: 17.6871,
      longitude: 78.2311,
      confidence: 'high',
      status: 'available',
      updated: '10 min ago',
    })
  })

  it('leaves absent fields absent instead of substituting a plausible value', async () => {
    searchMedicines.mockResolvedValue({
      pharmacies: [apiPharmacy({ phone: '', latitude: null, longitude: null, confidence: 'unknown' })],
      medicines: [],
    })

    const [p] = (await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })).items

    expect(p.phone).toBe('')
    expect(p.latitude).toBeNull()
    expect(p.longitude).toBeNull()
    expect(p.confidence).toBe('unknown')
  })

  it('does not claim a pharmacy is open 24/7 — no record holds opening hours', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [apiPharmacy({ open24h: true })], medicines: [] })

    const [p] = (await searchNearbyAvailability({ q: 'Deriphyllin', maxDistanceKm: 15 })).items

    expect(p.is24x7).toBeUndefined()
  })

  it('passes the caller location and radius through to the API', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [], medicines: [] })

    await searchNearbyAvailability({
      q: 'Deriphyllin', maxDistanceKm: 25, lat: 17.6868, lng: 78.2306, city: 'Hyderabad',
    })

    expect(searchMedicines).toHaveBeenCalledWith({
      q: 'Deriphyllin', maxDistance: 25, lat: 17.6868, lng: 78.2306, city: 'Hyderabad',
    })
  })

  it('orders results by status, then by distance', async () => {
    searchMedicines.mockResolvedValue({
      pharmacies: [
        apiPharmacy({ id: 'c', name: 'Unconfirmed near', confidence: 'low', distance: 0.5 }),
        apiPharmacy({ id: 'b', name: 'Available far', confidence: 'high', distance: 9 }),
        apiPharmacy({ id: 'a', name: 'Available near', confidence: 'high', distance: 2 }),
      ],
      medicines: [],
    })

    const { items, availableCount } = await searchNearbyAvailability({ q: 'x', maxDistanceKm: 15 })

    expect(items.map((p) => p.name)).toEqual(['Available near', 'Available far', 'Unconfirmed near'])
    expect(availableCount).toBe(2)
  })
})

describe('medicine identity', () => {
  it('uses the MediBase entry when the catalog holds the medicine', async () => {
    searchMedicines.mockResolvedValue({
      pharmacies: [],
      medicines: [{ id: 'med_1', name: 'Deriphyllin 150 mg', generic: 'Etophylline', manufacturer: 'Zydus', strength: '150 mg', form: 'Tablet', rx: true }],
    })

    const { identity } = await searchNearbyAvailability({ q: 'deriphyllin', maxDistanceKm: 15 })

    expect(identity).toMatchObject({ id: 'med_1', name: 'Deriphyllin 150 mg', manufacturer: 'Zydus' })
  })

  it('falls back to the search term with blank clinical fields off-catalog', async () => {
    searchMedicines.mockResolvedValue({ pharmacies: [], medicines: [] })

    const { identity } = await searchNearbyAvailability({ q: 'volini gel', maxDistanceKm: 15 })

    // The name is the patient's own words; nothing clinical is invented, and a
    // null id tells the UI there is no governed entry behind it.
    expect(identity).toEqual({
      id: null, name: 'Volini Gel', generic: '', manufacturer: '', strength: '', form: '', rx: null,
    })
  })
})
