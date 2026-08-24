import { PrismaService } from '../../../prisma/prisma.service';
import {
  PHARMACY_INVENTORY_KEY_PREFIX,
  PHARMACY_UPLOAD_KEY_PREFIX,
  PharmacyNotificationService,
} from './pharmacy-notification.service';

/**
 * The pharmacy portal's own notification rows.
 *
 * The portal derives a row's filter tab from its dedupeKey prefix, so these
 * tests pin the two prefixes and the fan-out: a prefix that drifts, or a write
 * that reaches only the user who happened to be logged in, is an empty tab with
 * nothing to show it is broken.
 */

const PHARMACY = 'ph_apollo';

const ASTHALIN = { id: 'med_asthalin', canonicalName: 'Asthalin', strength: '100 mcg' };

function build(users: Array<{ id: string }> = [{ id: 'user_mgr' }, { id: 'user_staff' }]) {
  const prisma: any = {
    user: { findMany: jest.fn().mockResolvedValue(users) },
    signalNotification: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const service = new PharmacyNotificationService(prisma as unknown as PrismaService);
  return { service, prisma };
}

/** The `create` branch of every upsert this call made. */
const written = (prisma: any) =>
  prisma.signalNotification.upsert.mock.calls.map(([args]: any[]) => args.create);

describe('PharmacyNotificationService availability rows', () => {
  it('writes one Inventory-tab row per portal seat at the pharmacy', async () => {
    const { service, prisma } = build();

    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1_700_000_000_000);

    // Both seats, not just the one that performed the action: staff on another
    // terminal have no other way to learn the stock position changed.
    expect(prisma.signalNotification.upsert).toHaveBeenCalledTimes(2);
    expect(written(prisma).map((r: any) => r.userId)).toEqual(['user_mgr', 'user_staff']);
    for (const row of written(prisma)) {
      expect(row.dedupeKey.startsWith(PHARMACY_INVENTORY_KEY_PREFIX)).toBe(true);
    }
  });

  it('scopes recipients to this pharmacy and to portal roles only', async () => {
    const { service, prisma } = build();

    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1);

    const [args] = prisma.user.findMany.mock.calls[0];
    expect(args.where.pharmacyId).toBe(PHARMACY);
    // A patient account linked to a pharmacy must never receive the pharmacy's
    // internal operational rows.
    expect(args.where.role).toEqual({ in: ['PHARMACY_ADMIN', 'PHARMACY_STAFF'] });
  });

  it('names the strength, so two strengths of one medicine are distinguishable', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1);

    expect(written(prisma)[0].title).toBe('Asthalin 100 mcg is now available to patients');
  });

  it('keys each transition on its own timestamp rather than upserting over a read row', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1_000);
    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 2_000);

    const keys = written(prisma).map((r: any) => r.dedupeKey);
    // Two genuine restocks are two events. Sharing a key would refresh the copy
    // of the first row, which the pharmacy may already have read and dismissed.
    expect(new Set(keys).size).toBe(2);
  });

  it('never resurrects read, dismissed or archived state on the update branch', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1);

    const [args] = prisma.signalNotification.upsert.mock.calls[0];
    expect(Object.keys(args.update).sort()).toEqual(['description', 'occurredAt', 'title']);
  });

  it('distinguishes limited availability from losing it entirely', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.inventoryBecameUnavailable(PHARMACY, ASTHALIN, 'limited', 1);
    await service.inventoryBecameUnavailable(PHARMACY, ASTHALIN, 'out-of-stock', 2);

    const [limited, gone] = written(prisma);
    expect(limited.type).toBe('LIMITED');
    expect(limited.title).toContain('limited availability');
    expect(gone.type).toBe('RUNNING_LOW');
    expect(gone.title).toContain('no longer available');
  });
});

describe('PharmacyNotificationService upload rows', () => {
  const outcome = (over: Record<string, number | string> = {}) => ({
    imported: 10,
    updated: 2,
    skipped: 0,
    totalProcessed: 12,
    mode: 'merge' as const,
    ...over,
  });

  it('reports a clean import on the Uploads tab', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.bulkUploadCompleted(PHARMACY, outcome(), 1);

    const row = written(prisma)[0];
    expect(row.dedupeKey.startsWith(PHARMACY_UPLOAD_KEY_PREFIX)).toBe(true);
    expect(row.title).toBe('Bulk inventory upload completed');
    expect(row.description).toContain('10 added, 2 updated of 12 rows');
  });

  it('says so when rows were skipped rather than rounding them away', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.bulkUploadCompleted(
      PHARMACY,
      outcome({ imported: 5, updated: 0, skipped: 7, totalProcessed: 12 }),
      1,
    );

    const row = written(prisma)[0];
    // A file where more than half the lines were dropped must not read as a
    // clean upload — that is the pharmacy's cue to check the file.
    expect(row.title).toBe('Bulk upload completed with errors');
    expect(row.description).toContain('7 skipped');
  });

  it('calls an import that applied nothing a failure', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.bulkUploadCompleted(
      PHARMACY,
      outcome({ imported: 0, updated: 0, skipped: 4, totalProcessed: 4 }),
      1,
    );

    expect(written(prisma)[0].title).toBe('Bulk inventory upload failed');
  });

  it('mentions the pruning that replace mode performs', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);

    await service.bulkUploadCompleted(PHARMACY, outcome({ mode: 'replace' }), 1);

    // Replace deletes inventory absent from the file. A pharmacy that picked the
    // mode by accident should be able to see that from the notification.
    expect(written(prisma)[0].description).toContain('absent from the file were removed');
  });
});

describe('PharmacyNotificationService failure handling', () => {
  it('swallows a write failure rather than rolling back the inventory change', async () => {
    const { service, prisma } = build([{ id: 'user_mgr' }]);
    prisma.signalNotification.upsert.mockRejectedValue(new Error('db down'));

    // The inventory write is the authoritative act. Failing to describe it
    // afterwards must not undo it.
    await expect(
      service.inventoryBecameAvailable(PHARMACY, ASTHALIN, 1),
    ).resolves.toBeUndefined();
  });

  it('writes nothing when no portal user is linked to the pharmacy', async () => {
    const { service, prisma } = build([]);

    await service.bulkUploadCompleted(PHARMACY, {
      imported: 1,
      updated: 0,
      skipped: 0,
      totalProcessed: 1,
      mode: 'merge',
    }, 1);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });
});
