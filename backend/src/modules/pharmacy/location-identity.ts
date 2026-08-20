import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One physical pharmacy, one record.
 *
 * Two records for the same premises are indistinguishable to a patient: the
 * same shop appears twice in search, each half holding its own availability
 * signals, so one card can say a medicine is stocked while the other says it is
 * not. There is no way to tell which is the real answer.
 *
 * The check lives in the application, not in a unique constraint on
 * (latitude, longitude): coordinates are floats that differ by metres between
 * two readings of the same shop, so an index would miss the duplicates that
 * matter while a hard constraint would fail deploys on existing data. A
 * proximity test catches the same premises whatever the last digits say, and
 * refuses at the point of registration where the operator can still act on it.
 */

/**
 * Two pharmacies closer than this are treated as the same premises.
 *
 * 50 m absorbs the spread between two Google Maps readings of one shopfront
 * without swallowing genuinely separate pharmacies — adjacent units on a high
 * street sit further apart than this.
 */
export const SAME_LOCATION_RADIUS_M = 50;

/** Degrees of latitude per metre — constant enough at any latitude. */
const DEG_PER_M_LAT = 1 / 111_320;

export interface LocatedPharmacy {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * The pharmacy already registered at these coordinates, or null.
 *
 * A bounding box narrows the scan using the existing [latitude, longitude]
 * index, then the great-circle distance decides — a box alone is a square, and
 * its corners are further away than the radius allows.
 */
export async function findPharmacyAtSameLocation(
  prisma: PrismaService,
  params: { latitude: number; longitude: number; excludeId?: string | null },
): Promise<LocatedPharmacy | null> {
  const { latitude, longitude, excludeId } = params;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const latPad = SAME_LOCATION_RADIUS_M * DEG_PER_M_LAT;
  // Longitude degrees shrink towards the poles; guard the cos(lat)→0 case so the
  // box never becomes infinitely wide.
  const cos = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const lngPad = latPad / cos;

  const candidates = await prisma.pharmacy.findMany({
    where: {
      latitude: { gte: latitude - latPad, lte: latitude + latPad },
      longitude: { gte: longitude - lngPad, lte: longitude + lngPad },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      name: true,
      addressLine1: true,
      city: true,
      latitude: true,
      longitude: true,
    },
  });

  for (const candidate of candidates) {
    if (candidate.latitude == null || candidate.longitude == null) continue;
    const metres = distanceMetres(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );
    if (metres <= SAME_LOCATION_RADIUS_M) return candidate;
  }
  return null;
}

/**
 * Refuse a registration that would duplicate an existing pharmacy's premises.
 *
 * Names the record already there, because the operator's next step depends on
 * which case it is: their own earlier registration, a colleague's, or a genuine
 * second pharmacy at one address that a human has to sign off.
 */
export async function assertLocationIsFree(
  prisma: PrismaService,
  params: { latitude: number; longitude: number; excludeId?: string | null },
): Promise<void> {
  const existing = await findPharmacyAtSameLocation(prisma, params);
  if (!existing) return;

  const where = [existing.addressLine1, existing.city].filter(Boolean).join(', ');
  throw new ConflictException(
    `${existing.name}${where ? ` (${where})` : ''} is already registered at this location. ` +
      'Each pharmacy branch needs its own address and map pin. If this is a different ' +
      'pharmacy at the same address, contact ZoikoMeds support to have it added.',
  );
}

/** Great-circle distance between two coordinate pairs, in metres. */
export function distanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // metres
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
