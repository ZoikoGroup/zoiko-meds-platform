import { ConflictException } from '@nestjs/common';
import { LocationPrecision } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One physical pharmacy branch, one record.
 *
 * Distinct pharmacies in the same locality, city, or postal code are legitimately
 * independent and must never be blocked simply because geocoding places them at
 * an approximate locality centroid (e.g. Gandimaisamma).
 *
 * Duplicate detection prevents genuine duplicate registrations of the same
 * pharmacy branch (same licence and branch premises), while allowing separate
 * branches of the same business and legitimate independent pharmacies sharing
 * a building or address via an approved validation path.
 */

export const SAME_LOCATION_RADIUS_M = 50;

/** Degrees of latitude per metre — constant enough at any latitude. */
const DEG_PER_M_LAT = 1 / 111_320;

export interface LocatedPharmacy {
  id: string;
  name: string;
  licenseNumber?: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision?: LocationPrecision | string | null;
}

export interface LocationCheckParams {
  latitude: number;
  longitude: number;
  locationPrecision?: LocationPrecision | string | null;
  excludeId?: string | null;
  name?: string | null;
  licenseNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  confirmSharedAddress?: boolean;
  allowSharedAddress?: boolean;
}

/**
 * Normalize licence numbers by removing whitespace, hyphens, slashes, and
 * converting to uppercase. E.g. "LIC-HYD-01" -> "LICHYD01".
 */
export function normalizeLicenseNumber(license?: string | null): string {
  if (!license) return '';
  return license.trim().toUpperCase().replace(/[\s\-_/\\.]+/g, '');
}

/**
 * Normalize pharmacy names by converting to lowercase and collapsing whitespace
 * and non-alphanumeric punctuation.
 */
export function normalizePharmacyName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize address components for comparison.
 */
export function normalizeAddressComponent(component?: string | null): string {
  if (!component) return '';
  return component
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compare two street addresses to see if they describe the same premises or building.
 * If either addressLine1 is missing, it cannot be considered the same street address.
 */
export function isSameStreetAddress(
  a: { addressLine1?: string | null; city?: string | null },
  b: { addressLine1?: string | null; city?: string | null },
): boolean {
  const streetA = normalizeAddressComponent(a.addressLine1);
  const streetB = normalizeAddressComponent(b.addressLine1);
  if (!streetA || !streetB) return false;

  const cityA = normalizeAddressComponent(a.city);
  const cityB = normalizeAddressComponent(b.city);
  if (cityA && cityB && cityA !== cityB) return false;

  return streetA === streetB;
}

/**
 * In-memory concurrency lock keyed by branch identity to prevent race conditions
 * on simultaneous registrations of the same branch.
 */
const branchLocks = new Map<string, Promise<void>>();

export async function withBranchLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  while (branchLocks.has(key)) {
    await branchLocks.get(key);
  }

  let resolveLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  branchLocks.set(key, lockPromise);

  try {
    return await fn();
  } finally {
    branchLocks.delete(key);
    resolveLock();
  }
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
      licenseNumber: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      locationPrecision: true,
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
 * Find an existing pharmacy with the same normalized licence number.
 */
export async function findPharmacyByLicense(
  prisma: PrismaService,
  licenseNumber: string,
  excludeId?: string | null,
): Promise<LocatedPharmacy | null> {
  const norm = normalizeLicenseNumber(licenseNumber);
  if (!norm) return null;

  const candidates = await prisma.pharmacy.findMany({
    where: {
      licenseNumber: { not: null },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      locationPrecision: true,
    },
  });

  for (const candidate of candidates) {
    if (normalizeLicenseNumber(candidate.licenseNumber) === norm) {
      return candidate;
    }
  }
  return null;
}

/**
 * Refuse a registration that would duplicate an existing pharmacy's premises or licence,
 * while allowing independent pharmacies in the same locality, distinct branches of the
 * same chain, and shared addresses through the approved validation path.
 */
export async function assertLocationIsFree(
  prisma: PrismaService,
  params: LocationCheckParams,
): Promise<void> {
  const {
    latitude,
    longitude,
    excludeId,
    locationPrecision,
    name,
    licenseNumber,
    addressLine1,
    addressLine2,
    city,
    confirmSharedAddress,
    allowSharedAddress,
  } = params;

  // 1. Proximity scan using spatial index
  const existingAtLocation = await findPharmacyAtSameLocation(prisma, {
    latitude,
    longitude,
    excludeId,
  });

  // If candidate details were not provided (legacy caller or minimal test fixture),
  // retain legacy behavior:
  const hasCandidateDetails = Boolean(
    name || licenseNumber || addressLine1 || locationPrecision,
  );

  if (!hasCandidateDetails) {
    if (!existingAtLocation) return;
    const where = [existingAtLocation.addressLine1, existingAtLocation.city]
      .filter(Boolean)
      .join(', ');
    throw new ConflictException(
      `${existingAtLocation.name}${where ? ` (${where})` : ''} is already registered at this location. ` +
        'Each pharmacy branch needs its own address and map pin. If this is a different ' +
        'pharmacy at the same address, contact ZoikoMeds support to have it added.',
    );
  }

  const candLicense = normalizeLicenseNumber(licenseNumber);
  const candName = normalizePharmacyName(name);
  const candStreet = normalizeAddressComponent(addressLine1);
  const candCity = normalizeAddressComponent(city);
  const confirmed = Boolean(confirmSharedAddress || allowSharedAddress);

  // 2. Check for duplicate licence if licence is supplied
  if (candLicense) {
    const existingSameLicense = await findPharmacyByLicense(
      prisma,
      candLicense,
      excludeId,
    );
    if (existingSameLicense) {
      const existLicense = normalizeLicenseNumber(existingSameLicense.licenseNumber);
      const existName = normalizePharmacyName(existingSameLicense.name);
      const existStreet = normalizeAddressComponent(existingSameLicense.addressLine1);
      const existCity = normalizeAddressComponent(existingSameLicense.city);

      if (candLicense === existLicense) {
        // Different corporate business attempting to use the same licence
        if (candName && existName && candName !== existName) {
          throw new ConflictException(
            `Licence number ${licenseNumber} is already registered to "${existingSameLicense.name}". ` +
              'Each independent pharmacy business must hold its own valid licence.',
          );
        }

        // Same business with the same licence:
        // If address is the same -> Re-registering the same branch!
        const isSameBranchAddress =
          isSameStreetAddress(
            { addressLine1, city },
            { addressLine1: existingSameLicense.addressLine1, city: existingSameLicense.city },
          ) || (!candStreet && !existStreet && candCity === existCity);

        if (isSameBranchAddress) {
          throw new ConflictException(
            `Pharmacy "${existingSameLicense.name}" is already registered with licence ` +
              `${existingSameLicense.licenseNumber || licenseNumber} at this branch location.`,
          );
        }

        // If address is legitimately distinct -> legitimate second branch of the same business!
      }
    }
  }

  // If no pharmacy was found within proximity, location check passes!
  if (!existingAtLocation) return;

  // 3. Proximity candidate evaluation
  const existName = normalizePharmacyName(existingAtLocation.name);
  const existLicense = normalizeLicenseNumber(existingAtLocation.licenseNumber);
  const existStreet = normalizeAddressComponent(existingAtLocation.addressLine1);
  const existCity = normalizeAddressComponent(existingAtLocation.city);

  const sameStreet = isSameStreetAddress(
    { addressLine1, city },
    { addressLine1: existingAtLocation.addressLine1, city: existingAtLocation.city },
  );

  const isApproximate =
    locationPrecision === LocationPrecision.APPROXIMATE ||
    locationPrecision === 'APPROXIMATE' ||
    existingAtLocation.locationPrecision === LocationPrecision.APPROXIMATE ||
    existingAtLocation.locationPrecision === 'APPROXIMATE';

  // 3A. Exact same licence & same branch:
  if (candLicense && existLicense && candLicense === existLicense) {
    if (sameStreet || (!candStreet && !existStreet)) {
      throw new ConflictException(
        `Pharmacy "${existingAtLocation.name}" is already registered with licence ` +
          `${existingAtLocation.licenseNumber || licenseNumber} at this branch location.`,
      );
    }
    // Legitimate second branch at distinct address: allowed!
    return;
  }

  // 3B. Same pharmacy name:
  if (candName && existName && candName === existName) {
    if (sameStreet || (!candStreet && !existStreet && !isApproximate)) {
      const where = [existingAtLocation.addressLine1, existingAtLocation.city].filter(Boolean).join(', ');
      throw new ConflictException(
        `Pharmacy "${existingAtLocation.name}" is already registered at this address${where ? ` (${where})` : ''}.`,
      );
    }
    // Distinct address for same brand: legitimate second branch!
    return;
  }

  // 3C. Different pharmacy at same street address:
  if (sameStreet) {
    if (confirmed) {
      // Approved validation path for distinct pharmacies sharing a building/address
      return;
    }
    const where = [existingAtLocation.addressLine1, existingAtLocation.city].filter(Boolean).join(', ');
    throw new ConflictException(
      `"${existingAtLocation.name}"${where ? ` (${where})` : ''} is already registered at this street address. ` +
        'If this is a separate pharmacy sharing this building or address, confirm the shared address to proceed.',
    );
  }

  // 3D. Approximate geocoding (e.g. locality or postal centroid like Gandimaisamma):
  if (isApproximate) {
    // Missing or imprecise geocoding must never reject distinct pharmacies in the same locality/postal code.
    return;
  }

  // 3E. Exact coordinates collision:
  if (!confirmed) {
    const where = [existingAtLocation.addressLine1, existingAtLocation.city].filter(Boolean).join(', ');
    throw new ConflictException(
      `${existingAtLocation.name}${where ? ` (${where})` : ''} is already registered at this location. ` +
        'Each pharmacy branch needs its own address and map pin. If this is a separate pharmacy sharing this address, ' +
        'confirm the shared address to proceed.',
    );
  }
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
