import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IntegrationDirection,
  IntegrationSyncStatus,
  PharmacyIntegration,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { open, seal } from '../../../common/secret-box';
import { PharmacyService } from '../pharmacy.service';
import { SaveIntegrationDto } from '../dto/save-integration.dto';
import { assertFetchable, fetchFeed, MAX_FEED_ROWS, parseCsv } from './feed';

/**
 * The pharmacy portal's Integration page, made real.
 *
 * A sync deliberately adds no new way to write stock: it resolves rows — from
 * the pharmacy's feed in PULL mode, from the request body in PUSH mode — and
 * hands them to PharmacyService.importCsv, the same call the Uploads tab makes.
 * An integrated pharmacy and one uploading a CSV by hand therefore produce
 * identical AvailabilitySignal rows, raise the same patient alerts, and land in
 * the same audit trail. Everything specific to integration lives here: the
 * schedule, the credentials, and the history of attempts.
 */

/** Bounds on the operator-set schedule. Below the floor a feed is a DoS on itself. */
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 24 * 60;

/**
 * A run that has held the lock this long is presumed dead — a process killed
 * mid-sync would otherwise leave the feed permanently "syncing" with no way
 * back short of a database edit.
 */
export const STALE_LOCK_MS = 30 * 60 * 1000;

/** How many attempts the portal shows. Older rows stay in the table. */
const HISTORY_LIMIT = 20;

const API_KEY_PREFIX = 'zmk_';

export type SyncTrigger = 'manual' | 'scheduled' | 'push';

export interface SyncOutcome {
  status: IntegrationSyncStatus;
  rows: number;
  imported: number;
  updated: number;
  skipped: number;
  note: string;
}

export const hashApiKey = (raw: string) =>
  createHash('sha256').update(raw).digest('hex');

@Injectable()
export class PharmacyIntegrationService {
  private readonly logger = new Logger(PharmacyIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pharmacy: PharmacyService,
    private readonly audit: AuditWriter,
  ) {}

  // --- Reads ---------------------------------------------------------------

  /**
   * The whole page in one payload. A pharmacy with no feed configured gets
   * `connected: false` and nothing invented around it — the page then shows the
   * connect form rather than a sample vendor.
   */
  async getIntegration(pharmacyId: string) {
    const integration = await this.prisma.pharmacyIntegration.findUnique({
      where: { pharmacyId },
    });

    if (!integration) {
      return {
        connected: false,
        provider: null,
        direction: IntegrationDirection.PULL,
        enabled: false,
        feedUrl: null,
        authHeaderName: null,
        hasAuthHeader: false,
        syncMode: 'merge',
        intervalMinutes: 60,
        apiKeyPrefix: null,
        apiKeyIssuedAt: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        nextSyncAt: null,
        syncing: false,
        history: [],
      };
    }

    const history = await this.prisma.pharmacySyncRun.findMany({
      where: { integrationId: integration.id },
      orderBy: { startedAt: 'desc' },
      take: HISTORY_LIMIT,
    });

    return {
      ...this.toView(integration),
      history: history.map((run) => ({
        id: run.id,
        status: run.status.toLowerCase(),
        trigger: run.trigger,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        rows: run.rows,
        imported: run.imported,
        updated: run.updated,
        skipped: run.skipped,
        note: run.note || '',
      })),
    };
  }

  /**
   * Configuration as the portal may see it. The auth header value never appears
   * here in any form — the page is told only whether one is set, because a
   * masked secret is still a secret that left the server.
   */
  private toView(integration: PharmacyIntegration) {
    return {
      connected: true,
      provider: integration.provider,
      direction: integration.direction,
      enabled: integration.enabled,
      feedUrl: integration.feedUrl,
      authHeaderName: integration.authHeaderName,
      hasAuthHeader: !!integration.authHeaderSecret,
      syncMode: integration.syncMode,
      intervalMinutes: integration.intervalMinutes,
      apiKeyPrefix: integration.apiKeyPrefix,
      apiKeyIssuedAt: integration.apiKeyIssuedAt?.toISOString() ?? null,
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: integration.lastSyncStatus
        ? integration.lastSyncStatus.toLowerCase()
        : null,
      nextSyncAt: integration.nextSyncAt?.toISOString() ?? null,
      syncing: this.isLocked(integration),
    };
  }

  private isLocked(integration: PharmacyIntegration) {
    if (!integration.syncingSince) return false;
    return Date.now() - integration.syncingSince.getTime() < STALE_LOCK_MS;
  }

  // --- Configuration -------------------------------------------------------

  /**
   * Create or update the feed. Validation that depends on the mode lives here
   * rather than in the DTO: a PULL feed needs a URL, a PUSH feed must not carry
   * one, and neither rule can be expressed on a single field in isolation.
   */
  async saveIntegration(
    pharmacyId: string,
    dto: SaveIntegrationDto,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const direction =
      dto.direction === IntegrationDirection.PUSH
        ? IntegrationDirection.PUSH
        : IntegrationDirection.PULL;

    const existing = await this.prisma.pharmacyIntegration.findUnique({
      where: { pharmacyId },
    });

    const feedUrl = (dto.feedUrl || '').trim();
    if (direction === IntegrationDirection.PULL) {
      if (!feedUrl) {
        throw new BadRequestException(
          'A pull integration needs the URL ZoikoMeds should fetch your stock file from.',
        );
      }
      // Checked at save time, not only at sync time, so a typo is refused while
      // the operator is still looking at the field that caused it.
      await assertFetchable(feedUrl);
    }

    const intervalMinutes = dto.intervalMinutes ?? existing?.intervalMinutes ?? 60;
    if (
      intervalMinutes < MIN_INTERVAL_MINUTES ||
      intervalMinutes > MAX_INTERVAL_MINUTES
    ) {
      throw new BadRequestException(
        `Sync interval must be between ${MIN_INTERVAL_MINUTES} minutes and ${MAX_INTERVAL_MINUTES / 60} hours.`,
      );
    }

    const enabled = dto.enabled ?? existing?.enabled ?? true;
    const syncMode = dto.syncMode === 'replace' ? 'replace' : 'merge';

    // An omitted header value keeps whatever is stored; an empty string clears
    // it. Without that distinction the portal could not re-save the form
    // without either re-typing the credential or silently wiping it.
    let authHeaderSecret = existing?.authHeaderSecret ?? null;
    if (dto.authHeaderValue !== undefined) {
      authHeaderSecret = dto.authHeaderValue ? seal(dto.authHeaderValue) : null;
    }
    const authHeaderName =
      dto.authHeaderName !== undefined
        ? dto.authHeaderName || null
        : (existing?.authHeaderName ?? null);
    if (authHeaderSecret && !authHeaderName) {
      throw new BadRequestException(
        'Name the header the feed expects (for example "Authorization") alongside its value.',
      );
    }

    const data = {
      provider: dto.provider.trim(),
      direction,
      enabled,
      feedUrl: direction === IntegrationDirection.PULL ? feedUrl : null,
      authHeaderName: direction === IntegrationDirection.PULL ? authHeaderName : null,
      authHeaderSecret:
        direction === IntegrationDirection.PULL ? authHeaderSecret : null,
      syncMode,
      intervalMinutes,
      nextSyncAt:
        direction === IntegrationDirection.PULL && enabled
          ? this.scheduleAfterSave(existing, intervalMinutes)
          : null,
    };

    const saved = await this.prisma.pharmacyIntegration.upsert({
      where: { pharmacyId },
      create: { pharmacyId, ...data },
      update: data,
    });

    await this.audit.write(
      user?.id ?? null,
      existing ? 'pharmacy.integration.update' : 'pharmacy.integration.connect',
      'Pharmacy Integration',
      saved.id,
      {
        pharmacyId,
        provider: saved.provider,
        direction: saved.direction,
        // The URL is operational detail, not a credential; the header value is
        // a credential and is never written to the audit trail.
        feedUrl: saved.feedUrl,
        syncMode: saved.syncMode,
        intervalMinutes: saved.intervalMinutes,
        enabled: saved.enabled,
        module: 'Integration',
      },
      ipAddress,
    );

    return this.getIntegration(pharmacyId);
  }

  /**
   * When the next run should happen after the configuration is saved.
   *
   * A new or newly-resumed feed is due immediately, so connecting produces data
   * without the operator having to press anything. A changed interval is
   * re-measured from the last run rather than left on the old clock — shortening
   * a daily feed to every 15 minutes and then waiting a day for the first one
   * reads as the setting having been ignored.
   */
  private scheduleAfterSave(
    existing: PharmacyIntegration | null,
    intervalMinutes: number,
  ): Date {
    const now = new Date();
    if (!existing || !existing.nextSyncAt) return now;
    if (existing.intervalMinutes === intervalMinutes) return existing.nextSyncAt;
    if (!existing.lastSyncAt) return now;
    const rescheduled = new Date(
      existing.lastSyncAt.getTime() + intervalMinutes * 60_000,
    );
    return rescheduled < now ? now : rescheduled;
  }

  /**
   * Remove the feed. The history goes with it (cascade) — it describes a
   * connection that no longer exists, and keeping it would leave the page
   * showing runs for a provider the pharmacy has disconnected.
   */
  async disconnect(
    pharmacyId: string,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.pharmacyIntegration.findUnique({
      where: { pharmacyId },
    });
    if (!existing) {
      throw new NotFoundException('No integration is configured for this pharmacy.');
    }

    await this.prisma.pharmacyIntegration.delete({ where: { pharmacyId } });

    await this.audit.write(
      user?.id ?? null,
      'pharmacy.integration.disconnect',
      'Pharmacy Integration',
      existing.id,
      {
        pharmacyId,
        provider: existing.provider,
        direction: existing.direction,
        module: 'Integration',
      },
      ipAddress,
    );

    // Stock already imported is left alone on purpose: it is the pharmacy's own
    // data, and disconnecting a feed is not a statement that its shelves are empty.
    return this.getIntegration(pharmacyId);
  }

  /**
   * Issue (or rotate) the push key. Returned in full exactly once — only its
   * hash is stored, so a lost key is replaced, never recovered.
   */
  async issueApiKey(
    pharmacyId: string,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const integration = await this.prisma.pharmacyIntegration.findUnique({
      where: { pharmacyId },
    });
    if (!integration) {
      throw new NotFoundException(
        'Set up the integration first, then issue a key for it.',
      );
    }

    const raw = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
    await this.prisma.pharmacyIntegration.update({
      where: { pharmacyId },
      data: {
        apiKeyHash: hashApiKey(raw),
        apiKeyPrefix: raw.slice(0, API_KEY_PREFIX.length + 6),
        apiKeyIssuedAt: new Date(),
      },
    });

    await this.audit.write(
      user?.id ?? null,
      integration.apiKeyHash
        ? 'pharmacy.integration.key.rotate'
        : 'pharmacy.integration.key.issue',
      'Pharmacy Integration',
      integration.id,
      { pharmacyId, provider: integration.provider, module: 'Integration' },
      ipAddress,
    );

    return { apiKey: raw, integration: await this.getIntegration(pharmacyId) };
  }

  // --- Syncing -------------------------------------------------------------

  /** "Sync now" from the portal. Runs inline so the page can report the result. */
  async syncNow(
    pharmacyId: string,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const integration = await this.prisma.pharmacyIntegration.findUnique({
      where: { pharmacyId },
    });
    if (!integration) {
      throw new NotFoundException(
        'No integration is configured. Connect your POS or ERP first.',
      );
    }
    if (integration.direction === IntegrationDirection.PUSH) {
      throw new BadRequestException(
        'This is a push integration: ZoikoMeds cannot pull from it. Your system posts stock to /pharmacies/integration/push when it has an update.',
      );
    }

    const claimed = await this.claim(integration.id);
    if (!claimed) {
      throw new BadRequestException('A sync is already running for this pharmacy.');
    }

    await this.runPull(claimed, 'manual', user, ipAddress);
    return this.getIntegration(pharmacyId);
  }

  /**
   * Take the run lock. A conditional update rather than a read-then-write: two
   * API instances polling the same database would otherwise both see an idle
   * feed and sync it twice.
   */
  private async claim(integrationId: string): Promise<PharmacyIntegration | null> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const { count } = await this.prisma.pharmacyIntegration.updateMany({
      where: {
        id: integrationId,
        OR: [{ syncingSince: null }, { syncingSince: { lt: staleBefore } }],
      },
      data: { syncingSince: new Date() },
    });
    if (count === 0) return null;
    return this.prisma.pharmacyIntegration.findUnique({ where: { id: integrationId } });
  }

  /**
   * Fetch the feed and import it, recording the attempt either way.
   *
   * Never throws: a failed sync is a row in the history with the reason on it,
   * which is what the operator needs, and on the scheduled path there is nobody
   * to throw to anyway.
   */
  private async runPull(
    integration: PharmacyIntegration,
    trigger: SyncTrigger,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<SyncOutcome> {
    const startedAt = new Date();
    let outcome: SyncOutcome;

    try {
      const { rows } = await fetchFeed(
        integration.feedUrl as string,
        integration.authHeaderName,
        open(integration.authHeaderSecret),
      );
      outcome = await this.importRows(
        integration,
        rows,
        trigger,
        user,
        ipAddress,
      );
    } catch (err) {
      outcome = {
        status: IntegrationSyncStatus.FAILED,
        rows: 0,
        imported: 0,
        updated: 0,
        skipped: 0,
        note: this.reasonFor(err),
      };
      this.logger.warn(
        `Sync failed for pharmacy ${integration.pharmacyId} (${trigger}): ${outcome.note}`,
      );
    }

    await this.finish(integration, outcome, trigger, startedAt);
    return outcome;
  }

  /**
   * Hand rows to the inventory importer and grade the result.
   *
   * PARTIAL rather than SUCCESS whenever the importer skipped anything: a feed
   * that silently drops a quarter of its rows every hour is the failure mode
   * this page exists to make visible.
   */
  private async importRows(
    integration: PharmacyIntegration,
    rows: Record<string, string>[],
    trigger: SyncTrigger,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<SyncOutcome> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('The feed contained no medicine rows.');
    }
    if (rows.length > MAX_FEED_ROWS) {
      throw new BadRequestException(
        `The feed has ${rows.length} rows; the limit is ${MAX_FEED_ROWS} per sync.`,
      );
    }

    const mode = integration.syncMode === 'replace' ? 'replace' : 'merge';
    const result = await this.pharmacy.importCsv(
      integration.pharmacyId,
      rows,
      mode,
      user,
      ipAddress,
    );

    const partial = result.skipped > 0;
    const label = mode === 'replace' ? 'Full sync' : 'Delta sync';
    return {
      status: partial ? IntegrationSyncStatus.PARTIAL : IntegrationSyncStatus.SUCCESS,
      rows: result.totalProcessed,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      note: partial
        ? `${label} — ${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped`
        : `${label} via ${trigger === 'push' ? 'push' : 'feed'}`,
    };
  }

  /** Write the history row, release the lock, and schedule the next attempt. */
  private async finish(
    integration: PharmacyIntegration,
    outcome: SyncOutcome,
    trigger: SyncTrigger,
    startedAt: Date,
  ) {
    const finishedAt = new Date();

    await this.prisma.pharmacySyncRun.create({
      data: {
        integrationId: integration.id,
        pharmacyId: integration.pharmacyId,
        trigger,
        status: outcome.status,
        startedAt,
        finishedAt,
        rows: outcome.rows,
        imported: outcome.imported,
        updated: outcome.updated,
        skipped: outcome.skipped,
        note: outcome.note,
      },
    });

    // A failed attempt still moves the clock forward. Retrying immediately would
    // hammer a feed that is down, and the interval is short enough that the next
    // attempt is the retry.
    const nextSyncAt =
      integration.direction === IntegrationDirection.PULL && integration.enabled
        ? new Date(finishedAt.getTime() + integration.intervalMinutes * 60_000)
        : null;

    await this.prisma.pharmacyIntegration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: finishedAt,
        lastSyncStatus: outcome.status,
        nextSyncAt,
        syncingSince: null,
      },
    });
  }

  /**
   * The sentence the operator reads in the history. Nest exceptions carry a
   * message written for exactly that; anything else is reduced to a generic
   * line rather than leaking an internal error into a customer-facing list.
   */
  private reasonFor(err: unknown): string {
    if (err instanceof BadRequestException) {
      const res = err.getResponse() as { message?: string | string[] };
      const message = typeof res === 'string' ? res : res?.message;
      const text = Array.isArray(message) ? message.join(', ') : message;
      if (text) return text;
    }
    if (err instanceof NotFoundException) return err.message;
    return 'The sync failed unexpectedly. If this repeats, contact ZoikoMeds support.';
  }

  // --- Push ingestion ------------------------------------------------------

  /**
   * Stock posted by the pharmacy's own system, authenticated by the issued key
   * rather than by a user session — the caller is a POS server, not a person.
   *
   * The key identifies the pharmacy, so there is no pharmacy id in the request
   * to be tampered with: one pharmacy's key can only ever write one pharmacy's
   * inventory.
   */
  async ingestPush(
    apiKey: string | undefined,
    rows: Record<string, string>[] | undefined,
    csvText: string | undefined,
    mode: 'merge' | 'replace' | undefined,
    ipAddress?: string,
  ) {
    if (!apiKey) {
      throw new UnauthorizedException(
        'Send your integration key in the X-Zoiko-Api-Key header.',
      );
    }

    const integration = await this.prisma.pharmacyIntegration.findFirst({
      where: { apiKeyHash: hashApiKey(apiKey) },
    });
    if (!integration) {
      throw new UnauthorizedException('That integration key is not valid.');
    }
    if (!integration.enabled) {
      throw new BadRequestException(
        'This integration is paused. Resume it in the pharmacy portal before pushing stock.',
      );
    }

    // Parsed before the lock is taken: a malformed body is the caller's mistake
    // to fix and correcting it should not have to wait out a lock.
    let resolved: Record<string, string>[];
    if (typeof csvText === 'string' && csvText.trim()) {
      resolved = parseCsv(csvText);
    } else if (Array.isArray(rows) && rows.length > 0) {
      resolved = rows;
    } else {
      throw new BadRequestException(
        'Send either a "rows" array of medicines or "csvText".',
      );
    }

    const claimed = await this.claim(integration.id);
    if (!claimed) {
      throw new BadRequestException(
        'A sync is already running for this pharmacy. Retry in a moment.',
      );
    }

    const startedAt = new Date();
    let outcome: SyncOutcome;
    try {
      // The requested mode wins over the stored default, so a nightly full push
      // and hourly deltas can share one key.
      const effective = { ...claimed, syncMode: mode === 'replace' ? 'replace' : mode === 'merge' ? 'merge' : claimed.syncMode };
      outcome = await this.importRows(effective, resolved, 'push', undefined, ipAddress);
    } catch (err) {
      outcome = {
        status: IntegrationSyncStatus.FAILED,
        rows: 0,
        imported: 0,
        updated: 0,
        skipped: 0,
        note: this.reasonFor(err),
      };
      await this.finish(claimed, outcome, 'push', startedAt);
      throw err;
    }

    await this.finish(claimed, outcome, 'push', startedAt);
    return {
      status: outcome.status.toLowerCase(),
      rows: outcome.rows,
      imported: outcome.imported,
      updated: outcome.updated,
      skipped: outcome.skipped,
      note: outcome.note,
    };
  }

  // --- Scheduled runs ------------------------------------------------------

  /**
   * Run every pull feed that is due. Called by the scheduler on a timer; safe
   * to call from anywhere, since each feed is claimed before it is run.
   *
   * Sequential on purpose: a sync is an import of up to 20,000 rows, and the
   * point of the interval is that this work is spread out, not batched into a
   * spike that competes with the API's own requests.
   */
  async runDueSyncs(now = new Date()): Promise<number> {
    const due = await this.prisma.pharmacyIntegration.findMany({
      where: {
        enabled: true,
        direction: IntegrationDirection.PULL,
        nextSyncAt: { lte: now },
      },
      orderBy: { nextSyncAt: 'asc' },
      // A cap, so one very long backlog cannot monopolize a tick.
      take: 25,
    });

    let ran = 0;
    for (const integration of due) {
      const claimed = await this.claim(integration.id);
      if (!claimed) continue;
      await this.runPull(claimed, 'scheduled');
      ran++;
    }
    return ran;
  }
}
