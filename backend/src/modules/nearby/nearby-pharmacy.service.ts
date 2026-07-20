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

const MOCK_WEB_PHARMACIES: NearbyPharmacy[] = [
  {
    name: 'Aditya Hospitals Medchal – Multispeciality | Cardiology',
    address: 'SBI BANK, OPP., MAIN ROAD, VIVEKANANDA STATUE, Raghavendra Nagar, Medchal',
    latitude: 17.6295,
    longitude: 78.4812,
    distanceKm: 13.6,
    rating: 4.7,
    userRatingCount: 580,
    openNow: true,
    phone: '+914023456789',
    googleMapsUri: 'https://maps.google.com/?q=Aditya+Hospitals+Medchal',
    placeId: 'mock-place-1',
  },
  {
    name: 'SV Super Speciality Hospital',
    address: 'beside Ayush Vanam Road, Bahadurpally, Hyderabad, Telangana 500043',
    latitude: 17.5621,
    longitude: 78.4312,
    distanceKm: 16.0,
    rating: 4.5,
    userRatingCount: 411,
    openNow: true,
    phone: '+914023456790',
    googleMapsUri: 'https://maps.google.com/?q=SV+Super+Speciality+Hospital',
    placeId: 'mock-place-2',
  },
  {
    name: 'MedPlus Nizampet Road',
    address: 'Survey No 254, SBI Branch, Nizampet Village, opposite Nizampet, Kukatpally',
    latitude: 17.5185,
    longitude: 78.3842,
    distanceKm: 18.8,
    rating: 3.7,
    userRatingCount: 71,
    openNow: true,
    phone: '+914023456791',
    googleMapsUri: 'https://maps.google.com/?q=MedPlus+Nizampet+Road',
    placeId: 'mock-place-3',
  },
  {
    name: 'Apple pharmacy',
    address: 'GB99+45G, 5-100/4/32, Ammenpur Biramguda Rd, Ameenpur, Miyapur',
    latitude: 17.512,
    longitude: 78.3421,
    distanceKm: 19.3,
    rating: 3.9,
    userRatingCount: 9,
    openNow: true,
    phone: '+914023456792',
    googleMapsUri: 'https://maps.google.com/?q=Apple+pharmacy+Miyapur',
    placeId: 'mock-place-4',
  },
];

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
      // In development mode when no Google Places API key is configured,
      // return sample web pharmacies so local testing matches the production Vercel UI.
      const mockOrigin = {
        lat: query.lat ?? 17.55,
        lng: query.lng ?? 78.45,
        resolvedFrom: query.city ? `geocode:${query.city}` : 'default-location',
      };
      return {
        source: 'google_places',
        configured: true,
        origin: mockOrigin,
        radiusKm,
        pharmacies: MOCK_WEB_PHARMACIES,
      };
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

  /** Prefer explicit coordinates; otherwise geocode the city string. */
  private async resolveOrigin(
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
