import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { UpdateOrganizationDto } from './update-organization.dto';

/**
 * The one row. Pinned by primary key and by a check constraint in the
 * migration, so "the organization" is never a question of which row won.
 */
const SINGLETON_ID = 'singleton';

/** What a fresh deployment answers with before anyone has saved anything. */
const DEFAULTS = {
  name: 'ZoikoMeds',
  slug: 'zoikomeds',
} as const;

export interface OrganizationProfile {
  name: string;
  slug: string;
  dataResidency: string | null;
  organizationType: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/**
 * The workspace's own profile (MSA-40).
 *
 * The settings page showed every super admin the same invented organization —
 * "Meridian Health Network", workspace id "org-meridian", residency "North
 * America (us-east)" — and its Save button had no handler, because there was
 * nothing in the schema to write to. Those values described no deployment, and
 * the residency line in particular is the kind of thing an operator repeats to
 * an auditor.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async get(): Promise<OrganizationProfile> {
    const row = await this.prisma.organization.findUnique({
      where: { id: SINGLETON_ID },
      include: { updatedBy: { select: { email: true } } },
    });

    // The migration seeds the row, so this is the case where a database was
    // built some other way. Answer with the defaults rather than a 404: the
    // page is asking "what is this workspace called", and "ZoikoMeds, nobody
    // has changed it" is the true answer.
    if (!row) {
      return {
        ...DEFAULTS,
        dataResidency: null,
        organizationType: null,
        updatedAt: null,
        updatedByEmail: null,
      };
    }

    return {
      name: row.name,
      slug: row.slug,
      dataResidency: row.dataResidency,
      organizationType: row.organizationType,
      updatedAt: row.updatedAt.toISOString(),
      updatedByEmail: row.updatedBy?.email ?? null,
    };
  }

  async update(
    actorId: string | null,
    dto: UpdateOrganizationDto,
    ipAddress?: string,
  ): Promise<OrganizationProfile> {
    const data = {
      // Only what was sent. A PATCH that omits a field must not blank it.
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.dataResidency !== undefined
        ? { dataResidency: dto.dataResidency.trim() || null }
        : {}),
      ...(dto.organizationType !== undefined
        ? { organizationType: dto.organizationType.trim() || null }
        : {}),
      updatedById: actorId,
    };

    // Upsert rather than update: a database that never ran the seed still saves
    // instead of answering "not found" to a button the operator just pressed.
    await this.prisma.organization.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: {
        id: SINGLETON_ID,
        name: DEFAULTS.name,
        slug: DEFAULTS.slug,
        ...data,
      },
    });

    // The slug is deliberately not writable here. It is the workspace's stable
    // external handle; renaming the organization must not change what it is.
    await this.audit.write(
      actorId,
      'admin.organization.update',
      'Organization',
      SINGLETON_ID,
      { fields: Object.keys(dto), module: 'Settings' },
      ipAddress,
    );

    return this.get();
  }
}
