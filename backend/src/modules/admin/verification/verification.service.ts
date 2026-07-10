import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  VerificationRequest,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list() {
    const rows = await this.prisma.verificationRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(actorId: string, dto: CreateVerificationDto) {
    const req = await this.prisma.verificationRequest.create({
      data: {
        pharmacyName: dto.pharmacyName,
        licenseNumber: dto.licenseNumber,
        submittedBy: dto.submittedBy,
        pharmacyId: dto.pharmacyId || null,
        docName: dto.docName || null,
        docUrl: dto.docUrl || null,
      },
    });
    await this.audit.write(
      actorId,
      'admin.verification.create',
      'VerificationRequest',
      req.id,
      { pharmacy: req.pharmacyName },
    );
    return this.toDto(req);
  }

  async update(actorId: string, id: string, dto: UpdateVerificationDto) {
    const existing = await this.require(id);
    const data: Prisma.VerificationRequestUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.reviewer !== undefined) data.reviewer = dto.reviewer;
    if (dto.note) {
      const stamped = `${new Date().toISOString()}: ${dto.note}`;
      data.notes = existing.notes ? `${existing.notes}\n${stamped}` : stamped;
    }

    const req = await this.prisma.verificationRequest.update({
      where: { id },
      data,
    });

    // Approving a request verifies its linked pharmacy.
    if (
      dto.status === VerificationRequestStatus.APPROVED &&
      req.pharmacyId
    ) {
      await this.prisma.pharmacy.update({
        where: { id: req.pharmacyId },
        data: {
          verificationStatus: VerificationStatus.VERIFIED,
          isParticipating: true,
        },
      });
    }

    await this.audit.write(
      actorId,
      `admin.verification.${(dto.status ?? 'update').toLowerCase()}`,
      'VerificationRequest',
      id,
      { pharmacy: req.pharmacyName, status: req.status },
    );
    return this.toDto(req);
  }

  private async require(id: string): Promise<VerificationRequest> {
    const req = await this.prisma.verificationRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('Verification request not found');
    return req;
  }

  private toDto(r: VerificationRequest) {
    return {
      id: r.id,
      pharmacy: r.pharmacyName,
      pharmacyId: r.pharmacyId,
      licenseNumber: r.licenseNumber,
      submittedBy: r.submittedBy,
      date: r.createdAt,
      status: r.status,
      reviewer: r.reviewer,
      docName: r.docName,
      docUrl: r.docUrl,
      notes: r.notes,
    };
  }
}
