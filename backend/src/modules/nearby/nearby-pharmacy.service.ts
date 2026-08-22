import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * NearbyPharmacyFinder — external (internet) pharmacy discovery.
 *
 * Supplements the governed in-database pharmacy network with general
 * pharmacies discovered near a location via the Google Places API. These
 * results are geographic only: public sources cannot tell us which pharmacy
 * stocks a specific medicine, so nearby pharmacies are returned WITHOUT any
 * availability/stock claim and must be presented separately from ZoikoAvail™
 * confidence signals.
 *
 * If GOOGLE_PLACES_API_KEY is not configured the finder is disabled and
 * returns an empty, well-formed result so search keeps working locally
 * without any external credentials (mirrors the MailService fallback).
 */

// Google Places circle radius is capped at 50 km by the API.
const MAX_RADIUS_KM = 50;
const DEFAULT_RADIUS_KM = 5;
const MAX_RESULTS = 20;
// Hard ceiling so a slow/unreachable Google endpoint never stalls a search.
const REQUEST_TIMEOUT_MS = 4000;

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export interface NearbyQuery {
  lat?: number;
  lng?: number;
  city?: string;
  maxDistanceKm?: number;
}

export interface NearbyPharmacy {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  rating: number | null;
  userRatingCount: number | null;
  openNow: boolean | null;
  phone: string | null;
  googleMapsUri: string | null;
  placeId: string | null;
}

/**
 * A geocoded point, with how precisely the address behind it was resolved.
 *
 * `precise` is false when Google could only place the query at a locality or
 * wider — a city centroid. Those coordinates belong to a town, not a pharmacy:
 * every branch in the city would land on the same point, at the same distance
 * from every patient, so callers placing a pharmacy must refuse them.
 */
export interface GeocodedPoint {
  lat: number;
  lng: number;
  precise: boolean;
  /** Google's own description of what was matched, for logs and audit. */
  granularity: string;
}

/**
 * Result granularities that describe an area rather than a building.
 * A match whose types are all in here is a centroid, whatever its coordinates
 * look like.
 */
const AREA_LEVEL_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'neighborhood',
  'postal_code',
  'postal_code_prefix',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'country',
  'political',
  'plus_code',
]);

export interface NearbyPharmacyResult {
  source: 'google_places';
  // False when no API key is configured (feature effectively off).
  configured: boolean;
  // Resolved search origin, or null when we couldn't determine a location.
  origin: { lat: number; lng: number; resolvedFrom: string } | null;
  radiusKm: number;
  pharmacies: NearbyPharmacy[];
  // Human-readable context when the list is empty (why), else undefined.
  note?: string;
}

@Injectable()
export class NearbyPharmacyService {
  private readonly logger = new Logger(NearbyPharmacyService.name);
  private readonly apiKey: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GOOGLE_PLACES_API_KEY') || '';
    this.enabled = Boolean(this.apiKey);
    if (!this.enabled) {
      this.logger.warn(
        'GOOGLE_PLACES_API_KEY not set — internet pharmacy search is disabled.',
      );
    }
  }

  /**
   * Find general pharmacies near the caller's location. Never throws: any
   * failure (missing key, geocode miss, network/API error) degrades to an
   * empty result with a `note`, so the surrounding medicine search is
   * unaffected.
   */
  async findNearby(query: NearbyQuery): Promise<NearbyPharmacyResult> {
    const radiusKm = this.clampRadius(query.maxDistanceKm);
    const empty = (note: string, configured = this.enabled): NearbyPharmacyResult => ({
      source: 'google_places',
      configured,
      origin: null,
      radiusKm,
      pharmacies: [],
      note,
    });

    if (!this.enabled) {
      // Without a key there is nothing to report. Sample pharmacies used to be
      // returned here with `configured: true` and fixed distances, which put
      // invented shops, addresses and phone numbers on a medicine-availability
      // screen at a distance that never changed with the caller's location.
      return empty(
        'Nearby web pharmacy search is not configured on this environment.',
        false,
      );
    }

    let origin: { lat: number; lng: number; resolvedFrom: string } | null = null;
    try {
      origin = await this.resolveOrigin(query);
    } catch (err) {
      this.logger.error(`Geocoding failed: ${errMessage(err)}`);
      return empty('Could not resolve the provided location.');
    }
    if (!origin) {
      return empty('A location (lat/lng or city) is required to find nearby pharmacies.');
    }

    try {
      const pharmacies = await this.searchNearby(origin, radiusKm);
      return {
        source: 'google_places',
        configured: true,
        origin,
        radiusKm,
        pharmacies,
        note: pharmacies.length === 0 ? 'No nearby pharmacies found.' : undefined,
      };
    } catch (err) {
      this.logger.error(`Places nearby search failed: ${errMessage(err)}`);
      return { ...empty('Nearby pharmacy lookup is temporarily unavailable.'), origin };
    }
  }

  private clampRadius(maxDistanceKm?: number): number {
    const km = Number.isFinite(maxDistanceKm as number)
      ? (maxDistanceKm as number)
      : DEFAULT_RADIUS_KM;
    return Math.min(Math.max(km, 1), MAX_RADIUS_KM);
  }

  /**
   * Geocode a free-text address to coordinates, reporting how precisely the
   * address resolved.
   *
   * Public so pharmacy registration can place a pharmacy on the map from the
   * address an operator typed — a pharmacy without coordinates can never appear
   * in a distance-bounded search. Returns null on any failure (no key, no
   * match, network error); callers treat that as "not locatable yet".
   *
   * The caller decides what to do with an imprecise match. For placing a
   * pharmacy the answer is always to refuse it: a city centroid puts every
   * branch in town on one pin.
   */
  async geocode(address: string): Promise<GeocodedPoint | null> {
    const query = (address ?? '').trim();
    if (!this.enabled || !query) return null;
    try {
      const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${this.apiKey}`;
      const data = await this.fetchJson(url);
      const best = data?.results?.[0];
      const loc = best?.geometry?.location;
      if (data?.status !== 'OK' || !loc) return null;

      const types: string[] = Array.isArray(best?.types) ? best.types : [];
      const locationType: string = best?.geometry?.location_type ?? 'UNKNOWN';
      // APPROXIMATE is Google's own word for "this is the middle of an area".
      // A result whose every type is area-level is the same thing said twice.
      const precise =
        locationType !== 'APPROXIMATE' &&
        types.length > 0 &&
        types.some((t) => !AREA_LEVEL_TYPES.has(t));

      return {
        lat: loc.lat,
        lng: loc.lng,
        precise,
        granularity: `${locationType}:${types.join('+') || 'unknown'}`,
      };
    } catch (err) {
      this.logger.warn(`Geocoding "${query}" failed: ${errMessage(err)}`);
      return null;
    }
  }

  /**
   * Prefer explicit coordinates; otherwise geocode the city string.
   * Public so medicine search can measure distances from the caller's own
   * location rather than a fixed origin.
   */
  async resolveOrigin(
    query: NearbyQuery,
  ): Promise<{ lat: number; lng: number; resolvedFrom: string } | null> {
    if (isCoord(query.lat) && isCoord(query.lng)) {
      return { lat: query.lat!, lng: query.lng!, resolvedFrom: 'coordinates' };
    }
    const city = (query.city ?? '').trim();
    if (!city) return null;

    const url = `${GEOCODE_URL}?address=${encodeURIComponent(city)}&key=${this.apiKey}`;
    const data = await this.fetchJson(url);
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status !== 'OK' || !loc) return null;
    return { lat: loc.lat, lng: loc.lng, resolvedFrom: `geocode:${city}` };
  }

  private async searchNearby(
    origin: { lat: number; lng: number },
    radiusKm: number,
  ): Promise<NearbyPharmacy[]> {
    const body = {
      includedTypes: ['pharmacy'],
      maxResultCount: MAX_RESULTS,
      locationRestriction: {
        circle: {
          center: { latitude: origin.lat, longitude: origin.lng },
          radius: radiusKm * 1000,
        },
      },
    };

    const data = await this.fetchJson(PLACES_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.rating',
          'places.userRatingCount',
          'places.currentOpeningHours.openNow',
          'places.internationalPhoneNumber',
          'places.googleMapsUri',
        ].join(','),
      },
      body: JSON.stringify(body),
    });

    const places: any[] = Array.isArray(data?.places) ? data.places : [];
    return places
      .map((p) => this.toNearbyPharmacy(p, origin))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  private toNearbyPharmacy(
    place: any,
    origin: { lat: number; lng: number },
  ): NearbyPharmacy {
    const lat = place?.location?.latitude ?? null;
    const lng = place?.location?.longitude ?? null;
    return {
      name: place?.displayName?.text ?? 'Unknown pharmacy',
      address: place?.formattedAddress ?? null,
      latitude: lat,
      longitude: lng,
      distanceKm:
        isCoord(lat) && isCoord(lng)
          ? round1(haversineKm(origin.lat, origin.lng, lat, lng))
          : null,
      rating: place?.rating ?? null,
      userRatingCount: place?.userRatingCount ?? null,
      openNow: place?.currentOpeningHours?.openNow ?? null,
      phone: place?.internationalPhoneNumber ?? null,
      googleMapsUri: place?.googleMapsUri ?? null,
      placeId: place?.id ?? null,
    };
  }

  /** fetch + JSON with a timeout; throws on non-2xx or network error. */
  private async fetchJson(url: string, init?: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function isCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Great-circle distance between two lat/lng points, in kilometres. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
