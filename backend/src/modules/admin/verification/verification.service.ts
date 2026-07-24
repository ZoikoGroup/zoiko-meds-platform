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
    let pharmacyId = dto.pharmacyId || null;
    if (!pharmacyId && dto.licenseNumber) {
      const match = await this.prisma.pharmacy.findFirst({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (match) pharmacyId = match.id;
    }

    const req = await this.prisma.verificationRequest.create({
      data: {
        pharmacyName: dto.pharmacyName,
        licenseNumber: dto.licenseNumber,
        submittedBy: dto.submittedBy,
        pharmacyId,
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
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.verificationRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Verification request not found');

      const data: Prisma.VerificationRequestUpdateInput = {};
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.reviewer !== undefined) data.reviewer = dto.reviewer;
      if (dto.note) {
        const stamped = `${new Date().toISOString()}: ${dto.note}`;
        data.notes = existing.notes ? `${existing.notes}\n${stamped}` : stamped;
      }

      let pharmacyId = existing.pharmacyId;
      if (!pharmacyId && existing.licenseNumber) {
        const matchedPharmacy = await tx.pharmacy.findFirst({
          where: { licenseNumber: existing.licenseNumber },
        });
        if (matchedPharmacy) {
          pharmacyId = matchedPharmacy.id;
          data.pharmacy = { connect: { id: pharmacyId } };
        }
      }

      const req = await tx.verificationRequest.update({
        where: { id },
        data,
      });

      if (dto.status !== undefined && pharmacyId) {
        let targetStatus: VerificationStatus | null = null;
        let targetParticipating: boolean | undefined = undefined;

        switch (dto.status) {
          case VerificationRequestStatus.APPROVED:
            targetStatus = VerificationStatus.VERIFIED;
            targetParticipating = true;
            break;
          case VerificationRequestStatus.REJECTED:
            targetStatus = VerificationStatus.REJECTED;
            targetParticipating = false;
            break;
          case VerificationRequestStatus.REQUEST_INFO:
          case VerificationRequestStatus.UNDER_REVIEW:
          case VerificationRequestStatus.ESCALATED:
          case VerificationRequestStatus.PENDING:
            targetStatus = VerificationStatus.PENDING;
            targetParticipating = false;
            break;
        }

        if (targetStatus !== null) {
          const updateData: Prisma.PharmacyUpdateInput = {
            verificationStatus: targetStatus,
            updatedAt: new Date(),
          };
          if (targetParticipating !== undefined) {
            updateData.isParticipating = targetParticipating;
          }
          await tx.pharmacy.update({
            where: { id: pharmacyId },
            data: updateData,
          });
        }
      }

      return req;
    });

    await this.audit.write(
      actorId,
      `admin.verification.${(dto.status ?? 'update').toLowerCase()}`,
      'VerificationRequest',
      id,
      { pharmacy: result.pharmacyName, status: result.status },
    );
    return this.toDto(result);
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

