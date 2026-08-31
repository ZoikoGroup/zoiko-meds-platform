import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService, normalizeInventoryStatus } from './pharmacy.service';

/**
 * CSV import — the status in the file is the status that gets stored.
 *
 * A pharmacy uploaded one medicine as "out of stock" and the portal listed it
 * as Available. The preview read the cell correctly; the importer recognised
 * only the hyphenated "out-of-stock" and everything else fell through a
 * `|| HIGH` default. A pharmacy telling patients a medicine had run out was
 * publishing the opposite.
 */

const PHARMACY = 'ph_1';

function buildService({ existingSignal = null }: { existingSignal?: { id: string } | null } = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const intake: Record<string, unknown>[] = [];

  const prisma: any = {
    medicineEntity: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'med_new', ...data })),
    },
    inventorySignal: {
      create: jest.fn(async ({ data }: any) => {
        intake.push(data);
        return data;
      }),
    },
    availabilitySignal: {
      findUnique: jest.fn().mockResolvedValue(existingSignal),
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'sig_new', ...data };
      }),
      update: jest.fn(async ({ data }: any) => {
        updated.push(data);
        return { id: existingSignal?.id ?? 'sig_1', ...data };
      }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    pharmacy: { findUnique: jest.fn().mockResolvedValue({ name: 'Zoiko Meds Pharmacy' }) },
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );
  return { service, prisma, created, updated, intake };
}

const row = (over: Record<string, unknown> = {}) => ({
  name: 'Tester 2',
  generic: 'Tester 2',
  strength: '10',
  dosageform: 'tester',
  ...over,
});

describe('normalizeInventoryStatus', () => {
  it.each([
    ['available', 'available'],
    ['Available', 'available'],
    ['AVAILABLE', 'available'],
    ['in stock', 'available'],
    ['limited', 'limited'],
    ['limited stock', 'limited'],
    ['Limited Stock', 'limited'],
    ['LIMITED STOCK', 'limited'],
    ['low stock', 'limited'],
    ['out of stock', 'out-of-stock'],
    ['Out of Stock', 'out-of-stock'],
    ['OUT OF STOCK', 'out-of-stock'],
    ['out-of-stock', 'out-of-stock'],
    ['out_of_stock', 'out-of-stock'],
    ['OutOfStock', 'out-of-stock'],
    ['unavailable', 'out-of-stock'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeInventoryStatus(input)).toBe(expected);
  });

  it('returns null for an empty cell, which the caller defaults', () => {
    expect(normalizeInventoryStatus('')).toBeNull();
    expect(normalizeInventoryStatus('   ')).toBeNull();
    expect(normalizeInventoryStatus(undefined)).toBeNull();
  });

  it.each(['testing', 'abc', 'unknown-status', 'maybe'])(
    'refuses %s rather than guessing',
    (input) => {
      expect(normalizeInventoryStatus(input)).toBeNull();
    },
  );
});

describe('a one-row CSV — the reported case', () => {
  it('stores "out of stock" as out of stock, not available', async () => {
    const { service, created } = buildService();

    const result = await service.importCsv(PHARMACY, [row({ status: 'out of stock' })], 'merge');

    expect(result).toMatchObject({ imported: 1, skipped: 0, totalProcessed: 1 });
    expect(created).toHaveLength(1);
    expect(created[0].confidence).toBe('LOW');
  });

  it('records the raw intake as not in stock too', async () => {
    // The confidential InventorySignal and the public AvailabilitySignal must
    // not disagree about whether the pharmacy has any.
    const { service, intake } = buildService();

    await service.importCsv(PHARMACY, [row({ status: 'out of stock' })], 'merge');

    expect(intake[0]).toMatchObject({ reportedInStock: false, uploadMethod: 'CSV' });
  });
});

describe('every status the product has', () => {
  it.each([
    ['available', 'HIGH'],
    ['limited stock', 'MODERATE'],
    ['out of stock', 'LOW'],
  ])('stores %s as %s', async (status, confidence) => {
    const { service, created } = buildService();

    await service.importCsv(PHARMACY, [row({ status })], 'merge');

    expect(created[0].confidence).toBe(confidence);
  });

  it.each(['out of stock', 'Out of Stock', 'OUT OF STOCK', 'out-of-stock'])(
    'reads %s the same way',
    async (status) => {
      const { service, created } = buildService();

      await service.importCsv(PHARMACY, [row({ status })], 'merge');

      expect(created[0].confidence).toBe('LOW');
    },
  );

  it('defaults an empty status cell to available', async () => {
    // The documented default, and the only case a default is correct.
    const { service, created } = buildService();

    await service.importCsv(PHARMACY, [row({ status: '' })], 'merge');

    expect(created[0].confidence).toBe('HIGH');
  });

  it('defaults a missing status column to available', async () => {
    const { service, created } = buildService();

    await service.importCsv(PHARMACY, [row()], 'merge');

    expect(created[0].confidence).toBe('HIGH');
  });
});

describe('an existing medicine takes the status the CSV supplies', () => {
  it('goes from available to out of stock', async () => {
    const { service, updated } = buildService({ existingSignal: { id: 'sig_1' } });

    const result = await service.importCsv(PHARMACY, [row({ status: 'out of stock' })], 'merge');

    expect(result).toMatchObject({ imported: 0, updated: 1 });
    expect(updated[0].confidence).toBe('LOW');
  });

  it('goes from out of stock back to available', async () => {
    const { service, updated } = buildService({ existingSignal: { id: 'sig_1' } });

    await service.importCsv(PHARMACY, [row({ status: 'available' })], 'merge');

    expect(updated[0].confidence).toBe('HIGH');
  });

  it('does not keep the previous status when the CSV states a new one', async () => {
    const { service, updated } = buildService({ existingSignal: { id: 'sig_1' } });

    await service.importCsv(PHARMACY, [row({ status: 'limited stock' })], 'merge');

    expect(updated[0].confidence).toBe('MODERATE');
    expect(updated[0].computedAt).toBeInstanceOf(Date);
  });
});

describe('replace mode handles status identically', () => {
  it('stores out of stock on a new medicine', async () => {
    const { service, created } = buildService();

    await service.importCsv(PHARMACY, [row({ status: 'out of stock' })], 'replace');

    expect(created[0].confidence).toBe('LOW');
  });

  it('updates an existing medicine to out of stock', async () => {
    const { service, updated } = buildService({ existingSignal: { id: 'sig_1' } });

    await service.importCsv(PHARMACY, [row({ status: 'OUT OF STOCK' })], 'replace');

    expect(updated[0].confidence).toBe('LOW');
  });

  it('still prunes what the file did not list', async () => {
    const { service, prisma } = buildService();
    prisma.availabilitySignal.findMany.mockResolvedValue([{ id: 'sig_old' }, { id: 'sig_new' }]);

    await service.importCsv(PHARMACY, [row({ status: 'out of stock' })], 'replace');

    expect(prisma.availabilitySignal.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sig_old'] } },
    });
  });
});

describe('an unrecognised status is refused, never defaulted', () => {
  it.each(['testing', 'abc', 'unknown-status'])('rejects the file containing %s', async (status) => {
    const { service } = buildService();

    await expect(service.importCsv(PHARMACY, [row({ status })], 'merge')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('writes nothing at all — not even the valid rows', async () => {
    // Refusing the whole file matters most in replace mode, where a row dropped
    // from the import is a medicine pruned from the inventory.
    const { service, prisma } = buildService();

    await expect(
      service.importCsv(
        PHARMACY,
        [row({ name: 'Good', status: 'available' }), row({ name: 'Bad', status: 'testing' })],
        'replace',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.availabilitySignal.create).not.toHaveBeenCalled();
    expect(prisma.availabilitySignal.update).not.toHaveBeenCalled();
    expect(prisma.availabilitySignal.deleteMany).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
  });

  it('names the offending cell and says what is accepted', async () => {
    const { service } = buildService();

    await expect(
      service.importCsv(PHARMACY, [row({ status: 'testing' })], 'merge'),
    ).rejects.toThrow(/row 2: "testing".*available, limited stock, or out of stock/s);
  });

  it('reports several bad rows without listing hundreds', async () => {
    const { service } = buildService();
    const rows = Array.from({ length: 9 }, (_, i) => row({ name: `M${i}`, status: 'nonsense' }));

    await expect(service.importCsv(PHARMACY, rows, 'merge')).rejects.toThrow(/and 4 more/);
  });
});

describe('raw CSV text takes the same path', () => {
  it('reads a status column out of the file itself', async () => {
    const { service, created } = buildService();
    const csv = ['name,generic,strength,dosageform,status', 'Tester 2,Tester 2,10,tester,out of stock'].join(
      '\n',
    );

    await service.importCsv(PHARMACY, csv, 'merge');

    expect(created[0].confidence).toBe('LOW');
  });

  it('refuses a file whose status column says something else', async () => {
    const { service } = buildService();
    const csv = ['name,status', 'Tester 2,testing'].join('\n');

    await expect(service.importCsv(PHARMACY, csv, 'merge')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
