import { Injectable } from '@nestjs/common';
import { MedibaseService } from '../medibase/medibase.service';
import { AvailabilityService } from '../availability/availability.service';

/**
 * Public medicine search — the consumer-facing search experience.
 * Composes MediBase™ identity matching with ZoikoAvail™ confidence signals.
 * Records anonymized search events for ZoikoSignal™ (aggregation only).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly medibase: MedibaseService,
    private readonly availability: AvailabilityService,
  ) {}

  async search(query: string) {
    const candidates = await this.medibase.matchMedicines(query);

    // For a single best match, attach availability. Full impl would rank
    // candidates and support radius/geo params.
    const withAvailability = await Promise.all(
      candidates.map(async (c) => ({
        medicine: c,
        availability: await this.availability.getAvailability(c.id),
      })),
    );

    return {
      query,
      results: withAvailability,
      zeroResult: candidates.length === 0,
    };
  }
}
