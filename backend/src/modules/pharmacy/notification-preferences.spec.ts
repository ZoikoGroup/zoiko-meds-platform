import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import {
  DEFAULT_PREFERENCES,
  NotificationPreferencesService,
  allowsCategory,
} from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * Pharmacy-portal notification preferences.
 *
 * The switches used to live in React state: they flipped, flashed "saved", and
 * were gone on the next navigation — and because nothing was stored, nothing
 * was enforced either. A member who switched system messages off carried on
 * receiving them.
 */

const prismaStub = (row: Record<string, unknown> | null = null) => ({
  pharmacyNotificationPreference: {
    findUnique: jest.fn().mockResolvedValue(row),
    upsert: jest.fn(async ({ create, update }: any) => ({
      ...DEFAULT_PREFERENCES,
      ...create,
      ...update,
    })),
  },
});

const ALL_ON = { ...DEFAULT_PREFERENCES };

describe('NotificationPreferencesService.get', () => {
  it('defaults an account with no saved row to everything on', async () => {
    // Every account that existed before this table. A missing row must read as
    // "notify me" — the other direction would mute the whole estate silently.
    const prisma = prismaStub(null);
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    await expect(service.get('user_1')).resolves.toEqual(ALL_ON);
  });

  it('returns what was saved', async () => {
    const prisma = prismaStub({ ...ALL_ON, systemMessages: false });
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    await expect(service.get('user_1')).resolves.toMatchObject({ systemMessages: false });
  });

  it('reads only the calling account\'s row', async () => {
    const prisma = prismaStub(null);
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    await service.get('user_1');

    expect(prisma.pharmacyNotificationPreference.findUnique.mock.calls[0][0].where).toEqual({
      userId: 'user_1',
    });
  });
});

describe('NotificationPreferencesService.update', () => {
  it('saves the switch that changed', async () => {
    const prisma = prismaStub(null);
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    const saved = await service.update('user_1', { systemMessages: false });

    expect(saved.systemMessages).toBe(false);
    const [args] = prisma.pharmacyNotificationPreference.upsert.mock.calls[0];
    expect(args.where).toEqual({ userId: 'user_1' });
    expect(args.update).toEqual({ systemMessages: false });
  });

  it('leaves the switches that were not sent alone', async () => {
    // The page saves one switch at a time; a replace would reset the other
    // three to whatever the client last rendered.
    const prisma = prismaStub(null);
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    await service.update('user_1', { uploadResults: false });

    const [args] = prisma.pharmacyNotificationPreference.upsert.mock.calls[0];
    expect(args.update).not.toHaveProperty('inventoryAlerts');
    expect(args.update).not.toHaveProperty('systemMessages');
  });

  it('creates a first row from the defaults, not from column defaults by accident', async () => {
    const prisma = prismaStub(null);
    const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

    await service.update('user_1', { inventoryAlerts: false });

    const [args] = prisma.pharmacyNotificationPreference.upsert.mock.calls[0];
    expect(args.create).toMatchObject({
      userId: 'user_1',
      inventoryAlerts: false,
      verificationUpdates: true,
      uploadResults: true,
      systemMessages: true,
    });
  });
});

describe('allowsCategory — the one gate every producer asks', () => {
  const cases: Array<[string, keyof typeof DEFAULT_PREFERENCES]> = [
    ['inventory', 'inventoryAlerts'],
    ['verification', 'verificationUpdates'],
    ['upload', 'uploadResults'],
    ['system', 'systemMessages'],
  ];

  it.each(cases)('maps %s to %s', async (category, field) => {
    const off = prismaStub({ ...ALL_ON, [field]: false });
    const on = prismaStub({ ...ALL_ON, [field]: true });

    await expect(allowsCategory(off as never, 'user_1', category as never)).resolves.toBe(false);
    await expect(allowsCategory(on as never, 'user_1', category as never)).resolves.toBe(true);
  });

  it('allows everything for an account with no row', async () => {
    const prisma = prismaStub(null);
    await expect(allowsCategory(prisma as never, 'user_1', 'system')).resolves.toBe(true);
  });

  it('keeps one member\'s choice off another member\'s account', async () => {
    // User A silences system messages; user B must be unaffected.
    const byUser: Record<string, unknown> = {
      user_a: { ...ALL_ON, systemMessages: false },
      user_b: { ...ALL_ON },
    };
    const prisma = {
      pharmacyNotificationPreference: {
        findUnique: jest.fn(async ({ where }: any) => byUser[where.userId] ?? null),
      },
    };

    await expect(allowsCategory(prisma as never, 'user_a', 'system')).resolves.toBe(false);
    await expect(allowsCategory(prisma as never, 'user_b', 'system')).resolves.toBe(true);
  });
});

describe('the portal notification list honours the preferences', () => {
  const notification = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    dedupeKey: 'verification:req_1:approved',
    title: 'Pharmacy Verification Approved',
    description: 'Approved.',
    read: false,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...over,
  });

  const broadcast = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    title: 'Scheduled maintenance',
    message: 'Sunday 02:00 UTC.',
    target: 'ALL_USERS',
    status: 'DISPATCHED',
    createdAt: new Date('2026-08-02T10:00:00Z'),
    ...over,
  });

  const build = (preferences: Record<string, boolean>, rows: Record<string, unknown[]>) => {
    const prisma = {
      signalNotification: { findMany: jest.fn().mockResolvedValue(rows.own ?? []) },
      notification: { findMany: jest.fn().mockResolvedValue(rows.broadcasts ?? []) },
      pharmacyNotificationPreference: {
        findUnique: jest.fn().mockResolvedValue({ ...ALL_ON, ...preferences }),
      },
    };
    const service = new PharmacyService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditWriter,
      {} as unknown as SavedMedicineLinkService,
      { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
      new NotificationPreferencesService(prisma as unknown as PrismaService),
    );
    return { service, prisma };
  };

  it('shows a system broadcast when system messages are on', async () => {
    const { service } = build({}, { own: [], broadcasts: [broadcast()] });

    const items = await service.getUserNotifications('user_1');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'system', title: 'Scheduled maintenance' });
  });

  it('hides it when they are off — and does not even ask the database for it', async () => {
    const { service, prisma } = build({ systemMessages: false }, { own: [], broadcasts: [broadcast()] });

    const items = await service.getUserNotifications('user_1');

    expect(items).toEqual([]);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('leaves nothing for the unread count to add up when system messages are off', async () => {
    const { service } = build({ systemMessages: false }, { own: [], broadcasts: [broadcast()] });

    const items = await service.getUserNotifications('user_1');
    expect(items.filter((n) => n.unread)).toHaveLength(0);
  });

  it('hides verification notices when verification updates are off', async () => {
    const { service } = build({ verificationUpdates: false }, { own: [notification()], broadcasts: [] });

    await expect(service.getUserNotifications('user_1')).resolves.toEqual([]);
  });

  it('keeps the categories independent', async () => {
    // System off must not take verification with it.
    const { service } = build(
      { systemMessages: false },
      { own: [notification()], broadcasts: [broadcast()] },
    );

    const items = await service.getUserNotifications('user_1');

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('verification');
  });

  it('categorises by what the notification is about', async () => {
    const { service } = build({}, {
      own: [
        notification({ id: 'a', dedupeKey: 'inventory:med_1:out-of-stock' }),
        notification({ id: 'b', dedupeKey: 'upload:job_9:failed' }),
        notification({ id: 'c', dedupeKey: 'verification:req_1:approved' }),
      ],
      broadcasts: [],
    });

    const items = await service.getUserNotifications('user_1');
    expect(items.map((n) => n.type).sort()).toEqual(['inventory', 'upload', 'verification']);
  });

  it('still shows a notification whose key it does not recognise', async () => {
    // An unknown producer must not be silently dropped.
    const { service } = build({}, { own: [notification({ dedupeKey: 'something-new' })], broadcasts: [] });

    const items = await service.getUserNotifications('user_1');
    expect(items).toHaveLength(1);
  });

  it('ignores a broadcast aimed at someone else entirely', async () => {
    const { service } = build({}, {
      own: [],
      broadcasts: [broadcast({ target: 'ENTERPRISE_ADMINS' })],
    });

    await expect(service.getUserNotifications('user_1')).resolves.toEqual([]);
  });

  it('reads preferences for the account being served', async () => {
    const { service, prisma } = build({}, { own: [], broadcasts: [] });

    await service.getUserNotifications('user_42');

    expect(prisma.pharmacyNotificationPreference.findUnique.mock.calls[0][0].where).toEqual({
      userId: 'user_42',
    });
  });
});
