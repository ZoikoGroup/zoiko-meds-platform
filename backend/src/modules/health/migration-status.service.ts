import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
 * `drift`   the ledger is complete but the tables do not match the models the
 *           client generates queries from. A ledger row is a record that a
 *           migration was *marked* applied, not proof its SQL ran — the two
 *           part company whenever `migrate resolve --applied` is used to clear
 *           a failure by hand, and the ledger then reads clean over a database
 *           that is still missing columns.
 * `unknown` the ledger could not be read at all (no `_prisma_migrations`
 *           table, or the database is unreachable).
 */
export type SchemaState = 'ok' | 'behind' | 'failed' | 'drift' | 'unknown';

export interface MigrationStatus {
  status: SchemaState;
  /** `database@host`, never credentials — this is what catches migrations
   *  having been applied to a different database than the API reads. */
  datasource: string;
  applied: number;
  pending: string[];
  failed: string[];
  /** `Table.column` for everything the client selects and the database lacks,
   *  or `Table.*` when the table itself is absent. Capped — see below. */
  missing: string[];
  detail: string;
}

/** How many missing identifiers to name before summarising the rest. A schema
 *  several migrations behind can be missing hundreds; the first few are enough
 *  to identify which migration is absent, and the response stays readable. */
const MAX_REPORTED_MISSING = 25;

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

  /**
   * The identifiers the generated client selects that the database does not
   * have, read from information_schema rather than from the ledger.
   *
   * This is the check the migration ledger cannot make. `migrate status` compares
   * directory names against rows in `_prisma_migrations`; it never looks at a
   * table. So a migration marked applied by hand — the ordinary way to clear a
   * P3009 after a partial failure — leaves the ledger reading "up to date" over
   * a database still missing the columns, and every query touching them fails
   * with P2022 while the deploy, and every status command, stays green.
   *
   * Scalar and enum fields only: relation fields are joins, not columns, and the
   * foreign keys backing them appear in the model in their own right.
   *
   * Returns null when information_schema itself could not be read, which is not
   * the same answer as "nothing is missing".
   */
  private async missingColumns(): Promise<string[] | null> {
    let rows: { table_name: string; column_name: string }[];
    try {
      rows = await this.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT "table_name", "column_name"
        FROM information_schema.columns
        WHERE "table_schema" = current_schema()
      `;
    } catch {
      return null;
    }

    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const tables = new Set(rows.map((row) => row.table_name));
    const missing: string[] = [];

    for (const model of Prisma.dmmf.datamodel.models) {
      // `@@map` renames the table; dbName is that name when one is set.
      const table = model.dbName ?? model.name;
      if (!tables.has(table)) {
        // One entry for an absent table rather than one per column: the table is
        // the fact, and its columns are not independently interesting.
        missing.push(`${table}.*`);
        continue;
      }
      for (const field of model.fields) {
        if (field.kind !== 'scalar' && field.kind !== 'enum') continue;
        const column = field.dbName ?? field.name;
        if (!present.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
      }
    }
    return missing;
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
        missing: [],
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
        missing: [],
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
        missing: [],
        detail:
          `The database is missing ${pending.length} migration(s) this build ships with, ` +
          'so any feature depending on them fails at the query. Run ' +
          '`npx prisma migrate deploy` against this datasource. If it reports nothing ' +
          'pending, it is connected to a different database than the API reads.',
      };
    }

    // The ledger is complete. That is necessary, not sufficient: ask the tables
    // themselves whether they carry what the client is going to select.
    const missing = await this.missingColumns();

    if (missing === null) {
      return {
        status: 'unknown',
        datasource,
        applied: applied.size,
        pending,
        failed,
        missing: [],
        detail:
          'Every migration is recorded as applied, but information_schema could not be ' +
          'read, so whether the tables actually match the models is unverified.',
      };
    }

    if (missing.length > 0) {
      const named = missing.slice(0, MAX_REPORTED_MISSING);
      const rest = missing.length - named.length;
      return {
        status: 'drift',
        datasource,
        applied: applied.size,
        pending,
        failed,
        missing: named,
        detail:
          `Every migration is recorded as applied, yet ${missing.length} identifier(s) the ` +
          'client selects are absent from the database, so those queries fail with P2022. ' +
          'A ledger row records that a migration was marked applied, not that its SQL ran: ' +
          'this is what `migrate resolve --applied` leaves behind. `migrate deploy` will ' +
          'report nothing to do — reconcile with `prisma migrate diff ' +
          '--from-schema-datasource prisma/schema.prisma --to-schema-datamodel ' +
          'prisma/schema.prisma` and apply the difference.' +
          (rest > 0 ? ` ${rest} further identifier(s) not listed.` : ''),
      };
    }

    return {
      status: 'ok',
      datasource,
      applied: applied.size,
      pending,
      failed,
      missing: [],
      detail:
        'Every migration this build ships with is applied, and every table carries the ' +
        'columns the client selects.',
    };
  }
}
