import { ConflictException } from '@nestjs/common';
import { LocationPrecision, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { PharmacyAdminService } from '../admin/pharmacy/pharmacy-admin.service';
import {
  assertLocationIsFree,
  findPharmacyAtSameLocation,
  findPharmacyByLicense,
  isSameStreetAddress,
  normalizeAddressComponent,
  normalizeLicenseNumber,
  normalizePharmacyName,
  withBranchLock,
} from './location-identity';

describe('Pharmacy Duplicate Detection Rules & Locality Registration', () => {
  const GANDIMAISAMMA_CENTROID = {
    lat: 17.5878,
    lng: 78.4236,
    precise: false,
    granularity: 'APPROXIMATE:locality+political',
  };

  function buildAdminService(opts: {
    existingPharmacies?: Record<string, unknown>[];
    geocode?: unknown;
  } = {}) {
    const records: any[] = [...(opts.existingPharmacies ?? [])];
    const created: any[] = [];

    const tx = {
      pharmacy: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `ph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            verificationStatus: VerificationStatus.PENDING,
            commercialClassification: 'DIRECTORY_UNCLAIMED',
            reliabilityScore: 1,
            isParticipating: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          records.push(row);
          created.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          records.find((r) => r.id === where.id) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const idx = records.findIndex((r) => r.id === where.id);
          if (idx >= 0) {
            records[idx] = { ...records[idx], ...data, updatedAt: new Date() };
            return records[idx];
          }
          return null;
        }),
      },
      verificationRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jurisdiction: {
        upsert: jest.fn().mockResolvedValue({ id: 'jur-in', code: 'IN', name: 'India' }),
      },
    };

    const prisma = {
      pharmacy: {
        findMany: jest.fn(async ({ where }: any) => {
          let list = [...records];
          if (where?.id?.not) {
            list = list.filter((r) => r.id !== where.id.not);
          }
          if (where?.licenseNumber?.not !== undefined) {
            list = list.filter((r) => r.licenseNumber != null);
          }
          if (where?.latitude?.gte != null && where?.latitude?.lte != null) {
            list = list.filter(
              (r) =>
                r.latitude != null &&
                r.latitude >= where.latitude.gte &&
                r.latitude <= where.latitude.lte,
            );
          }
          if (where?.longitude?.gte != null && where?.longitude?.lte != null) {
            list = list.filter(
              (r) =>
                r.longitude != null &&
                r.longitude >= where.longitude.gte &&
                r.longitude <= where.longitude.lte,
            );
          }
          return list;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          records.find((r) => r.id === where.id) ?? null,
        ),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as unknown as PrismaService;

    const nearby = {
      geocode: jest.fn().mockResolvedValue(opts.geocode ?? GANDIMAISAMMA_CENTROID),
    } as unknown as NearbyPharmacyService;

    const audit = { write: jest.fn() } as unknown as AuditWriter;
    const service = new PharmacyAdminService(prisma, audit, nearby);

    return { service, prisma, tx, nearby, records, created };
  }

  // 1. Two independent pharmacies in Gandimaisamma with different licences can both register.
  it('1. allows two independent pharmacies in Gandimaisamma with different licences to register', async () => {
    const existingVenkatesh = {
      id: 'ph_venkatesh',
      name: 'Venkatesh pharmacy',
      licenseNumber: 'LIC-HYD-VENK-01',
      addressLine1: 'Venkatesh Nagar',
      city: 'Gandimaisamma',
      region: 'Telangana',
      postalCode: '500043',
      country: 'India',
      latitude: GANDIMAISAMMA_CENTROID.lat,
      longitude: GANDIMAISAMMA_CENTROID.lng,
      locationPrecision: LocationPrecision.APPROXIMATE,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existingVenkatesh],
      geocode: GANDIMAISAMMA_CENTROID,
    });

    const waytoPharma = await service.create('admin_1', {
      name: 'WaytoPharma',
      licenseNumber: 'LC-947474',
      addressLine1: 'WaytoHealth',
      city: 'Gandimaisamma',
      region: 'Telangana',
      postalCode: '500043',
      country: 'India',
      phone: '9864785478',
    });

    expect(waytoPharma).toBeDefined();
    expect(waytoPharma.name).toBe('WaytoPharma');
    expect(waytoPharma.licenseNumber).toBe('LC-947474');
  });

  // 2. Two pharmacies in the same postal code can both register.
  it('2. allows two pharmacies in the same postal code to register', async () => {
    const existing = {
      id: 'ph_1',
      name: 'Care Point',
      licenseNumber: 'LIC-60654-1',
      addressLine1: '100 N LaSalle',
      city: 'Chicago',
      postalCode: '60654',
      country: 'United States',
      latitude: 41.88,
      longitude: -87.63,
      locationPrecision: LocationPrecision.APPROXIMATE,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: { lat: 41.88, lng: -87.63, precise: false, granularity: 'APPROXIMATE:postal_code' },
    });

    const second = await service.create('admin_1', {
      name: 'Metro Pharmacy',
      licenseNumber: 'LIC-60654-2',
      addressLine1: '200 N Clark',
      city: 'Chicago',
      postalCode: '60654',
      country: 'United States',
    });

    expect(second).toBeDefined();
    expect(second.name).toBe('Metro Pharmacy');
  });

  // 3. Two pharmacies with distinct addresses but identical approximate geocoded coordinates can register.
  it('3. allows two pharmacies with distinct addresses but identical approximate coordinates to register', async () => {
    const existing = {
      id: 'ph_1',
      name: 'North Meds',
      licenseNumber: 'LIC-111',
      addressLine1: 'North Block',
      city: 'Hyderabad',
      latitude: 17.58,
      longitude: 78.42,
      locationPrecision: LocationPrecision.APPROXIMATE,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: { lat: 17.58, lng: 78.42, precise: false, granularity: 'APPROXIMATE:locality' },
    });

    const candidate = await service.create('admin_1', {
      name: 'South Meds',
      licenseNumber: 'LIC-222',
      addressLine1: 'South Block',
      city: 'Hyderabad',
      country: 'India',
    });

    expect(candidate.name).toBe('South Meds');
  });

  // 4. Two legitimate pharmacies sharing a building address can be registered through the approved validation path.
  it('4. allows two legitimate pharmacies sharing a building address to register with shared address confirmation', async () => {
    const existing = {
      id: 'ph_kinzie',
      name: 'Kinzie Chemists',
      licenseNumber: 'LC-100',
      addressLine1: '214 W Kinzie St',
      city: 'Chicago',
      country: 'United States',
      latitude: 41.889,
      longitude: -87.635,
      locationPrecision: LocationPrecision.EXACT,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: { lat: 41.889, lng: -87.635, precise: true, granularity: 'ROOFTOP' },
    });

    // Without confirmation, potential duplicate at shared address is flagged
    await expect(
      service.create('admin_1', {
        name: 'HealthBridge Pharmacy',
        licenseNumber: 'LC-200',
        addressLine1: '214 W Kinzie St',
        city: 'Chicago',
        country: 'United States',
      }),
    ).rejects.toThrow(/already registered at this street address/i);

    // With approved validation path (confirmSharedAddress: true), registration succeeds
    const approved = await service.create('admin_1', {
      name: 'HealthBridge Pharmacy',
      licenseNumber: 'LC-200',
      addressLine1: '214 W Kinzie St',
      city: 'Chicago',
      country: 'United States',
      confirmSharedAddress: true,
    });

    expect(approved).toBeDefined();
    expect(approved.name).toBe('HealthBridge Pharmacy');
  });

  // 5. Re-registering the same licence and branch is rejected appropriately.
  it('5. rejects re-registering the same licence and branch', async () => {
    const existing = {
      id: 'ph_apollo_branch',
      name: 'Apollo Pharmacy',
      licenseNumber: 'LIC-HYD-01',
      addressLine1: 'Kompally Main Rd',
      city: 'Hyderabad',
      country: 'India',
      latitude: 17.548,
      longitude: 78.418,
      locationPrecision: LocationPrecision.EXACT,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: { lat: 17.548, lng: 78.418, precise: true, granularity: 'ROOFTOP' },
    });

    await expect(
      service.create('admin_1', {
        name: 'Apollo Pharmacy',
        licenseNumber: 'LIC-HYD-01',
        addressLine1: 'Kompally Main Rd',
        city: 'Hyderabad',
        country: 'India',
        confirmSharedAddress: true, // Even with confirmation, same branch is rejected
      }),
    ).rejects.toThrow(/already registered with licence LIC-HYD-01 at this branch/i);
  });

  // 6. A legitimate second branch of the same pharmacy business can register.
  it('6. allows a legitimate second branch of the same pharmacy business to register at a separate address', async () => {
    const existingBranch1 = {
      id: 'ph_apollo_b1',
      name: 'Apollo Pharmacy',
      licenseNumber: 'LIC-HYD-01',
      addressLine1: 'Kompally Main Rd',
      city: 'Hyderabad',
      country: 'India',
      latitude: 17.548,
      longitude: 78.418,
      locationPrecision: LocationPrecision.EXACT,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existingBranch1],
      geocode: { lat: 17.5375, lng: 78.4181, precise: true, granularity: 'ROOFTOP' },
    });

    const branch2 = await service.create('admin_1', {
      name: 'Apollo Pharmacy',
      licenseNumber: 'LIC-HYD-01',
      addressLine1: 'Bowrampet Main Rd',
      city: 'Hyderabad',
      country: 'India',
    });

    expect(branch2).toBeDefined();
    expect(branch2.name).toBe('Apollo Pharmacy');
    expect(branch2.addressLine1).toBe('Bowrampet Main Rd');
  });

  // 7. Case, whitespace, and punctuation normalization does not cause false duplicate matches.
  it('7. ensures normalization compares accurately without false positives', async () => {
    // Normalization checks
    expect(normalizeLicenseNumber('  lic-hyd--01  ')).toBe('LICHYD01');
    expect(normalizeLicenseNumber('LIC/HYD/01')).toBe('LICHYD01');
    expect(normalizeLicenseNumber('LIC-1')).not.toBe(normalizeLicenseNumber('LIC-10'));
    expect(normalizeLicenseNumber('LIC-A')).not.toBe(normalizeLicenseNumber('LIC-B'));

    expect(normalizePharmacyName('Apollo   Pharmacy,  Inc.')).toBe('apollo pharmacy inc');
    expect(normalizePharmacyName('WaytoPharma')).toBe('waytopharma');

    expect(isSameStreetAddress(
      { addressLine1: '214 W. Kinzie St.', city: 'Chicago' },
      { addressLine1: '214 W Kinzie St', city: 'Chicago' },
    )).toBe(true);

    expect(isSameStreetAddress(
      { addressLine1: 'Suite 101, 100 Main St', city: 'Dallas' },
      { addressLine1: 'Suite 102, 100 Main St', city: 'Dallas' },
    )).toBe(false);
  });

  // 8. Missing or approximate coordinates do not cause false rejection.
  it('8. ensures missing or approximate coordinates do not cause false rejection', async () => {
    const existing = {
      id: 'ph_existing',
      name: 'Existing Meds',
      licenseNumber: 'LIC-EXISTING',
      addressLine1: 'Sector 1',
      city: 'Noida',
      latitude: null,
      longitude: null,
      locationPrecision: null,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: null, // geocoding failed / null
    });

    const candidate = await service.create('admin_1', {
      name: 'New Meds',
      licenseNumber: 'LIC-NEW',
      addressLine1: 'Sector 2',
      city: 'Noida',
      country: 'India',
    });

    expect(candidate).toBeDefined();
    expect(candidate.name).toBe('New Meds');
  });

  // 9. Concurrent registration attempts cannot create duplicate records for the same branch.
  it('9. prevents concurrent registration attempts from creating duplicate records for the same branch', async () => {
    const { service, created } = buildAdminService({
      existingPharmacies: [],
      geocode: { lat: 17.548, lng: 78.418, precise: true, granularity: 'ROOFTOP' },
    });

    const dto = {
      name: 'Apollo Pharmacy',
      licenseNumber: 'LIC-CONCUR-01',
      addressLine1: '123 Main St',
      city: 'Hyderabad',
      country: 'India',
    };

    const [res1, res2] = await Promise.allSettled([
      service.create('admin_1', { ...dto }),
      service.create('admin_1', { ...dto }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(created.length).toBe(1);
  });

  // 10. Existing duplicate-detection behavior remains correct for genuine duplicates.
  it('10. preserves duplicate-detection behavior for genuine duplicates', async () => {
    const existing = {
      id: 'ph_shop',
      name: 'Standard Pharmacy',
      licenseNumber: 'LIC-STD-99',
      addressLine1: 'Shop 5, Market Square',
      city: 'London',
      country: 'United Kingdom',
      latitude: 51.5074,
      longitude: -0.1278,
      locationPrecision: LocationPrecision.EXACT,
    };

    const { service } = buildAdminService({
      existingPharmacies: [existing],
      geocode: { lat: 51.5074, lng: -0.1278, precise: true, granularity: 'ROOFTOP' },
    });

    // Re-registering the same shopfront with the same licence
    await expect(
      service.create('admin_1', {
        name: 'Standard Pharmacy',
        licenseNumber: 'LIC-STD-99',
        addressLine1: 'Shop 5, Market Square',
        city: 'London',
        country: 'United Kingdom',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

