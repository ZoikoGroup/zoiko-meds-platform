import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ZoikoSignal™ — aggregated, anonymized shortage & access intelligence.
 *
 * Operates ONLY on aggregated data. No user-level, patient-level, or
 * exact-stock data is exposed. Access to intelligence outputs is governed
 * by contract scope and jurisdiction.
 */
@Injectable()
export class SignalService {
  constructor(private readonly prisma: PrismaService) {}

  async getAggregates(params: { medicineId?: string; jurisdictionId?: string }) {
    return this.prisma.signalAggregate.findMany({
      where: {
        medicineId: params.medicineId,
        jurisdictionId: params.jurisdictionId,
      },
      orderBy: { periodStart: 'desc' },
      take: 90,
    });
  }
}
