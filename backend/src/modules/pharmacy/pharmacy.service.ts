import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Pharmacy verification & participation.
 *
 * Handles the pharmacy portal domain: registration, verification workflow,
 * participation status, and inventory-signal intake. Confidential inventory
 * (exact quantities) is stored but never exposed on public surfaces.
 */
@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService) {}

  async listVerified() {
    return this.prisma.pharmacy.findMany({
      where: { verificationStatus: 'VERIFIED', isParticipating: true },
      select: {
        id: true,
        name: true,
        city: true,
        region: true,
        reliabilityScore: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.pharmacy.findUnique({ where: { id } });
  }
}
