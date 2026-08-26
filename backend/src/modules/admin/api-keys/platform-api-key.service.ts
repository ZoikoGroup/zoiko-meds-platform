import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';

/**
 * What a key may read. Kept small and closed: a scope nobody enforces is a
 * label, and the console must not offer one the API does not honour.
 */
export const API_KEY_SCOPES = ['availability', 'medibase', 'signal'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const KEY_PREFIX = 'zav_';
/** Enough of the key to tell two apart in a list, never enough to use one. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;

const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface PlatformApiKeyView {
  id: string;
  label: string;
  scope: string;
  /** `zav_1a2b3c…` — display only. */
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked';
}

/**
 * Scoped keys for the ZoikoAvail availability API (MSA-41 follow-up).
 *
 * The settings page listed three invented keys from a frontend fixture, with
 * Reveal, Rotate and Revoke behind them that had no handlers — and no endpoint
 * to have handlers for. There was no key model anywhere in the schema.
 *
 * "Reveal" is not among the actions here and cannot be: only the hash is stored,
 * so a key exists in the open exactly once, when it is issued. Offering to show
 * it again would be offering something the design deliberately gives up.
 */
@Injectable()
export class PlatformApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  private toView(row: {
    id: string;
    label: string;
    scope: string;
    keyPrefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdBy?: { fullName: string } | null;
  }): PlatformApiKeyView {
    return {
      id: row.id,
      label: row.label,
      scope: row.scope,
      prefix: row.keyPrefix,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy?.fullName ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status: row.revokedAt ? 'revoked' : 'active',
    };
  }

  async list(): Promise<PlatformApiKeyView[]> {
    const rows = await this.prisma.platformApiKey.findMany({
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      include: { createdBy: { select: { fullName: true } } },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Issue a key. The raw value is returned here and nowhere else, ever.
   */
  async create(
    actorId: string | null,
    label: string,
    scope: string,
    ipAddress?: string,
  ): Promise<{ apiKey: string; key: PlatformApiKeyView }> {
    if (!API_KEY_SCOPES.includes(scope as ApiKeyScope)) {
      throw new BadRequestException(
        `Scope must be one of: ${API_KEY_SCOPES.join(', ')}`,
      );
    }

    const raw = `${KEY_PREFIX}${randomBytes(24).toString('hex')}`;
    const row = await this.prisma.platformApiKey.create({
      data: {
        label: label.trim(),
        scope,
        keyHash: hashKey(raw),
        keyPrefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
        createdById: actorId,
      },
      include: { createdBy: { select: { fullName: true } } },
    });

    await this.audit.write(
      actorId,
      'admin.api_key.create',
      'PlatformApiKey',
      row.id,
      { label: row.label, scope, module: 'Settings' },
      ipAddress,
    );

    return { apiKey: raw, key: this.toView(row) };
  }

  /**
   * Revoke a key, which stops it working immediately.
   *
   * The row stays. A revoked key still has to be nameable in the audit trail,
   * and its hash must stay claimed so the same value can never be issued twice.
   */
  async revoke(
    actorId: string | null,
    id: string,
    ipAddress?: string,
  ): Promise<PlatformApiKeyView> {
    const existing = await this.prisma.platformApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API key not found');
    if (existing.revokedAt) {
      throw new BadRequestException('That key is already revoked.');
    }

    const row = await this.prisma.platformApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      include: { createdBy: { select: { fullName: true } } },
    });

    await this.audit.write(
      actorId,
      'admin.api_key.revoke',
      'PlatformApiKey',
      id,
      { label: row.label, scope: row.scope, module: 'Settings' },
      ipAddress,
    );

    return this.toView(row);
  }

  /**
   * Resolve a presented key, for whatever eventually authenticates with one.
   *
   * Looks up by hash, so the raw value is never compared against anything
   * stored. A revoked key resolves to null, which is the same answer as a key
   * that never existed.
   */
  async resolve(raw: string | undefined): Promise<{ id: string; scope: string } | null> {
    if (!raw) return null;
    const row = await this.prisma.platformApiKey.findUnique({
      where: { keyHash: hashKey(raw) },
      select: { id: true, scope: true, revokedAt: true },
    });
    if (!row || row.revokedAt) return null;

    // Recorded so the console can distinguish a key carrying traffic from one
    // issued and forgotten. Not awaited: a failed bookkeeping write must not
    // fail the request that was otherwise authorised.
    void this.prisma.platformApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return { id: row.id, scope: row.scope };
  }
}
