import { Injectable } from '@nestjs/common';
import { MedibaseService } from '../medibase/medibase.service';
import { AvailabilityService } from '../availability/availability.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { PublicSearchQuery } from './dto/public-search.query';

/**
 * Public medicine search — the consumer-facing search experience.
 * Composes MediBase™ identity matching with ZoikoAvail™ confidence signals,
 * and — when a location is supplied — supplements the governed pharmacy
 * network with general pharmacies discovered nearby on the internet.
 * Records anonymized search events for ZoikoSignal™ (aggregation only).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly medibase: MedibaseService,
    private readonly availability: AvailabilityService,
    private readonly nearby: NearbyPharmacyService,
  ) {}

  async search(query: PublicSearchQuery) {
    const q = query.q ?? '';
    const candidates = await this.medibase.matchMedicines(q);

    // In-database availability signals (ZoikoAvail confidence) per candidate.
    const withAvailability = await Promise.all(
      candidates.map(async (c) => ({
        medicine: c,
        availability: await this.availability.getAvailability(c.id),
      })),
    );

    // Internet-sourced pharmacies near the caller. Geographic only — NOT tied
    // to whether the searched medicine is in stock (public sources can't know
    // that), so these are kept separate from the availability signals above.
    // Only attempted when a location is provided; degrades to empty otherwise.
    const hasLocation =
      (query.lat != null && query.lng != null) || Boolean(query.city?.trim());
    const nearbyPharmacies = hasLocation
      ? await this.nearby.findNearby({
          lat: query.lat,
          lng: query.lng,
          city: query.city,
          maxDistanceKm: query.maxDistance,
        })
      : null;

    return {
      query: q,
      results: withAvailability,
      zeroResult: candidates.length === 0,
      nearbyPharmacies,
    };
  }
}
