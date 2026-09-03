import { AvailabilityConfidence, SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * The two switches that govern one availability alert.
 *
 * A patient reported that turning "Alerts enabled" on for a saved medicine
 * changed nothing: with ZoikoSignal's "Back in stock" category off, a medicine
 * coming back into stock produced no notification, and the per-medicine switch
 * looked like a control wired to nothing.
 *
 * It is wired, and the observed behaviour is the design. Two pieces of the
 * product say so independently. The category's own description is "Notify me
 * when a saved medicine is available again" — it is scoped to saved medicines,
 * so it is the category gate for this exact event. And SavedMedicineLinkService,
 * which raises the same alert down a different path, has always applied both
 * gates and calls the global one a category preference in its own comment.
 *
 * So: the per-medicine switch decides *which* saved medicines may alert, and
 * the category switch decides *whether* availability alerts are produced at
 * all. Both must be on. These tests hold that, hold the independence of one
 * medicine from another, and hold the two producers to one notification per
 * event.
 */

const USER = 'user_1';
const PHARMACY = { id: 'ph_1', name: 'Apollo Kompally', latitude: 17.55, longitude: 78.41 };

const signal = (over: Record<string, unknown> = {}) => ({
  id: 'sig_1',
  pharmacyId: PHARMACY.id,
  confidence: AvailabilityConfidence.HIGH,
  freshnessMinutes: null,
  requiresConfirmation: false,
  computedAt: new Date(),
  pharmacy: PHARMACY,
  ...over,
});

/** A saved medicine that has just come back into stock. */
const savedRow = (over: Record<string, unknown> = {}, signals = [signal()]) => {
  const medicineId = (over.medicineId as string) ?? 'med_1';
  return {
    id: `saved_${medicineId}`,
    userId: USER,
    medicineName: 'Dolo 650',
    priority: 'NORMAL',
    // Was out of stock, so an available reading now is the back-in-stock
    // transition rather than an ordinary restock.
    notifiedStatus: 'out-of-stock',
    alertsEnabled: true,
    createdAt: new Date(),
    ...over,
    medicineId,
    medicine: {
      id: medicineId,
      canonicalName: (over.medicineName as string) ?? 'Dolo 650',
      genericName: 'Paracetamol',
      availabilitySignals: signals.map((s) => ({ ...s, medicineId })),
    },
  };
};

const ALL_ON = {
  userId: USER,
  runningLow: true,
  backInStock: true,
  nearbyRestock: true,
  recall: true,
  safety: true,
  push: true,
  email: false,
  sms: false,
};

function buildService({
  rows = [savedRow()],
  prefs = {},
  standing = null as { id: string; dedupeKey: string } | null,
}: {
  rows?: Record<string, unknown>[];
  prefs?: Record<string, boolean>;
  standing?: { id: string; dedupeKey: string } | null;
} = {}) {
  const prisma: any = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(standing),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    signalNotificationPreference: {
      upsert: jest.fn().mockResolvedValue({ ...ALL_ON, ...prefs }),
      findUnique: jest.fn().mockResolvedValue({ ...ALL_ON, ...prefs }),
    },
  };
  const service = new PatientSignalService(prisma as never, {
    resolveOrigin: jest.fn().mockResolvedValue(null),
  } as never);
  return { service, prisma };
}

/** Which medicines had a notification written for them this run. */
const notifiedFor = (prisma: { signalNotification: { upsert: jest.Mock } }) =>
  prisma.signalNotification.upsert.mock.calls.map((c) => c[0]?.create?.medicineId);

const typesWritten = (prisma: { signalNotification: { upsert: jest.Mock } }) =>
  prisma.signalNotification.upsert.mock.calls.map((c) => c[0]?.create?.type);

describe('both switches on', () => {
  it('notifies when a saved medicine comes back into stock', async () => {
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    expect(typesWritten(prisma)).toEqual([SignalNotificationType.BACK_IN_STOCK]);
  });
});

describe('the per-medicine switch', () => {
  it('produces nothing for a medicine whose alerts are off', async () => {
    const { service, prisma } = buildService({
      rows: [savedRow({ alertsEnabled: false })],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('is read per medicine, not per patient', async () => {
    // The reported expectation: Paracetamol on, Amoxicillin off, both back in
    // stock — one notification, for the right one.
    const { service, prisma } = buildService({
      rows: [
        savedRow({ medicineId: 'med_para', medicineName: 'Paracetamol', alertsEnabled: true }),
        savedRow({ medicineId: 'med_amox', medicineName: 'Amoxicillin', alertsEnabled: false }),
      ],
    });

    await service.listNotifications(USER);

    expect(notifiedFor(prisma)).toEqual(['med_para']);
  });

  it('works the other way round too', async () => {
    const { service, prisma } = buildService({
      rows: [
        savedRow({ medicineId: 'med_para', medicineName: 'Paracetamol', alertsEnabled: false }),
        savedRow({ medicineId: 'med_amox', medicineName: 'Amoxicillin', alertsEnabled: true }),
      ],
    });

    await service.listNotifications(USER);

    expect(notifiedFor(prisma)).toEqual(['med_amox']);
  });

  it('treats a row with no value as enabled', async () => {
    // The column defaults to true; an older row must not be silently muted.
    const { service, prisma } = buildService({
      rows: [savedRow({ alertsEnabled: undefined })],
    });

    await service.listNotifications(USER);

    expect(typesWritten(prisma)).toEqual([SignalNotificationType.BACK_IN_STOCK]);
  });
});

describe('the ZoikoSignal category switch', () => {
  it('produces nothing when back-in-stock alerts are switched off', async () => {
    // The reported test, exactly: category off, per-medicine on.
    const { service, prisma } = buildService({ prefs: { backInStock: false } });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('silences every saved medicine, not just one', async () => {
    const { service, prisma } = buildService({
      prefs: { backInStock: false },
      rows: [
        savedRow({ medicineId: 'med_para', alertsEnabled: true }),
        savedRow({ medicineId: 'med_amox', alertsEnabled: true }),
      ],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('governs only its own category', async () => {
    // Running low is a different switch. Turning back-in-stock off must not
    // silence it, or the two categories are not separate at all.
    const { service, prisma } = buildService({
      prefs: { backInStock: false, runningLow: true },
      rows: [
        savedRow({ notifiedStatus: 'available' }, [
          signal({ confidence: AvailabilityConfidence.LOW }),
        ]),
      ],
    });

    await service.listNotifications(USER);

    expect(typesWritten(prisma)).toEqual([SignalNotificationType.RUNNING_LOW]);
  });
});

describe('the two switches together', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'alertsEnabled=%s backInStock=%s produces a notification: %s',
    async (alertsEnabled, backInStock, expected) => {
      const { service, prisma } = buildService({
        rows: [savedRow({ alertsEnabled })],
        prefs: { backInStock },
      });

      await service.listNotifications(USER);

      expect(prisma.signalNotification.upsert.mock.calls.length > 0).toBe(expected);
    },
  );

  it('advances notifiedStatus even when silenced, so nothing replays', async () => {
    // Switching a category back on must not deliver a transition that happened
    // while it was off.
    const { service, prisma } = buildService({ prefs: { backInStock: false } });

    await service.listNotifications(USER);

    expect(prisma.savedMedicine.update).toHaveBeenCalledWith({
      where: { id: 'saved_med_1' },
      data: { notifiedStatus: 'available' },
    });
  });
});

describe('the notification is attributable to the flow that made it', () => {
  it('carries the back-in-stock type and a key naming the medicine', async () => {
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.upsert.mock.calls[0];
    expect(args.create.type).toBe(SignalNotificationType.BACK_IN_STOCK);
    expect(args.where.userId_dedupeKey.dedupeKey).toBe('med:med_1:back-in-stock');
  });
});

describe('the two producers do not both fire for one event', () => {
  it('raises nothing when the link service already announced the medicine', async () => {
    // SavedMedicineLinkService writes `saved-linked:<id>` when a pharmacy finally
    // stocks an off-catalog save, and clears notifiedStatus so this generator
    // sees the medicine as fresh. It then derived a restock for the same event,
    // under a key the prune here does not reach — two notifications, "X is now
    // available" and "fresh stock nearby", minutes apart.
    const { service, prisma } = buildService({
      rows: [
        savedRow({ notifiedStatus: null }, [
          signal({ computedAt: new Date(Date.now() - 5 * 60_000) }),
        ]),
      ],
      standing: { id: 'notif_link', dedupeKey: 'saved-linked:med_1' },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('looks for either producer’s row', async () => {
    const { service, prisma } = buildService({
      rows: [
        savedRow({ notifiedStatus: 'available' }, [
          signal({ computedAt: new Date(Date.now() - 5 * 60_000) }),
        ]),
      ],
    });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.findFirst.mock.calls[0];
    expect(args.where.OR).toEqual([
      { dedupeKey: 'med:med_1:back-in-stock' },
      { dedupeKey: 'saved-linked:med_1' },
    ]);
  });

  it('still keeps its own standing back-in-stock row', async () => {
    // The other half of the same lookup: a row this generator wrote is refreshed
    // rather than demoted to a restock.
    const { service, prisma } = buildService({
      rows: [
        savedRow({ notifiedStatus: 'available' }, [
          signal({ computedAt: new Date(Date.now() - 5 * 60_000) }),
        ]),
      ],
      standing: { id: 'notif_own', dedupeKey: 'med:med_1:back-in-stock' },
    });

    await service.listNotifications(USER);

    expect(typesWritten(prisma)).toEqual([SignalNotificationType.BACK_IN_STOCK]);
  });

  it('still raises an ordinary restock when neither row stands', async () => {
    const { service, prisma } = buildService({
      rows: [
        savedRow({ notifiedStatus: 'available' }, [
          signal({ computedAt: new Date(Date.now() - 5 * 60_000) }),
        ]),
      ],
      standing: null,
    });

    await service.listNotifications(USER);

    expect(typesWritten(prisma)).toEqual([SignalNotificationType.NEARBY_RESTOCK]);
  });
});
