import { Injectable } from '@nestjs/common';
import { AvailabilityConfidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
   */
  async getAvailability(medicineId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: {
        medicineId,
        confidence: { not: AvailabilityConfidence.SUPPRESSED },
        pharmacy: { isParticipating: true, verificationStatus: 'VERIFIED' },
      },
      select: {
        confidence: true,
        freshnessMinutes: true,
        requiresConfirmation: true,
        computedAt: true,
        pharmacy: {
          select: { id: true, name: true, city: true, region: true, latitude: true, longitude: true },
        },
      },
      orderBy: { confidence: 'asc' },
    });

    return signals.map((s) => ({
      pharmacy: s.pharmacy,
      confidence: s.confidence,
      freshnessMinutes: s.freshnessMinutes,
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
