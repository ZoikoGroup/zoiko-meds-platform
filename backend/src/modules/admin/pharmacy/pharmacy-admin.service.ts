import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pharmacy, Prisma, VerificationRequestStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { assertLocationIsFree } from '../../pharmacy/location-identity';
import { resolveCountryAlpha2 } from '../../../common/countries';
import { resolveJurisdictionId } from '../../../common/jurisdiction';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { ListPharmaciesQuery } from './dto/list-pharmacies.query';

const DEFAULT_PAGE_SIZE = 50;

/** The canonical location every pharmacy DTO carries alongside its raw `country` text. */
const JURISDICTION_INCLUDE = { jurisdiction: { select: { code: true, name: true } } } as const;

@Injectable()
export class PharmacyAdminService {
  private readonly logger = new Logger(PharmacyAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly nearby: NearbyPharmacyService,
  ) {}

  /**
   * Coordinates for a pharmacy, preferring what the admin supplied and falling
   * back to geocoding the pharmacy's own street address.
   *
   * A pharmacy with no coordinates is invisible to every distance-bounded
   * patient search, so registering one by address alone silently produced a
   * record that could never be found. Geocoding failure is non-fatal — the
   * record is still saved, just not yet locatable.
   *
   * Two rules make the result the pharmacy's real position rather than a
   * plausible-looking one:
   *
   *  - the whole address is geocoded, not [city, country]. Geocoding a city
   *    returns its centroid, so every pharmacy registered in Hyderabad landed
   *    on the same point, at the same distance from every patient, with nothing
   *    to tell them apart on the map;
   *  - an area-level match is discarded rather than stored. No coordinates is a
   *    true statement ("not located yet", and the admin can supply the pin);
   *    a city centre is a false one.
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
    if (!point) return null;

    if (!point.precise) {
      this.logger.warn(
        `Geocoding "${query}" resolved only to ${point.granularity} — refusing to ` +
          'store an area centroid as a pharmacy location. Supply the street ' +
          'address or the exact coordinates.',
      );
      return null;
    }
    return { latitude: point.lat, longitude: point.lng };
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
        include: JURISDICTION_INCLUDE,
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
    const coords = await this.resolveCoordinates(dto, [
      dto.addressLine1,
      dto.addressLine2,
      dto.city,
      dto.region,
      dto.postalCode,
      dto.country,
    ]);

    // One physical pharmacy, one record — checked before the insert so the
    // duplicate is never created rather than cleaned up afterwards.
    if (coords) {
      await assertLocationIsFree(this.prisma, {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    }

    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const jurisdictionId = await resolveJurisdictionId(tx, resolveCountryAlpha2(dto.country));
      const created = await tx.pharmacy.create({
        data: {
          name: dto.name,
          licenseNumber: dto.licenseNumber || null,
          addressLine1: dto.addressLine1 || null,
          addressLine2: dto.addressLine2 || null,
          city: dto.city || null,
          region: dto.region || null,
          postalCode: dto.postalCode || null,
          country: dto.country || null,
          jurisdictionId,
          // The branch's own number. Patient search offers it as the one action
          // the governance note asks for — confirm before travelling.
          phone: dto.phone || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          reliabilityScore: (dto.availabilityScore ?? 100) / 100,
          verificationStatus: VerificationStatus.PENDING,
        },
        include: JURISDICTION_INCLUDE,
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

    // Moving a pharmacy onto another's premises makes the same duplicate a
    // fresh registration would. Itself excluded, so re-saving an unchanged
    // location is never blocked.
    if (coords) {
      await assertLocationIsFree(this.prisma, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        excludeId: id,
      });
    }

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
      if (dto.country !== undefined) {
        data.country = dto.country || null;
        // Re-resolved only when the country itself is part of this edit — an
        // edit to, say, the phone number alone must not spend a write
        // re-deriving a jurisdiction nothing about this save is changing.
        const jurisdictionId = await resolveJurisdictionId(tx, resolveCountryAlpha2(dto.country));
        data.jurisdiction = jurisdictionId
          ? { connect: { id: jurisdictionId } }
          : { disconnect: true };
      }
      if (dto.phone !== undefined) data.phone = dto.phone || null;
      if (dto.availabilityScore !== undefined) {
        data.reliabilityScore = dto.availabilityScore / 100;
      }
      if (dto.verificationStatus !== undefined) {
        data.verificationStatus = dto.verificationStatus;
        data.isParticipating = dto.verificationStatus === VerificationStatus.VERIFIED;
      }

      const updated = await tx.pharmacy.update({ where: { id }, data, include: JURISDICTION_INCLUDE });

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
        include: JURISDICTION_INCLUDE,
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

  private async require(id: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id },
      include: JURISDICTION_INCLUDE,
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return pharmacy;
  }

  private toDto(p: Pharmacy & { jurisdiction?: { code: string; name: string } | null }) {
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
      // The canonical location (MSA-32): `country` is free text a person typed
      // ("India" / "india" / "IN" all describe the same one), so a filter or
      // grouping built from it directly shows every spelling as its own
      // location. This is the same Jurisdiction a pharmacy's country already
      // resolves to on save — one entry per real place, however its country
      // field happens to be spelled.
      jurisdiction: p.jurisdiction ? { code: p.jurisdiction.code, name: p.jurisdiction.name } : null,
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

