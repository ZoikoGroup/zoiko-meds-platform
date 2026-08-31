import { Logger } from '@nestjs/common';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';

const logger = new Logger('PharmacyCoordinates');

/**
 * Coordinates for a pharmacy, preferring what was supplied and falling back to
 * geocoding the pharmacy's own street address.
 *
 * A pharmacy with no coordinates is invisible to every distance-bounded patient
 * search — `MeService.distanceFor` returns null for it and the result is dropped
 * before it is ever ranked — so a record created from an address alone could
 * never be found, however complete the rest of its profile was. Only the admin
 * create/update path used to geocode; every other way a Pharmacy row comes into
 * existence (a pharmacy registering itself, a verification approval that has no
 * pharmacy row yet, an operator editing their own profile) stored nulls.
 *
 * Two rules keep the result the pharmacy's real position rather than a
 * plausible-looking one:
 *
 *  - the whole address is geocoded, not [city, country]. Geocoding a city
 *    returns its centroid, so every pharmacy registered in Hyderabad would land
 *    on the same point, at the same distance from every patient;
 *  - an area-level match is discarded rather than stored. No coordinates is a
 *    true statement ("not located yet", and the pin can be supplied later); a
 *    city centre is a false one.
 *
 * Never throws: geocoding failure is non-fatal, the record is still written,
 * just not yet locatable.
 */
export async function resolvePharmacyCoordinates(
  nearby: NearbyPharmacyService,
  supplied: { latitude?: number | null; longitude?: number | null },
  address: (string | null | undefined)[],
): Promise<{ latitude: number; longitude: number } | null> {
  if (supplied.latitude != null && supplied.longitude != null) {
    return { latitude: supplied.latitude, longitude: supplied.longitude };
  }

  const query = address.filter(Boolean).join(', ').trim();
  if (!query) return null;

  const point = await nearby.geocode(query);
  if (!point) return null;

  if (!point.precise) {
    logger.warn(
      `Geocoding "${query}" resolved only to ${point.granularity} — refusing to ` +
        'store an area centroid as a pharmacy location. Supply the street ' +
        'address or a Google Maps link to the branch.',
    );
    return null;
  }
  return { latitude: point.lat, longitude: point.lng };
}
