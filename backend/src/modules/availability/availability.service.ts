import { Injectable } from '@nestjs/common';
import { AvailabilityConfidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withLogoUrl } from '../pharmacy/logo/pharmacy-logo.service';
import { PUBLIC_SIGNAL_WHERE, signalAgeMinutes } from './availability.visibility';

/**
 * ZoikoAvail™ — availability confidence engine.
 *
 * Returns confidence-based availability signals for a medicine within a
 * geographic radius. NEVER exposes exact stock quantities on public surfaces
 * (governed by EXPOSE_EXACT_STOCK; default false). Confidence is derived from
 * signal freshness, pharmacy reliability, and verification status.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public-safe availability lookup for a medicine. Returns confidence bands
   * and freshness context only — no counts.
   *
   * Keyed on the MediBase identity id, never on a medicine name, and filtered
   * by the shared governed-visibility rule so this answers with exactly the
   * records every other public surface uses.
   */
  async getAvailability(medicineId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: {
        medicineId,
        ...PUBLIC_SIGNAL_WHERE,
      },
      select: {
        confidence: true,
        freshnessMinutes: true,
        requiresConfirmation: true,
        computedAt: true,
        pharmacy: {
          // `phone` is the number to ring: availability is a confidence signal,
          // so the one action offered with it is to call and confirm.
          select: {
            id: true,
            name: true,
            city: true,
            region: true,
            phone: true,
            latitude: true,
            longitude: true,
            // Timestamp only: it becomes a logo URL below, and the image itself
            // lives in another table so this stays a cheap patient-facing read.
            logoUpdatedAt: true,
          },
        },
      },
      orderBy: { confidence: 'asc' },
    });

    return signals.map((s) => ({
      pharmacy: withLogoUrl(s.pharmacy),
      confidence: s.confidence,
      // Derived from computedAt when the stored snapshot is absent, so the age
      // shown here matches the pharmacy portal and /me/search for the same row.
      freshnessMinutes: signalAgeMinutes(s.freshnessMinutes, s.computedAt),
      requiresConfirmation: s.requiresConfirmation,
      computedAt: s.computedAt,
      // NOTE: no exact stock exposed by design.
    }));
  }

  /**
   * Derive a confidence band from raw signal attributes. Placeholder heuristic
   * — replace with the governed ZoikoAvail scoring model from the spec.
   */
  computeConfidence(params: {
    freshnessMinutes: number;
    reliabilityScore: number;
    verified: boolean;
  }): AvailabilityConfidence {
    const { freshnessMinutes, reliabilityScore, verified } = params;
    if (!verified) return AvailabilityConfidence.UNKNOWN;
    if (freshnessMinutes <= 60 && reliabilityScore >= 0.7) return AvailabilityConfidence.HIGH;
    if (freshnessMinutes <= 1440 && reliabilityScore >= 0.4) return AvailabilityConfidence.MODERATE;
    return AvailabilityConfidence.LOW;
  }
}
