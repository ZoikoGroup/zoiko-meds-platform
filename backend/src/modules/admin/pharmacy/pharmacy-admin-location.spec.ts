import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { PharmacyAdminService } from './pharmacy-admin.service';

/**
 * Admin pharmacy registration — the pharmacy's real position, or none.
 *
 * Coordinates used to come from geocoding [city, country], which returns the
 * city centroid: every pharmacy registered in Hyderabad landed on one point, at
 * one distance from every patient, indistinguishable on the map. The street
 * address is what identifies the premises, and an area-level match is refused
 * rather than stored — "not located yet" is true, a city centre is not.
 */

const DTO = {
  name: 'HealthBridge Pharmacy',
  licenseNumber: 'LC-109283',
  addressLine1: '214 W Kinzie St',
  city: 'Chicago',
  region: 'Illinois',
  postalCode: '60654',
  country: 'United States',
  phone: '+1 312 555 0142',
};

const PRECISE = {
  lat: 41.889,
  lng: -87.6354,
  precise: true,
  granularity: 'ROOFTOP:street_address',
};

const CITY_CENTROID = {
  lat: 41.8781136,
  lng: -87.6297982,
  precise: false,
  granularity: 'APPROXIMATE:locality+political',
};

function buildService(
  state: { geocode?: unknown; neighbours?: Record<string, unknown>[] } = {},
) {
  // `geocode: null` means "the address matched nothing" — distinct from the key
  // being absent, so it cannot fall through to the default.
  const geocodeResult = 'geocode' in state ? state.geocode : PRECISE;
  const tx = {
    pharmacy: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'ph_new',
        verificationStatus: 'PENDING',
        commercialClassification: 'DIRECTORY_UNCLAIMED',
        reliabilityScore: 1,
        isParticipating: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    verificationRequest: { updateMany: jest.fn() },
    jurisdiction: {
      upsert: jest.fn().mockResolvedValue({ id: 'jur-us', code: 'US', name: 'United States' }),
    },
  };

  const prisma: any = {
    pharmacy: { findMany: jest.fn().mockResolvedValue(state.neighbours ?? []) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const nearby = {
    geocode: jest.fn().mockResolvedValue(geocodeResult),
  };

  const service = new PharmacyAdminService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    nearby as unknown as NearbyPharmacyService,
  );
  return { service, prisma, nearby, tx };
}

describe('PharmacyAdminService.create — locating the pharmacy', () => {
  it('geocodes the whole street address, not the city', async () => {
    const { service, nearby } = buildService();

    await service.create('admin_1', DTO as never);

    expect(nearby.geocode).toHaveBeenCalledWith(
      '214 W Kinzie St, Chicago, Illinois, 60654, United States',
    );
  });

  it('stores the coordinates the address resolved to', async () => {
    const { service, tx } = buildService();

    await service.create('admin_1', DTO as never);

    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(PRECISE.lat);
    expect(data.longitude).toBe(PRECISE.lng);
  });

  it('refuses to store a city centroid as a pharmacy location', async () => {
    const { service, tx } = buildService({ geocode: CITY_CENTROID });

    await service.create('admin_1', DTO as never);

    const { data } = tx.pharmacy.create.mock.calls[0][0];
    // No coordinates is honest — the record is saved and shows as not located
    // yet, rather than appearing at a point it has never been.
    expect(data.latitude).toBeNull();
    expect(data.longitude).toBeNull();
  });

  it('prefers coordinates the admin supplied over any geocoding', async () => {
    const { service, nearby, tx } = buildService();

    await service.create('admin_1', { ...DTO, latitude: 41.9, longitude: -87.63 } as never);

    expect(nearby.geocode).not.toHaveBeenCalled();
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(41.9);
  });

  it('saves the branch address and contact number it was given', async () => {
    const { service, tx } = buildService();

    await service.create('admin_1', DTO as never);

    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.addressLine1).toBe('214 W Kinzie St');
    expect(data.region).toBe('Illinois');
    expect(data.postalCode).toBe('60654');
    expect(data.phone).toBe('+1 312 555 0142');
  });
});

describe('PharmacyAdminService.create — duplicate locations', () => {
  it('refuses a pharmacy at a location another already occupies', async () => {
    const { service, tx } = buildService({
      neighbours: [
        {
          id: 'ph_existing',
          name: 'Kinzie Chemists',
          addressLine1: '214 W Kinzie St',
          city: 'Chicago',
          latitude: PRECISE.lat,
          longitude: PRECISE.lng,
        },
      ],
    });

    await expect(service.create('admin_1', DTO as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.pharmacy.create).not.toHaveBeenCalled();
  });

  it('does not probe when the address could not be located at all', async () => {
    const { service, prisma, tx } = buildService({ geocode: null });

    await service.create('admin_1', DTO as never);

    // Nothing to compare — the record is saved unlocated.
    expect(prisma.pharmacy.findMany).not.toHaveBeenCalled();
    expect(tx.pharmacy.create).toHaveBeenCalled();
  });
});
