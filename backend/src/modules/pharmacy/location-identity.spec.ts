import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SAME_LOCATION_RADIUS_M,
  assertLocationIsFree,
  distanceMetres,
  findPharmacyAtSameLocation,
} from './location-identity';

/**
 * One physical pharmacy, one record.
 *
 * The duplicate that matters is the same shop registered twice, which patients
 * see as two cards for one place — each holding its own availability signals, so
 * one can say a medicine is stocked while the other says it is not.
 */

const ZOIKO = {
  id: 'ph_zoiko',
  name: 'Zoiko Meds Pharmacy',
  addressLine1: 'Gandimaisamma',
  city: 'Hyderabad',
  latitude: 17.5878172,
  longitude: 78.4236196,
};

function buildPrisma(rows: Record<string, unknown>[]) {
  return {
    pharmacy: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService;
}

/** Offset a coordinate north by a given number of metres. */
const northOf = (lat: number, metres: number) => lat + metres / 111_320;

describe('findPharmacyAtSameLocation', () => {
  it('finds the pharmacy already registered at the same point', async () => {
    const prisma = buildPrisma([ZOIKO]);

    const found = await findPharmacyAtSameLocation(prisma, {
      latitude: ZOIKO.latitude,
      longitude: ZOIKO.longitude,
    });

    expect(found?.id).toBe('ph_zoiko');
  });

  it('treats a reading a few metres away as the same premises', async () => {
    const prisma = buildPrisma([ZOIKO]);

    // Two Google Maps readings of one shopfront differ by metres; the duplicate
    // is the same shop regardless.
    const found = await findPharmacyAtSameLocation(prisma, {
      latitude: northOf(ZOIKO.latitude, 20),
      longitude: ZOIKO.longitude,
    });

    expect(found?.id).toBe('ph_zoiko');
  });

  it('leaves a genuinely separate pharmacy down the road alone', async () => {
    const prisma = buildPrisma([ZOIKO]);

    const found = await findPharmacyAtSameLocation(prisma, {
      latitude: northOf(ZOIKO.latitude, 400),
      longitude: ZOIKO.longitude,
    });

    expect(found).toBeNull();
  });

  it('rejects the corners of the bounding box, which are further than the radius', async () => {
    // A box query alone would match this point: it is inside the square but
    // outside the circle. Only the great-circle distance can tell.
    const corner = {
      ...ZOIKO,
      latitude: northOf(ZOIKO.latitude, SAME_LOCATION_RADIUS_M - 1),
      longitude: ZOIKO.longitude + (SAME_LOCATION_RADIUS_M - 1) / 111_320,
    };
    const prisma = buildPrisma([corner]);

    const found = await findPharmacyAtSameLocation(prisma, {
      latitude: ZOIKO.latitude,
      longitude: ZOIKO.longitude,
    });

    expect(found).toBeNull();
  });

  it('never matches a pharmacy against itself', async () => {
    const prisma = buildPrisma([]);

    await findPharmacyAtSameLocation(prisma, {
      latitude: ZOIKO.latitude,
      longitude: ZOIKO.longitude,
      excludeId: 'ph_zoiko',
    });

    const [args] = (prisma.pharmacy.findMany as jest.Mock).mock.calls[0];
    expect(args.where.id).toEqual({ not: 'ph_zoiko' });
  });

  it('scans with a bounding box so the index does the work', async () => {
    const prisma = buildPrisma([]);

    await findPharmacyAtSameLocation(prisma, { latitude: 17.5, longitude: 78.4 });

    const [args] = (prisma.pharmacy.findMany as jest.Mock).mock.calls[0];
    expect(args.where.latitude.gte).toBeLessThan(17.5);
    expect(args.where.latitude.lte).toBeGreaterThan(17.5);
    expect(args.where.longitude.gte).toBeLessThan(78.4);
    expect(args.where.longitude.lte).toBeGreaterThan(78.4);
  });

  it('ignores candidates with no coordinates rather than assuming a match', async () => {
    const prisma = buildPrisma([{ ...ZOIKO, latitude: null, longitude: null }]);

    const found = await findPharmacyAtSameLocation(prisma, {
      latitude: ZOIKO.latitude,
      longitude: ZOIKO.longitude,
    });

    expect(found).toBeNull();
  });
});

describe('assertLocationIsFree', () => {
  it('refuses the registration and names the pharmacy already there', async () => {
    const prisma = buildPrisma([ZOIKO]);

    await expect(
      assertLocationIsFree(prisma, {
        latitude: ZOIKO.latitude,
        longitude: ZOIKO.longitude,
      }),
    ).rejects.toThrow(/Zoiko Meds Pharmacy \(Gandimaisamma, Hyderabad\)/);
  });

  it('raises a Conflict, not a validation error', async () => {
    const prisma = buildPrisma([ZOIKO]);

    await expect(
      assertLocationIsFree(prisma, {
        latitude: ZOIKO.latitude,
        longitude: ZOIKO.longitude,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes when the location is free', async () => {
    const prisma = buildPrisma([]);

    await expect(
      assertLocationIsFree(prisma, { latitude: 17.5, longitude: 78.4 }),
    ).resolves.toBeUndefined();
  });
});

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres(17.5, 78.4, 17.5, 78.4)).toBe(0);
  });

  it('measures a known northward offset', () => {
    expect(distanceMetres(17.5, 78.4, northOf(17.5, 100), 78.4)).toBeCloseTo(100, 0);
  });
});
