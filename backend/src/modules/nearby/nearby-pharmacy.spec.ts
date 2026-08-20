import { ConfigService } from '@nestjs/config';
import { NearbyPharmacyService } from './nearby-pharmacy.service';

/**
 * Internet pharmacy discovery and address geocoding.
 *
 * Both feed location data onto patient-facing screens, so both have to be
 * honest about what they actually know: no sample pharmacies when the provider
 * is not configured, and no city centroid passed off as a street address.
 */

function buildService(apiKey: string) {
  const config = { get: jest.fn().mockReturnValue(apiKey) } as unknown as ConfigService;
  return new NearbyPharmacyService(config);
}

const geocodeResponse = (result: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ status: 'OK', results: [result] }),
});

describe('findNearby without a configured provider', () => {
  it('reports that it is not configured and returns nothing', async () => {
    const service = buildService('');

    const result = await service.findNearby({ lat: 17.5561, lng: 78.4181, maxDistanceKm: 15 });

    // It used to answer with four hardcoded pharmacies — invented names,
    // addresses and phone numbers at fixed distances that never changed with
    // the caller's location — while claiming `configured: true`.
    expect(result.configured).toBe(false);
    expect(result.pharmacies).toEqual([]);
    expect(result.note).toMatch(/not configured/i);
  });

  it('invents no origin for the caller', async () => {
    const service = buildService('');

    const result = await service.findNearby({ maxDistanceKm: 5 });

    expect(result.origin).toBeNull();
  });

  it('geocodes nothing', async () => {
    const service = buildService('');

    await expect(service.geocode('214 W Kinzie St, Chicago')).resolves.toBeNull();
  });
});

describe('geocode precision', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const geocodeWith = async (result: Record<string, unknown>) => {
    global.fetch = jest.fn().mockResolvedValue(geocodeResponse(result)) as never;
    return buildService('test-key').geocode('anything');
  };

  it('accepts a rooftop match on a street address', async () => {
    const point = await geocodeWith({
      types: ['street_address'],
      geometry: { location: { lat: 41.889, lng: -87.6354 }, location_type: 'ROOFTOP' },
    });

    expect(point).toMatchObject({ lat: 41.889, lng: -87.6354, precise: true });
  });

  it('accepts an establishment match, which is how a named pharmacy resolves', async () => {
    const point = await geocodeWith({
      types: ['pharmacy', 'establishment', 'point_of_interest'],
      geometry: { location: { lat: 17.5878, lng: 78.4236 }, location_type: 'GEOMETRIC_CENTER' },
    });

    expect(point?.precise).toBe(true);
  });

  it('flags a city match as imprecise', async () => {
    const point = await geocodeWith({
      types: ['locality', 'political'],
      geometry: { location: { lat: 17.385, lng: 78.4867 }, location_type: 'APPROXIMATE' },
    });

    expect(point?.precise).toBe(false);
    expect(point?.granularity).toBe('APPROXIMATE:locality+political');
  });

  it('flags a postal-code match as imprecise', async () => {
    const point = await geocodeWith({
      types: ['postal_code'],
      geometry: { location: { lat: 17.5, lng: 78.4 }, location_type: 'APPROXIMATE' },
    });

    expect(point?.precise).toBe(false);
  });

  it('flags a country match as imprecise', async () => {
    const point = await geocodeWith({
      types: ['country', 'political'],
      geometry: { location: { lat: 20.5937, lng: 78.9629 }, location_type: 'APPROXIMATE' },
    });

    expect(point?.precise).toBe(false);
  });

  it('returns null when the address matches nothing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) }) as never;

    await expect(buildService('test-key').geocode('nowhere at all')).resolves.toBeNull();
  });

  it('returns null rather than throwing when the provider fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;

    await expect(buildService('test-key').geocode('214 W Kinzie St')).resolves.toBeNull();
  });
});
