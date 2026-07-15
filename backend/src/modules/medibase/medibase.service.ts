import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrescriptionCategory, Prisma, QualityState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MedibaseChangeLogWriter } from './medibase-changelog.writer';
import { buildDataDictionary } from './data-dictionary';
import { ParsedStrength } from './normalize';
import {
  IDENTIFIER_SYSTEMS,
  IdentifierSystemCode,
  isSupportedSystem,
  isValidIdentifier,
  normalizeIdentifier,
} from './identifier-systems';
import { assertTransition, isSuppressedState } from './quality-state';
import {
  expandVariants,
  parseDosageForm,
  parseStrength,
  scoreMatch,
} from './normalize';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { ListMedicinesQuery } from './dto/list-medicines.query';
import { TransitionStateDto } from './dto/transition-state.dto';
import { AddIdentifierDto } from './dto/add-identifier.dto';

const DEFAULT_MATCH_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 25;
// Size of the candidate pool pulled from the DB before in-memory re-ranking.
const CANDIDATE_POOL = 200;
// Minimum fuzzy score for a typo-tolerant fallback result to be surfaced.
const FUZZY_FLOOR = 0.55;

export interface MatchOptions {
  limit?: number;
  jurisdiction?: string;
  includeIdentifiers?: boolean;
}

/** Public-safe medicine projection — excludes internal governance fields. */
export interface PublicMedicine {
  id: string;
  canonicalName: string;
  genericName: string | null;
  brandNames: string[];
  manufacturer: string | null;
  description: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  presentation: string | null;
  atcCode: string | null;
  prescriptionCategory: PrescriptionCategory;
  qualityState: QualityState;
  isControlled: boolean;
  normalized: { strength: ParsedStrength[]; dosageForm: string | null };
  score?: number;
  identifiers?: Array<{ system: string; value: string; qualityState: QualityState }>;
}

/**
 * MediBase™ — governed medicine identity & normalization layer.
 *
 * Responsibilities:
 *  - Public matching/lookup of canonical medicine identities (suppressed hidden).
 *  - Normalization (name/brand/generic, strength/form, spelling variants).
 *  - External identifier mapping (NDC, RxCUI, GTIN, DIN, dm+d, ATC, EAN/UPC, local).
 *  - Governed quality-state lifecycle with a change-log per mutation.
 *
 * It does NOT provide clinical advice, substitution, prescribing, or dispensing
 * eligibility. Suppressed entities are NEVER returned on public surfaces.
 */
@Injectable()
export class MedibaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLog: MedibaseChangeLogWriter,
  ) {}

  // === Public surface ======================================================

  /**
   * Normalize a free-text query into ranked candidate canonical entities.
   * Applies spelling-variant expansion + fuzzy re-ranking; suppressed entities
   * are excluded. Signature is back-compatible with a bare `matchMedicines(q)`.
   */
  async matchMedicines(query: string, options: MatchOptions = {}) {
    const q = (query ?? '').trim();
    if (!q) return [];

    const limit = options.limit ?? DEFAULT_MATCH_LIMIT;
    const variants = expandVariants(q);

    const jurisdictionFilter = options.jurisdiction
      ? {
          OR: [
            { jurisdiction: { code: options.jurisdiction } },
            { jurisdictionId: null },
          ],
        }
      : {};

    // Prefilter: any variant appearing in a name/brand field.
    const nameFilter: Prisma.MedicineEntityWhereInput = {
      OR: variants.flatMap((v) => [
        { canonicalName: { contains: v, mode: 'insensitive' as const } },
        { genericName: { contains: v, mode: 'insensitive' as const } },
        { brandNames: { has: v } },
      ]),
    };

    let pool = await this.prisma.medicineEntity.findMany({
      where: { isSuppressed: false, AND: [jurisdictionFilter, nameFilter] },
      take: CANDIDATE_POOL,
      include: options.includeIdentifiers ? { identifiers: true } : undefined,
    });

    // Typo-tolerant fallback: nothing matched the prefilter, so pull a bounded
    // pool and fuzzy-rank it.
    let fuzzyFallback = false;
    if (pool.length === 0 && q.length >= 3) {
      fuzzyFallback = true;
      pool = await this.prisma.medicineEntity.findMany({
        where: { isSuppressed: false, ...jurisdictionFilter },
        take: CANDIDATE_POOL,
        include: options.includeIdentifiers ? { identifiers: true } : undefined,
      });
    }

    const ranked = pool
      .map((m) => ({ m, score: scoreMatch(q, m) }))
      .filter((r) => (fuzzyFallback ? r.score >= FUZZY_FLOOR : r.score > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return ranked.map((r) =>
      this.toPublicMedicine(r.m, {
        score: r.score,
        includeIdentifiers: options.includeIdentifiers,
      }),
    );
  }

  /** Public lookup by canonical id. Suppressed entities are hidden (404). */
  async findById(id: string) {
    const medicine = await this.prisma.medicineEntity.findFirst({
      where: { id, isSuppressed: false },
      include: { identifiers: true },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');
    return this.toPublicMedicine(medicine, { includeIdentifiers: true });
  }

  /** Public lookup by an external identifier (e.g. RxCUI, GTIN). */
  async lookupByIdentifier(system: string, value: string) {
    if (!isSupportedSystem(system)) {
      throw new BadRequestException(`Unsupported identifier system: ${system}`);
    }
    const code = system as IdentifierSystemCode;
    if (!isValidIdentifier(code, value)) {
      throw new BadRequestException(
        `Value is not a well-formed ${IDENTIFIER_SYSTEMS[code].label}`,
      );
    }
    const normalized = normalizeIdentifier(code, value);

    const mapping = await this.prisma.identifierMapping.findFirst({
      where: { system: code, value: normalized, medicine: { isSuppressed: false } },
      include: { medicine: { include: { identifiers: true } } },
    });
    if (!mapping) throw new NotFoundException('No medicine mapped to that identifier');
    return this.toPublicMedicine(mapping.medicine, { includeIdentifiers: true });
  }

  /** Read-only MediBase data dictionary (contract description). */
  dataDictionary() {
    return buildDataDictionary();
  }

  // === Admin / curation surface ===========================================

  async listForAdmin(query: ListMedicinesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.MedicineEntityWhereInput = {};
    if (!query.includeSuppressed) where.isSuppressed = false;
    if (query.qualityState) where.qualityState = query.qualityState;
    if (query.prescriptionCategory) {
      where.prescriptionCategory = query.prescriptionCategory;
    }
    if (query.jurisdiction) where.jurisdiction = { code: query.jurisdiction };
    if (query.search) {
      where.OR = [
        { canonicalName: { contains: query.search, mode: 'insensitive' } },
        { genericName: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
        { brandNames: { has: query.search } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.medicineEntity.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { identifiers: true },
      }),
      this.prisma.medicineEntity.count({ where }),
    ]);

    return {
      items: items.map((m) => this.toAdminMedicine(m)),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getForAdmin(id: string) {
    const medicine = await this.prisma.medicineEntity.findUnique({
      where: { id },
      include: {
        identifiers: true,
        jurisdiction: { select: { code: true, name: true } },
      },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');
    return this.toAdminMedicine(medicine);
  }

  async create(actorId: string, dto: CreateMedicineDto) {
    const qualityState = dto.qualityState ?? QualityState.NEEDS_REVIEW;

    // Validate & normalize any attached identifiers up front.
    const identifierData = (dto.identifiers ?? []).map((i) =>
      this.buildIdentifierData(i),
    );

    const medicine = await this.prisma.medicineEntity.create({
      data: {
        canonicalName: dto.canonicalName,
        genericName: dto.genericName ?? null,
        brandNames: dto.brandNames ?? [],
        manufacturer: dto.manufacturer ?? null,
        description: dto.description ?? null,
        activeIngredient: dto.activeIngredient ?? null,
        strength: dto.strength ?? null,
        dosageForm: dto.dosageForm ? parseDosageForm(dto.dosageForm) ?? dto.dosageForm : null,
        route: dto.route ?? null,
        presentation: dto.presentation ?? null,
        atcCode: dto.atcCode ?? null,
        prescriptionCategory: dto.prescriptionCategory ?? 'UNKNOWN',
        qualityState,
        isControlled: dto.isControlled ?? false,
        isSuppressed: isSuppressedState(qualityState),
        jurisdictionId: dto.jurisdictionId ?? null,
        identifiers: identifierData.length
          ? { create: identifierData }
          : undefined,
      },
      include: { identifiers: true },
    });

    await this.changeLog.record(actorId, medicine.id, {
      action: 'create',
      newValue: { canonicalName: medicine.canonicalName, qualityState },
      schemaVersion: medicine.schemaVersion,
    });

    return this.toAdminMedicine(medicine);
  }

  async update(actorId: string, id: string, dto: UpdateMedicineDto) {
    const existing = await this.requireMedicine(id);

    const data: Prisma.MedicineEntityUpdateInput = {};
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

    const set = <K extends keyof UpdateMedicineDto>(
      field: K,
      current: unknown,
      transform?: (v: NonNullable<UpdateMedicineDto[K]>) => unknown,
    ) => {
      if (dto[field] === undefined) return;
      const raw = dto[field] as NonNullable<UpdateMedicineDto[K]>;
      const next = transform ? transform(raw) : raw;
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      (data as Record<string, unknown>)[field as string] = next;
      changes.push({ field: field as string, from: current, to: next });
    };

    set('canonicalName', existing.canonicalName);
    set('genericName', existing.genericName, (v) => v || null);
    set('brandNames', existing.brandNames);
    set('manufacturer', existing.manufacturer, (v) => v || null);
    set('description', existing.description, (v) => v || null);
    set('activeIngredient', existing.activeIngredient, (v) => v || null);
    set('strength', existing.strength, (v) => v || null);
    set('dosageForm', existing.dosageForm, (v) => parseDosageForm(v) ?? v);
    set('route', existing.route, (v) => v || null);
    set('presentation', existing.presentation, (v) => v || null);
    set('atcCode', existing.atcCode, (v) => v || null);
    set('prescriptionCategory', existing.prescriptionCategory);
    set('isControlled', existing.isControlled);
    set('jurisdictionId', existing.jurisdictionId, (v) => v || null);

    if (changes.length === 0) {
      return this.toAdminMedicine(
        await this.prisma.medicineEntity.findUniqueOrThrow({
          where: { id },
          include: { identifiers: true },
        }),
      );
    }

    const medicine = await this.prisma.medicineEntity.update({
      where: { id },
      data,
      include: { identifiers: true },
    });

    // One change-log entry per field for a precise lineage trail.
    for (const c of changes) {
      await this.changeLog.record(actorId, id, {
        action: 'update',
        field: c.field,
        previousValue: c.from as Prisma.InputJsonValue,
        newValue: c.to as Prisma.InputJsonValue,
        schemaVersion: medicine.schemaVersion,
      });
    }

    return this.toAdminMedicine(medicine);
  }

  async transitionState(actorId: string, id: string, dto: TransitionStateDto) {
    const existing = await this.requireMedicine(id);
    const from = existing.qualityState;
    const to = dto.toState;

    assertTransition(from, to);
    if (from === to) return this.toAdminMedicine(existing);

    const medicine = await this.prisma.medicineEntity.update({
      where: { id },
      data: { qualityState: to, isSuppressed: isSuppressedState(to) },
      include: { identifiers: true },
    });

    await this.changeLog.record(actorId, id, {
      action: 'state_transition',
      field: 'qualityState',
      fromState: from,
      toState: to,
      note: dto.note,
      schemaVersion: medicine.schemaVersion,
    });

    return this.toAdminMedicine(medicine);
  }

  async addIdentifier(actorId: string, id: string, dto: AddIdentifierDto) {
    await this.requireMedicine(id);
    const identifierData = this.buildIdentifierData(dto);

    try {
      await this.prisma.identifierMapping.create({
        data: { medicineId: id, ...identifierData },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'That identifier is already mapped to this medicine',
        );
      }
      throw err;
    }

    await this.changeLog.record(actorId, id, {
      action: 'identifier.add',
      field: 'identifiers',
      newValue: { system: identifierData.system, value: identifierData.value },
    });

    return this.getForAdmin(id);
  }

  async removeIdentifier(actorId: string, id: string, identifierId: string) {
    const identifier = await this.prisma.identifierMapping.findFirst({
      where: { id: identifierId, medicineId: id },
    });
    if (!identifier) throw new NotFoundException('Identifier mapping not found');

    await this.prisma.identifierMapping.delete({ where: { id: identifierId } });

    await this.changeLog.record(actorId, id, {
      action: 'identifier.remove',
      field: 'identifiers',
      previousValue: { system: identifier.system, value: identifier.value },
    });

    return this.getForAdmin(id);
  }

  async listChangeLog(id: string, page = 1, pageSize = 50) {
    await this.requireMedicine(id);
    const size = Math.min(Math.max(pageSize, 1), 200);
    const [items, total] = await Promise.all([
      this.prisma.medicineChangeLog.findMany({
        where: { medicineId: id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.medicineChangeLog.count({ where: { medicineId: id } }),
    ]);
    return {
      items,
      total,
      page,
      pageSize: size,
      pageCount: Math.max(1, Math.ceil(total / size)),
    };
  }

  // === Helpers =============================================================

  private async requireMedicine(id: string) {
    const medicine = await this.prisma.medicineEntity.findUnique({
      where: { id },
      include: { identifiers: true },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');
    return medicine;
  }

  private buildIdentifierData(dto: AddIdentifierDto) {
    const code = dto.system as IdentifierSystemCode;
    if (!isValidIdentifier(code, dto.value)) {
      throw new BadRequestException(
        `Value is not a well-formed ${IDENTIFIER_SYSTEMS[code].label}`,
      );
    }
    return {
      system: code,
      value: normalizeIdentifier(code, dto.value),
      source: dto.source ?? null,
      licenseScope: dto.licenseScope ?? null,
      qualityState: dto.qualityState ?? QualityState.MAPPED,
    };
  }

  /** Public-safe projection. Excludes internal-only governance fields. */
  private toPublicMedicine(
    m: any,
    opts: { score?: number; includeIdentifiers?: boolean } = {},
  ): PublicMedicine {
    const result: PublicMedicine = {
      id: m.id,
      canonicalName: m.canonicalName,
      genericName: m.genericName,
      brandNames: m.brandNames,
      manufacturer: m.manufacturer,
      description: m.description,
      activeIngredient: m.activeIngredient,
      strength: m.strength,
      dosageForm: m.dosageForm,
      route: m.route,
      presentation: m.presentation,
      atcCode: m.atcCode,
      prescriptionCategory: m.prescriptionCategory,
      qualityState: m.qualityState,
      isControlled: m.isControlled,
      normalized: {
        strength: m.strength ? parseStrength(m.strength) : [],
        dosageForm: m.dosageForm ? parseDosageForm(m.dosageForm) : null,
      },
    };
    if (opts.score !== undefined) result.score = opts.score;
    if (opts.includeIdentifiers && Array.isArray(m.identifiers)) {
      result.identifiers = m.identifiers.map((i: any) => ({
        system: i.system,
        value: i.value,
        qualityState: i.qualityState,
      }));
    }
    return result;
  }

  /** Full curation projection for admin surfaces (includes governance fields). */
  private toAdminMedicine(m: any) {
    return {
      id: m.id,
      canonicalName: m.canonicalName,
      genericName: m.genericName,
      brandNames: m.brandNames,
      manufacturer: m.manufacturer,
      description: m.description,
      activeIngredient: m.activeIngredient,
      strength: m.strength,
      dosageForm: m.dosageForm,
      route: m.route,
      presentation: m.presentation,
      atcCode: m.atcCode,
      prescriptionCategory: m.prescriptionCategory,
      qualityState: m.qualityState,
      isControlled: m.isControlled,
      isSuppressed: m.isSuppressed,
      schemaVersion: m.schemaVersion,
      jurisdictionId: m.jurisdictionId,
      jurisdiction: m.jurisdiction ?? undefined,
      identifiers: Array.isArray(m.identifiers)
        ? m.identifiers.map((i: any) => ({
            id: i.id,
            system: i.system,
            value: i.value,
            qualityState: i.qualityState,
            source: i.source,
            licenseScope: i.licenseScope,
            createdAt: i.createdAt,
          }))
        : [],
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
}
