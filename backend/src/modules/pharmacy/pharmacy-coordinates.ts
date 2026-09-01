import { BadRequestException, Logger } from '@nestjs/common';
import { LocationPrecision } from '@prisma/client';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';

const logger = new Logger('PharmacyCoordinates');

/**
 * How far a supplied pin may sit from the area its own address names before it
 * is treated as belonging to a different place entirely.
 *
 * Generous on purpose. The comparison point is an area centroid, so a genuine
 * branch on the far edge of a large metro is legitimately tens of kilometres
 * from the middle of it; this only has to catch a pin in the wrong city.
 */
const ADDRESS_MISMATCH_KM = 150;

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
}

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
 * The result carries how precisely it locates the shop:
 *
 *  - EXACT — a pin the operator supplied, or a street-level geocode. The whole
 *    address is geocoded, not [city, country], so two branches in one city do
 *    not land on the same point;
 *  - APPROXIMATE — the address only resolved to an area (a city, a district, a
 *    PIN code), so this is the middle of that area rather than the shop.
 *
 * An area centroid used to be discarded on the grounds that no coordinates is a
 * true statement and a city centre is a false one. True, but it made the
 * pharmacy invisible instead of roughly located, which is the worse of the two
 * failures: a patient searching their own city found nothing at all. It is
 * stored now, and every surface that prints a distance for it says the distance
 * is approximate.
 *
 * Geocoding failure is non-fatal: the record is still written, just not yet
 * locatable. The one thing that IS fatal is a supplied pin that contradicts the
 * supplied address — see `assertPinMatchesAddress`.
 */
export async function resolvePharmacyCoordinates(
  nearby: NearbyPharmacyService,
  supplied: { latitude?: number | null; longitude?: number | null },
  address: (string | null | undefined)[],
): Promise<ResolvedLocation | null> {
  const query = address.filter(Boolean).join(', ').trim();

  if (supplied.latitude != null && supplied.longitude != null) {
    const pin = {
      latitude: supplied.latitude,
      longitude: supplied.longitude,
      precision: LocationPrecision.EXACT,
    };
    await assertPinMatchesAddress(nearby, pin, query);
    return pin;
  }

  if (!query) return null;

  const point = await nearby.geocode(query);
  if (!point) return null;

  if (!point.precise) {
    logger.log(
      `Geocoding "${query}" resolved only to ${point.granularity} — storing it as ` +
        'an APPROXIMATE location. Supply the street address or a Google Maps ' +
        'link to the branch to place it exactly.',
    );
  }
  return {
    latitude: point.lat,
    longitude: point.lng,
    precision: point.precise ? LocationPrecision.EXACT : LocationPrecision.APPROXIMATE,
  };
}

/**
 * Reject a supplied pin that describes somewhere other than the address beside
 * it.
 *
 * A pin is trusted over a geocode because the operator dropped it on their own
 * branch — but only while the two are talking about the same place. A pharmacy
 * whose address read "Delhi, 110006" while its pin sat in Hyderabad, 1,100 km
 * away, passed every check the write path had: the pin was well-formed, so it
 * was stored and never questioned, and the address was area-level, so no later
 * geocode could correct it. Patients in Delhi were told there was nothing near
 * them; patients in Hyderabad were offered a shop that is not there.
 *
 * The area centroid is exactly the right instrument for this even though it is
 * the wrong thing to store: it cannot say where the branch is, but it can say
 * which city the address is in.
 *
 * This refuses the save rather than picking a winner, because there is no way
 * to tell from here which half is wrong — and both are things a person typed,
 * so a person can settle it. Storing either one silently is how the record got
 * into this state in the first place.
 *
 * Any doubt resolves in favour of the pin: no address to compare, a geocode
 * that missed, or a lookup that failed all pass.
 */
async function assertPinMatchesAddress(
  nearby: NearbyPharmacyService,
  pin: { latitude: number; longitude: number },
  query: string,
): Promise<void> {
  if (!query) return;

  const point = await nearby.geocode(query);
  if (!point) return;

  const km = haversineKm(pin.latitude, pin.longitude, point.lat, point.lng);
  if (km <= ADDRESS_MISMATCH_KM) return;

  logger.warn(
    `Rejected pin ${pin.latitude},${pin.longitude}: ${Math.round(km)} km from ` +
      `"${query}".`,
  );
  throw new BadRequestException(
    `The map location you set is about ${Math.round(km)} km from the address on this ` +
      'pharmacy, so one of the two is wrong. Correct the address, or drop the pin ' +
      'on the branch itself, and save again.',
  );
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
