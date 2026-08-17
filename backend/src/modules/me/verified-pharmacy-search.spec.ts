import { MeService } from './me.service';

/**
 * Registered pharmacies in public medicine search.
 *
 * Rules under test:
 *  - only VERIFIED pharmacies appear (never PENDING/UNVERIFIED/REJECTED);
 *  - when a medicine is searched, only pharmacies stocking THAT medicine;
 *  - distance is measured from the caller, not a fixed origin;
 *  - results are ordered nearest-first;
 *  - the web/Google fallback is always returned alongside, untouched.
 */

// Gummadidala, Telangana — the caller in the reported case.
const CALLER = { lat: 17.6868, lng: 78.2306, resolvedFrom: 'coordinates' };

function pharmacy(over: Record<string, unknown> = {}) {
  return {
    id: 'ph_1',
    name: 'Zoiko Group Pharmacy',
    addressLine1: '12 Main Rd',
    addressLine2: null,
    city: 'Hyderabad',
    region: 'Telangana',
    postalCode: '500001',
    country: 'India',
    phone: '+914012345670',
    latitude: 17.6871,
    longitude: 78.2311,
    verificationStatus: 'VERIFIED',
    reliabilityScore: 0.95,
    isParticipating: true,
    availabilitySignals: [{ confidence: 'HIGH', computedAt: new Date() }],
    ...over,
  };
}

/** A MediBase entity as `search()` reads it. */
function medicine(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    canonicalName: 'Deriphyllin 150 mg',
    genericName: 'Etophylline + Theophylline',
    brandNames: [],
    manufacturer: 'Zydus',
    strength: '150 mg',
    dosageForm: 'Tablet',
    description: null,
    prescriptionCategory: 'PRESCRIPTION',
    isSuppressed: false,
    availabilitySignals: [],
    ...over,
  };
}

function buildService(pharmacies: Record<string, unknown>[], medicines: unknown[] = []) {
  const prisma = {
    searchHistory: { create: jest.fn() },
    medicineEntity: { findMany: jest.fn().mockResolvedValue(medicines) },
    pharmacy: { findMany: jest.fn().mockResolvedValue(pharmacies) },
  };
  const nearby = {
    resolveOrigin: jest.fn().mockResolvedValue(CALLER),
    findNearby: jest.fn().mockResolvedValue({ pharmacies: [], resolvedFrom: 'coordinates' }),
    geocode: jest.fn(),
  };
  const signal = { recordSearch: jest.fn(), recordZeroResult: jest.fn() };
  return {
    service: new MeService(prisma as never, nearby as never, signal as never),
    prisma,
    nearby,
  };
}

const search = (service: MeService, over: Record<string, unknown> = {}) =>
  service.search('user_1', {
    q: 'Deriphyllin',
    maxDistance: 15,
    lat: CALLER.lat,
    lng: CALLER.lng,
    ...over,
  } as never);

describe('verified pharmacies in medicine search', () => {
  it('asks only for VERIFIED pharmacies', async () => {
    const { service, prisma } = buildService([pharmacy()], [medicine('med_1')]);

    await search(service);

    const [args] = prisma.pharmacy.findMany.mock.calls[0];
    // Previously this was { in: ['VERIFIED', 'PENDING'] }, which surfaced
    // pharmacies that had not been verified.
    expect(args.where.verificationStatus).toBe('VERIFIED');
  });

  it('restricts them to pharmacies stocking the searched medicine', async () => {
    const { service, prisma } = buildService(
      [pharmacy()],
      [medicine('med_1'), medicine('med_2')],
    );

    await search(service);

    const [args] = prisma.pharmacy.findMany.mock.calls[0];
    expect(args.where.availabilitySignals).toEqual({
      some: { medicineId: { in: ['med_1', 'med_2'] } },
    });
    // And the confidence shown is that medicine's signal, not the pharmacy's
    // latest signal for anything else it happens to stock.
    expect(args.include.availabilitySignals.where).toEqual({
      medicineId: { in: ['med_1', 'med_2'] },
    });
  });

  it('does not filter by medicine when browsing without a search term', async () => {
    const { service, prisma } = buildService([pharmacy()], []);

    await search(service, { q: '' });

    const [args] = prisma.pharmacy.findMany.mock.calls[0];
    expect(args.where.availabilitySignals).toBeUndefined();
  });

  it('measures distance from the caller, not a fixed origin', async () => {
    const { service, nearby } = buildService([pharmacy()], [medicine('med_1')]);

    const result = await search(service);

    expect(nearby.resolveOrigin).toHaveBeenCalledWith({
      lat: CALLER.lat,
      lng: CALLER.lng,
      city: undefined,
    });
    // The pharmacy sits ~0.06 km from the caller. Measured from the old
    // hardcoded Hyderabad origin it would be ~20 km — outside the 15 km radius
    // and therefore invisible, which is what the bug report showed.
    expect(result.pharmacies).toHaveLength(1);
    expect(result.pharmacies[0].distance).toBeLessThan(1);
  });

  it('orders registered pharmacies nearest first', async () => {
    const { service } = buildService(
      [
        pharmacy({ id: 'far', name: 'Far Pharmacy', latitude: 17.75, longitude: 78.30 }),
        pharmacy({ id: 'near', name: 'Near Pharmacy', latitude: 17.6870, longitude: 78.2308 }),
        pharmacy({ id: 'mid', name: 'Mid Pharmacy', latitude: 17.72, longitude: 78.26 }),
      ],
      [medicine('med_1')],
    );

    const result = await search(service);

    expect(result.pharmacies.map((p) => p.name)).toEqual([
      'Near Pharmacy',
      'Mid Pharmacy',
      'Far Pharmacy',
    ]);
  });

  it('excludes a pharmacy outside the selected radius', async () => {
    const { service } = buildService(
      [pharmacy({ latitude: 28.6139, longitude: 77.209 })], // Delhi
      [medicine('med_1')],
    );

    const result = await search(service, { maxDistance: 15 });
    expect(result.pharmacies).toEqual([]);
  });

  it('excludes a pharmacy that has no coordinates rather than guessing', async () => {
    const { service } = buildService(
      [pharmacy({ latitude: null, longitude: null })],
      [medicine('med_1')],
    );

    const result = await search(service);
    expect(result.pharmacies).toEqual([]);
  });

  it('returns name, full address, distance, status and coordinates for Directions', async () => {
    const { service } = buildService([pharmacy()], [medicine('med_1')]);

    const [p] = (await search(service)).pharmacies;

    expect(p.name).toBe('Zoiko Group Pharmacy');
    expect(p.address).toBe('12 Main Rd, Hyderabad, Telangana, 500001');
    expect(typeof p.distance).toBe('number');
    expect(p.confidence).toBe('high');
    expect(p.verified).toBe(true);
    expect(p.latitude).toBe(17.6871);
    expect(p.longitude).toBe(78.2311);
  });

  it('still returns the web pharmacy fallback when no registered pharmacy is in range', async () => {
    const { service, nearby } = buildService(
      [pharmacy({ latitude: 28.6139, longitude: 77.209 })], // out of radius
      [medicine('med_1')],
    );
    nearby.findNearby.mockResolvedValue({
      pharmacies: [{ id: 'g1', name: 'Apollo Pharmacy Kukatpally' }],
      resolvedFrom: 'coordinates',
    });

    const result = await search(service);

    expect(result.pharmacies).toEqual([]);
    // The broader fallback is unaffected — it is geographic, not stock-based.
    expect(result.internetPharmacies.pharmacies).toHaveLength(1);
    expect(nearby.findNearby).toHaveBeenCalled();
  });
});
