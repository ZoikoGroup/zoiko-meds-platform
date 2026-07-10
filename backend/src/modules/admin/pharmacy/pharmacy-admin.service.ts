import { Injectable, NotFoundException } from '@nestjs/common';
import { Pharmacy, Prisma, VerificationStatus } from '@prisma/client';
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
    const pharmacy = await this.prisma.pharmacy.create({
      data: {
        name: dto.name,
        licenseNumber: dto.licenseNumber || null,
        city: dto.city || null,
        country: dto.country || null,
        reliabilityScore: (dto.availabilityScore ?? 100) / 100,
        verificationStatus: VerificationStatus.PENDING,
      },
    });
    await this.audit.write(actorId, 'admin.pharmacy.create', 'Pharmacy', pharmacy.id, {
      name: pharmacy.name,
    });
    return this.toDto(pharmacy);
  }

  async update(actorId: string, id: string, dto: UpdatePharmacyDto) {
    await this.require(id);
    const data: Prisma.PharmacyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.licenseNumber !== undefined) data.licenseNumber = dto.licenseNumber || null;
    if (dto.city !== undefined) data.city = dto.city || null;
    if (dto.country !== undefined) data.country = dto.country || null;
    if (dto.availabilityScore !== undefined) {
      data.reliabilityScore = dto.availabilityScore / 100;
    }
    if (dto.verificationStatus !== undefined) {
      data.verificationStatus = dto.verificationStatus;
    }
    const pharmacy = await this.prisma.pharmacy.update({ where: { id }, data });
    await this.audit.write(actorId, 'admin.pharmacy.update', 'Pharmacy', id, {
      changed: Object.keys(data),
    });
    return this.toDto(pharmacy);
  }

  async setStatus(actorId: string, id: string, status: VerificationStatus) {
    await this.require(id);
    const pharmacy = await this.prisma.pharmacy.update({
      where: { id },
      data: {
        verificationStatus: status,
        isParticipating: status === VerificationStatus.VERIFIED,
      },
    });
    await this.audit.write(
      actorId,
      `admin.pharmacy.${status.toLowerCase()}`,
      'Pharmacy',
      id,
    );
    return this.toDto(pharmacy);
  }

  async bulkSetStatus(actorId: string, ids: string[], status: VerificationStatus) {
    await this.prisma.pharmacy.updateMany({
      where: { id: { in: ids } },
      data: {
        verificationStatus: status,
        isParticipating: status === VerificationStatus.VERIFIED,
      },
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
