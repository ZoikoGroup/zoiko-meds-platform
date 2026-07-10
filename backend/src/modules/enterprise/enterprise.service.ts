import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInquiryDto } from './dto/create-inquiry.dto';

/**
 * Enterprise inquiry intake — captures MediBase™ / ZoikoAvail™ / ZoikoSignal™
 * briefing, API access, and licensing requests, then routes them to the
 * appropriate queue.
 */
@Injectable()
export class EnterpriseService {
  constructor(private readonly prisma: PrismaService) {}

  async createInquiry(dto: CreateInquiryDto) {
    const inquiry = await this.prisma.enterpriseInquiry.create({
      data: {
        workEmail: dto.workEmail,
        fullName: dto.fullName,
        organizationName: dto.organizationName,
        organizationType: dto.organizationType,
        type: dto.type ?? 'GENERAL',
        primaryInterest: dto.primaryInterest,
        note: dto.note,
        requestSource: dto.requestSource,
        assignedQueue: this.routeQueue(dto),
      },
    });
    return {
      id: inquiry.id,
      status: inquiry.status,
      message:
        'Your request has been received. ZoikoMeds will route it to the appropriate team.',
    };
  }

  private routeQueue(dto: CreateInquiryDto): string {
    switch (dto.type) {
      case 'API_ACCESS':
        return 'api-review';
      case 'DATA_LICENSING':
      case 'MEDIBASE_BRIEFING':
        return 'data-commercial';
      case 'SECURITY_REVIEW':
        return 'security-procurement';
      default:
        return 'general';
    }
  }
}
