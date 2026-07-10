import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MediBase™ — governed medicine identity & normalization layer.
 * Provides medicine matching/lookup. Does NOT provide clinical advice,
 * substitution, prescribing, or dispensing eligibility.
 */
@Injectable()
export class MedibaseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalize a free-text medicine query into candidate canonical entities.
   * Suppressed entities are never returned on public surfaces.
   */
  async matchMedicines(query: string, limit = 10) {
    const q = query.trim();
    if (!q) return [];

    return this.prisma.medicineEntity.findMany({
      where: {
        isSuppressed: false,
        OR: [
          { canonicalName: { contains: q, mode: 'insensitive' } },
          { genericName: { contains: q, mode: 'insensitive' } },
          { brandNames: { has: q } },
        ],
      },
      take: limit,
      select: {
        id: true,
        canonicalName: true,
        genericName: true,
        brandNames: true,
        strength: true,
        dosageForm: true,
        prescriptionCategory: true,
        qualityState: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.medicineEntity.findFirst({
      where: { id, isSuppressed: false },
      include: { identifiers: true },
    });
  }
}
