import { Prisma } from '@prisma/client';
import { MigrationStatusService } from './migration-status.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The migration ledger is the only view of the production schema for anyone
 * without a shell on the VM. These cover the four states it must be able to
 * report, and that it never echoes database credentials back to a caller.
 */
describe('MigrationStatusService', () => {
  const SHIPPED = ['0_init', '20260814120000_saved_medicine_off_catalog'];

  let prisma: { $queryRaw: jest.Mock };
  let service: MigrationStatusService;
  const originalUrl = process.env.DATABASE_URL;

  const finished = (name: string) => ({
    migration_name: name,
    finished_at: new Date('2026-08-14T12:00:00Z'),
    rolled_back_at: null,
  });

  /**
   * Every column the datamodel declares, as information_schema would report it
   * for a database that is fully in step — the baseline a drift test removes
   * from. Built from the DMMF so it cannot fall behind the schema.
   */
  const everyColumn = () =>
    Prisma.dmmf.datamodel.models.flatMap((model) =>
      model.fields
        .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
        .map((field) => ({
          table_name: model.dbName ?? model.name,
          column_name: field.dbName ?? field.name,
        })),
    );

  /**
   * The service asks two questions in order: the ledger, then the table shapes.
   * Answering by call order keeps each test stating only what it is about.
   */
  const answer = (ledger: unknown, columns: unknown = everyColumn()) => {
    prisma.$queryRaw
      .mockImplementationOnce(() =>
        ledger instanceof Error ? Promise.reject(ledger) : Promise.resolve(ledger),
      )
      .mockImplementationOnce(() =>
        columns instanceof Error ? Promise.reject(columns) : Promise.resolve(columns),
      );
  };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    service = new MigrationStatusService(prisma as unknown as PrismaService);
    // The real directory listing is exercised separately; pin it here so the
    // states under test do not depend on how many migrations the repo has today.
    jest
      .spyOn(service as unknown as { shippedMigrations: () => string[] }, 'shippedMigrations')
      .mockReturnValue(SHIPPED);
    process.env.DATABASE_URL = 'postgresql://postgres:hunter2@db:5432/zoikomeds?schema=public';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('reports ok when the ledger is complete and the tables match it', async () => {
    answer(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.status).toBe('ok');
    expect(status.applied).toBe(2);
    expect(status.pending).toEqual([]);
    expect(status.missing).toEqual([]);
  });

  // The 2026-08-17 failure: the API served code whose migration had never been
  // applied, and every SavedMedicine query failed while the deploy looked clean.
  it('names the migrations the database is missing', async () => {
    answer([finished('0_init')]);

    const status = await service.status();

    expect(status.status).toBe('behind');
    expect(status.pending).toEqual(['20260814120000_saved_medicine_off_catalog']);
    expect(status.detail).toContain('prisma migrate deploy');
    // The likeliest cause once "migrate deploy" reports nothing to do.
    expect(status.detail).toContain('different database');
  });

  it('distinguishes a half-applied migration from a missing one', async () => {
    answer([
      finished('0_init'),
      {
        migration_name: '20260814120000_saved_medicine_off_catalog',
        finished_at: null,
        rolled_back_at: null,
      },
    ]);

    const status = await service.status();

    // Not 'behind': `migrate deploy` cannot fix this on its own, so telling an
    // operator to run it would send them in a circle.
    expect(status.status).toBe('failed');
    expect(status.failed).toEqual(['20260814120000_saved_medicine_off_catalog']);
    expect(status.detail).toContain('P3009');
  });

  it('treats a rolled-back migration as unapplied', async () => {
    answer([
      finished('0_init'),
      {
        migration_name: '20260814120000_saved_medicine_off_catalog',
        finished_at: new Date('2026-08-14T12:00:00Z'),
        rolled_back_at: new Date('2026-08-14T12:05:00Z'),
      },
    ]);

    const status = await service.status();

    expect(status.status).toBe('failed');
    expect(status.applied).toBe(1);
  });

  it('reports unknown, not ok, when the ledger cannot be read', async () => {
    answer(new Error('relation "_prisma_migrations" does not exist'));

    const status = await service.status();

    expect(status.status).toBe('unknown');
    expect(status.pending).toEqual(SHIPPED);
  });

  it('names the datasource without leaking the password', async () => {
    answer(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.datasource).toBe('zoikomeds@db:5432');
    expect(JSON.stringify(status)).not.toContain('hunter2');
  });

  it('does not echo an unparseable DATABASE_URL back to the caller', async () => {
    process.env.DATABASE_URL = 'postgres@@@not-a-url:hunter2';
    answer(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.datasource).toBe('unparseable');
    expect(JSON.stringify(status)).not.toContain('hunter2');
  });

  // The case a ledger check cannot reach, and the one that made /health/schema
  // report "ok" over a database Saved Medicines was still failing against:
  // `migrate resolve --applied` records a migration as applied without running
  // its SQL, and every status command reads clean from then on.
  it('reports drift when the ledger is complete but a column is absent', async () => {
    const withoutSavedMedicineColumns = everyColumn().filter(
      (column) =>
        !(
          column.table_name === 'SavedMedicine' &&
          ['medicineName', 'normalizedName', 'linkedAt'].includes(column.column_name)
        ),
    );
    answer(SHIPPED.map(finished), withoutSavedMedicineColumns);

    const status = await service.status();

    expect(status.status).toBe('drift');
    expect(status.missing).toEqual(
      expect.arrayContaining([
        'SavedMedicine.medicineName',
        'SavedMedicine.normalizedName',
        'SavedMedicine.linkedAt',
      ]),
    );
    // Nothing is pending: telling an operator to run `migrate deploy` here sends
    // them in a circle, so the detail must say what will actually reconcile it.
    expect(status.pending).toEqual([]);
    expect(status.detail).toContain('migrate diff');
  });

  it('reports an absent table once, not once per column', async () => {
    answer(
      SHIPPED.map(finished),
      everyColumn().filter((column) => column.table_name !== 'SavedMedicine'),
    );

    const status = await service.status();

    expect(status.status).toBe('drift');
    expect(status.missing).toContain('SavedMedicine.*');
    expect(status.missing.filter((name) => name.startsWith('SavedMedicine.'))).toEqual([
      'SavedMedicine.*',
    ]);
  });

  it('caps how many missing identifiers it names, and says how many it did not', async () => {
    answer(SHIPPED.map(finished), []);

    const status = await service.status();

    expect(status.status).toBe('drift');
    expect(status.missing.length).toBe(25);
    expect(status.detail).toMatch(/further identifier\(s\) not listed/);
  });

  it('does not read an unreadable information_schema as a healthy one', async () => {
    answer(SHIPPED.map(finished), new Error('permission denied for schema information_schema'));

    const status = await service.status();

    expect(status.status).toBe('unknown');
    expect(status.detail).toContain('unverified');
  });

  // Relations are joins; the foreign key behind one is a scalar field in its own
  // right, so treating them as columns would report drift on a correct database.
  it('does not expect a column for a relation field', async () => {
    answer(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.status).toBe('ok');
    expect(status.missing).toEqual([]);
  });

  it('lists the real migration directory when nothing is stubbed', async () => {
    jest.restoreAllMocks();
    const shipped = (
      service as unknown as { shippedMigrations: () => string[] }
    ).shippedMigrations();

    // The migration this feature depends on must be among the ones the build
    // ships, or the comparison above can never detect its absence.
    expect(shipped).toContain('20260814120000_saved_medicine_off_catalog');
    expect(shipped).toEqual([...shipped].sort());
  });
});
