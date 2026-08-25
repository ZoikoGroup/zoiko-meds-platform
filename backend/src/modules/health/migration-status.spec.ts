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

  it('reports ok when every shipped migration is applied', async () => {
    prisma.$queryRaw.mockResolvedValue(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.status).toBe('ok');
    expect(status.applied).toBe(2);
    expect(status.pending).toEqual([]);
  });

  // The 2026-08-17 failure: the API served code whose migration had never been
  // applied, and every SavedMedicine query failed while the deploy looked clean.
  it('names the migrations the database is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([finished('0_init')]);

    const status = await service.status();

    expect(status.status).toBe('behind');
    expect(status.pending).toEqual(['20260814120000_saved_medicine_off_catalog']);
    expect(status.detail).toContain('prisma migrate deploy');
    // The likeliest cause once "migrate deploy" reports nothing to do.
    expect(status.detail).toContain('different database');
  });

  it('distinguishes a half-applied migration from a missing one', async () => {
    prisma.$queryRaw.mockResolvedValue([
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
    prisma.$queryRaw.mockResolvedValue([
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
    prisma.$queryRaw.mockRejectedValue(new Error('relation "_prisma_migrations" does not exist'));

    const status = await service.status();

    expect(status.status).toBe('unknown');
    expect(status.pending).toEqual(SHIPPED);
  });

  it('names the datasource without leaking the password', async () => {
    prisma.$queryRaw.mockResolvedValue(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.datasource).toBe('zoikomeds@db:5432');
    expect(JSON.stringify(status)).not.toContain('hunter2');
  });

  it('does not echo an unparseable DATABASE_URL back to the caller', async () => {
    process.env.DATABASE_URL = 'postgres@@@not-a-url:hunter2';
    prisma.$queryRaw.mockResolvedValue(SHIPPED.map(finished));

    const status = await service.status();

    expect(status.datasource).toBe('unparseable');
    expect(JSON.stringify(status)).not.toContain('hunter2');
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
