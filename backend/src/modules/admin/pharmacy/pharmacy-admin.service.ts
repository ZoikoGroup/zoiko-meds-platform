import { Injectable, NotFoundException } from '@nestjs/common';
import { Pharmacy, Prisma, VerificationRequestStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { ListPharmaciesQuery } from './dto/list-pharmacies.query';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class PharmacyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list(query: ListPharmaciesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.PharmacyWhereInput = {};
    if (query.status) where.verificationStatus = query.status;
    if (query.country) where.country = query.country;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { licenseNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.pharmacy.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pharmacy.count({ where }),
    ]);

    return {
      items: rows.map((p) => this.toDto(p)),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string) {
    return this.toDto(await this.require(id));
  }

  async create(actorId: string, dto: CreatePharmacyDto) {
    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pharmacy.create({
        data: {
          name: dto.name,
          licenseNumber: dto.licenseNumber || null,
          city: dto.city || null,
          country: dto.country || null,
          reliabilityScore: (dto.availabilityScore ?? 100) / 100,
          verificationStatus: VerificationStatus.PENDING,
        },
      });

      if (dto.licenseNumber) {
        await tx.verificationRequest.updateMany({
          where: { licenseNumber: dto.licenseNumber, pharmacyId: null },
          data: { pharmacyId: created.id },
        });
      }
      return created;
    });

    await this.audit.write(actorId, 'admin.pharmacy.create', 'Pharmacy', pharmacy.id, {
      name: pharmacy.name,
    });
    return this.toDto(pharmacy);
  }

  async update(actorId: string, id: string, dto: UpdatePharmacyDto) {
    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pharmacy.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Pharmacy not found');

      const data: Prisma.PharmacyUpdateInput = { updatedAt: new Date() };
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.licenseNumber !== undefined) data.licenseNumber = dto.licenseNumber || null;
      if (dto.city !== undefined) data.city = dto.city || null;
      if (dto.country !== undefined) data.country = dto.country || null;
      if (dto.availabilityScore !== undefined) {
        data.reliabilityScore = dto.availabilityScore / 100;
      }
      if (dto.verificationStatus !== undefined) {
        data.verificationStatus = dto.verificationStatus;
        data.isParticipating = dto.verificationStatus === VerificationStatus.VERIFIED;
      }

      const updated = await tx.pharmacy.update({ where: { id }, data });

      if (dto.verificationStatus !== undefined) {
        await this.syncVerificationRequests(tx, [id], dto.verificationStatus);
      }

      return updated;
    });

    await this.audit.write(actorId, 'admin.pharmacy.update', 'Pharmacy', id, {
      changed: Object.keys(dto),
    });
    return this.toDto(pharmacy);
  }

  async setStatus(actorId: string, id: string, status: VerificationStatus) {
    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pharmacy.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Pharmacy not found');

      const updated = await tx.pharmacy.update({
        where: { id },
        data: {
          verificationStatus: status,
          isParticipating: status === VerificationStatus.VERIFIED,
          updatedAt: new Date(),
        },
      });

      await this.syncVerificationRequests(tx, [id], status);
      return updated;
    });

    await this.audit.write(
      actorId,
      `admin.pharmacy.${status.toLowerCase()}`,
      'Pharmacy',
      id,
      { name: pharmacy.name, status },
    );
    return this.toDto(pharmacy);
  }

  async bulkSetStatus(actorId: string, ids: string[], status: VerificationStatus) {
    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacy.updateMany({
        where: { id: { in: ids } },
        data: {
          verificationStatus: status,
          isParticipating: status === VerificationStatus.VERIFIED,
          updatedAt: new Date(),
        },
      });
      await this.syncVerificationRequests(tx, ids, status);
    });

    await this.audit.write(
      actorId,
      `admin.pharmacy.bulk_${status.toLowerCase()}`,
      'Pharmacy',
      null,
      { ids, status },
    );
    return { updated: ids.length, status };
  }

  async remove(actorId: string, id: string) {
    const pharmacy = await this.require(id);
    await this.prisma.pharmacy.delete({ where: { id } });
    await this.audit.write(actorId, 'admin.pharmacy.delete', 'Pharmacy', id, {
      name: pharmacy.name,
    });
    return { id, deleted: true };
  }

  private async syncVerificationRequests(
    tx: Prisma.TransactionClient,
    pharmacyIds: string[],
    status: VerificationStatus,
  ) {
    let targetReqStatus: VerificationRequestStatus | null = null;
    switch (status) {
      case VerificationStatus.VERIFIED:
        targetReqStatus = VerificationRequestStatus.APPROVED;
        break;
      case VerificationStatus.REJECTED:
      case VerificationStatus.SUSPENDED:
        targetReqStatus = VerificationRequestStatus.REJECTED;
        break;
      case VerificationStatus.PENDING:
      case VerificationStatus.UNVERIFIED:
        targetReqStatus = VerificationRequestStatus.PENDING;
        break;
    }

    if (targetReqStatus !== null) {
      await tx.verificationRequest.updateMany({
        where: { pharmacyId: { in: pharmacyIds } },
        data: { status: targetReqStatus },
      });

      const pharmacies = await tx.pharmacy.findMany({
        where: { id: { in: pharmacyIds }, licenseNumber: { not: null } },
        select: { id: true, licenseNumber: true },
      });
      const licenses = pharmacies.map((p) => p.licenseNumber).filter(Boolean) as string[];
      if (licenses.length > 0) {
        await tx.verificationRequest.updateMany({
          where: { licenseNumber: { in: licenses } },
          data: { status: targetReqStatus },
        });
      }
    }
  }

  private async require(id: string): Promise<Pharmacy> {
    const pharmacy = await this.prisma.pharmacy.findUnique({ where: { id } });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return pharmacy;
  }

  private toDto(p: Pharmacy) {
    return {
      id: p.id,
      name: p.name,
      licenseNumber: p.licenseNumber,
      city: p.city,
      country: p.country,
      status: p.verificationStatus,
      availabilityScore: Math.round(p.reliabilityScore * 100),
      isParticipating: p.isParticipating,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}

