import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What the database's migration ledger says, relative to the migrations this
 * build ships with.
 *
 * `ok`      every shipped migration is recorded as applied.
 * `behind`  the code expects tables/columns the database has not been given.
 * `failed`  a migration started and never finished (Prisma's P3009 state);
 *           `migrate deploy` refuses to continue until it is resolved.
 * `unknown` the ledger could not be read at all (no `_prisma_migrations`
 *           table, or the database is unreachable).
 */
export type SchemaState = 'ok' | 'behind' | 'failed' | 'unknown';

export interface MigrationStatus {
  status: SchemaState;
  /** `database@host`, never credentials — this is what catches migrations
   *  having been applied to a different database than the API reads. */
  datasource: string;
  applied: number;
  pending: string[];
  failed: string[];
  detail: string;
}

interface LedgerRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/**
 * Reads the migration ledger and compares it with the migrations on disk.
 *
 * This exists because the only view of the production schema used to be a shell
 * on the VM. On 2026-08-17 the API served a build whose migration had never been
 * applied: every SavedMedicine query failed with P2022 while the deploy was
 * green, and no one without VM access could tell why. The comparison is cheap
 * and needs no privileges beyond the ones the API already holds.
 */
@Injectable()
export class MigrationStatusService {
  /** The listing cannot change without restarting the process, so it is read
   *  from disk once rather than on every request. */
  private cachedShipped: string[] | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The migrations this build ships with, sorted the way Prisma orders them
   * (directory names are timestamp-prefixed, so lexical order is chronological).
   *
   * Resolved against several roots because the process starts from a different
   * directory in each deployment path: `/app` in the container, `backend/` under
   * pm2, and the repo root when a test or script runs it.
   */
  private shippedMigrations(): string[] {
    if (this.cachedShipped) return this.cachedShipped;
    const roots = [
      resolve(process.cwd(), 'prisma', 'migrations'),
      resolve(process.cwd(), 'backend', 'prisma', 'migrations'),
      resolve(__dirname, '..', '..', '..', 'prisma', 'migrations'),
    ];
    const dir = roots.find((candidate) => existsSync(candidate));
    // Not cached when absent: under pm2 the working directory is set by the
    // process manager, and a first call from the wrong one should not pin an
    // empty answer for the life of the process.
    if (!dir) return [];
    this.cachedShipped = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // A directory is only a migration if it actually carries SQL; this skips
      // editor leftovers rather than reporting them as permanently pending.
      .filter((name) => existsSync(join(dir, name, 'migration.sql')))
      .sort();
    return this.cachedShipped;
  }

  /** `database@host` from DATABASE_URL, with the credentials stripped. */
  private datasource(): string {
    const raw = process.env.DATABASE_URL;
    if (!raw) return 'unset';
    try {
      const url = new URL(raw);
      const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'unnamed';
      return `${database}@${url.host}`;
    } catch {
      // Never echo the raw value back: it carries the password.
      return 'unparseable';
    }
  }

  async status(): Promise<MigrationStatus> {
    const datasource = this.datasource();
    const shipped = this.shippedMigrations();

    let rows: LedgerRow[];
    try {
      rows = await this.prisma.$queryRaw<LedgerRow[]>`
        SELECT "migration_name", "finished_at", "rolled_back_at"
        FROM "_prisma_migrations"
      `;
    } catch {
      return {
        status: 'unknown',
        datasource,
        applied: 0,
        pending: shipped,
        failed: [],
        detail:
          'The migration ledger could not be read. Either the database is unreachable, ' +
          'or its schema was created without Prisma Migrate (`db push`), in which case ' +
          'it has no _prisma_migrations table to compare against.',
      };
    }

    const applied = new Set(
      rows
        .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
        .map((row) => row.migration_name),
    );
    // Started and never finished. `migrate deploy` exits P3009 on these, so they
    // block every later migration until resolved by hand.
    const failed = rows
      .filter((row) => row.finished_at === null || row.rolled_back_at !== null)
      .map((row) => row.migration_name)
      .sort();
    const pending = shipped.filter((name) => !applied.has(name));

    if (failed.length > 0) {
      return {
        status: 'failed',
        datasource,
        applied: applied.size,
        pending,
        failed,
        detail:
          `${failed.length} migration(s) are recorded as started but not finished, so ` +
          '`prisma migrate deploy` will refuse to apply anything further (P3009). ' +
          'Inspect the failure, then `prisma migrate resolve --applied <name>` or ' +
          '`--rolled-back <name>` before deploying again.',
      };
    }

    if (pending.length > 0) {
      return {
        status: 'behind',
        datasource,
        applied: applied.size,
        pending,
        failed,
        detail:
          `The database is missing ${pending.length} migration(s) this build ships with, ` +
          'so any feature depending on them fails at the query. Run ' +
          '`npx prisma migrate deploy` against this datasource. If it reports nothing ' +
          'pending, it is connected to a different database than the API reads.',
      };
    }

    return {
      status: 'ok',
      datasource,
      applied: applied.size,
      pending,
      failed,
      detail: 'Every migration this build ships with is applied.',
    };
  }
}
