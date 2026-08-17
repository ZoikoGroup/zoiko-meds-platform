import { Injectable, NotFoundException } from '@nestjs/common';
import { Pharmacy, Prisma, VerificationRequestStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { ListPharmaciesQuery } from './dto/list-pharmacies.query';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class PharmacyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly nearby: NearbyPharmacyService,
  ) {}

  /**
   * Coordinates for a pharmacy, preferring what the admin supplied and falling
   * back to geocoding the address.
   *
   * A pharmacy with no coordinates is invisible to every distance-bounded
   * patient search, so registering one by address alone silently produced a
   * record that could never be found. Geocoding failure is non-fatal — the
   * record is still saved, just not yet locatable.
   */
  private async resolveCoordinates(
    supplied: { latitude?: number; longitude?: number },
    address: (string | null | undefined)[],
  ): Promise<{ latitude: number; longitude: number } | null> {
    if (supplied.latitude != null && supplied.longitude != null) {
      return { latitude: supplied.latitude, longitude: supplied.longitude };
    }
    const query = address.filter(Boolean).join(', ').trim();
    if (!query) return null;
    const point = await this.nearby.geocode(query);
    return point ? { latitude: point.lat, longitude: point.lng } : null;
  }

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
    // Resolved outside the transaction: geocoding is a network call and must
    // not hold a database transaction open.
    const coords = await this.resolveCoordinates(dto, [dto.city, dto.country]);

    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pharmacy.create({
        data: {
          name: dto.name,
          licenseNumber: dto.licenseNumber || null,
          city: dto.city || null,
          country: dto.country || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
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
    const current = await this.prisma.pharmacy.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Pharmacy not found');

    // Re-locate when coordinates were supplied, or when the address changed, or
    // when the record simply never had coordinates — the last case is what
    // brings already-registered pharmacies into patient search.
    const addressChanged =
      dto.addressLine1 !== undefined ||
      dto.city !== undefined ||
      dto.region !== undefined ||
      dto.postalCode !== undefined ||
      dto.country !== undefined;
    const missingCoords = current.latitude == null || current.longitude == null;

    const coords =
      dto.latitude != null || dto.longitude != null || addressChanged || missingCoords
        ? await this.resolveCoordinates(dto, [
            dto.addressLine1 ?? current.addressLine1,
            dto.city ?? current.city,
            dto.region ?? current.region,
            dto.postalCode ?? current.postalCode,
            dto.country ?? current.country,
          ])
        : null;

    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pharmacy.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Pharmacy not found');

      const data: Prisma.PharmacyUpdateInput = { updatedAt: new Date() };
      if (coords) {
        data.latitude = coords.latitude;
        data.longitude = coords.longitude;
      }
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.licenseNumber !== undefined) data.licenseNumber = dto.licenseNumber || null;
      if (dto.addressLine1 !== undefined) data.addressLine1 = dto.addressLine1 || null;
      if (dto.addressLine2 !== undefined) data.addressLine2 = dto.addressLine2 || null;
      if (dto.city !== undefined) data.city = dto.city || null;
      if (dto.region !== undefined) data.region = dto.region || null;
      if (dto.postalCode !== undefined) data.postalCode = dto.postalCode || null;
      if (dto.country !== undefined) data.country = dto.country || null;
      if (dto.phone !== undefined) data.phone = dto.phone || null;
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
      case VerificationStatus.INFO_REQUESTED:
        targetReqStatus = VerificationRequestStatus.REQUEST_INFO;
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
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      city: p.city,
      region: p.region,
      postalCode: p.postalCode,
      country: p.country,
      phone: p.phone,
      status: p.verificationStatus,
      // Commercial standing is a separate axis from verification: a pharmacy can
      // be verified and still non-billable (ZM-COM-BILL-001 S-B1).
      commercialClassification: p.commercialClassification,
      availabilityScore: Math.round(p.reliabilityScore * 100),
      isParticipating: p.isParticipating,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}

