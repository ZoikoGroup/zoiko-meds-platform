import { AvailabilityConfidence, SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * ZoikoSignal → Notification settings actually deciding anything.
 *
 * Every switch on that page persisted correctly and then changed nothing.
 * SETTING_FOR_TYPE had always described which switch governs which notification
 * type, and nothing in the service ever read it: `regenerate()` never loaded the
 * preference row, and the list queries filtered only on dismissed/archived. So a
 * patient who turned "Back in stock" off kept receiving back-in-stock alerts,
 * which is what made the whole page look decorative.
 */

const USER = 'user_1';
const MEDICINE = 'med_1';

const PHARMACY = { id: 'ph_1', name: 'Apollo Kompally', latitude: 17.55, longitude: 78.41 };

const signal = (over: Record<string, unknown> = {}) => ({
  id: 'sig_1',
  medicineId: MEDICINE,
  pharmacyId: PHARMACY.id,
  confidence: AvailabilityConfidence.HIGH,
  freshnessMinutes: null,
  requiresConfirmation: false,
  computedAt: new Date(),
  pharmacy: PHARMACY,
  ...over,
});

const savedRow = (over: Record<string, unknown> = {}, signals = [signal()]) => ({
  id: 'saved_1',
  userId: USER,
  medicineId: MEDICINE,
  medicineName: 'Dolo 650',
  priority: 'NORMAL',
  notifiedStatus: null,
  createdAt: new Date(),
  medicine: {
    id: MEDICINE,
    canonicalName: 'Dolo 650',
    genericName: 'Paracetamol',
    availabilitySignals: signals,
  },
  ...over,
});

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

/** A dispatched platform broadcast, the only real source of recall/safety rows. */
const broadcast = (title: string) => ({
  id: 'bc_1',
  title,
  message: 'Please stop using the affected batch.',
  createdAt: new Date(),
});

function buildService({
  rows = [savedRow()],
  prefs = {},
  broadcasts = [] as ReturnType<typeof broadcast>[],
}: {
  rows?: Record<string, unknown>[];
  prefs?: Record<string, boolean>;
  broadcasts?: ReturnType<typeof broadcast>[];
} = {}) {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      // A restock does not demote a back-in-stock row the patient still has;
      // null here means no such row, which is the default for these cases.
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue(broadcasts) },
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

/** Types written during this regeneration. */
const producedTypes = (prisma: { signalNotification: { upsert: jest.Mock } }) =>
  prisma.signalNotification.upsert.mock.calls.map((c) => c[0]?.create?.type);

// A medicine that was out of stock and is now available → back in stock.
const cameBackIntoStock = () => savedRow({ notifiedStatus: 'out-of-stock' });
// Available for a while, with a signal refreshed minutes ago → nearby restock.
const freshlyRestocked = () =>
  savedRow({ notifiedStatus: 'available' }, [signal({ computedAt: new Date(Date.now() - 5 * 60_000) })]);
// Nothing in stock anywhere → running low.
const runningLow = () =>
  savedRow({ notifiedStatus: 'available' }, [signal({ confidence: AvailabilityConfidence.LOW })]);

describe('a switch that is on still produces its notification', () => {
  it('back in stock, on the out-of-stock → available transition', async () => {
    const { service, prisma } = buildService({ rows: [cameBackIntoStock()] });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.BACK_IN_STOCK);
  });

  it('nearby restock, on a freshly refreshed signal', async () => {
    const { service, prisma } = buildService({ rows: [freshlyRestocked()] });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.NEARBY_RESTOCK);
  });

  it('running low, when nothing nearby is stocked', async () => {
    const { service, prisma } = buildService({ rows: [runningLow()] });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.RUNNING_LOW);
  });
});

describe('a switch that is off suppresses it', () => {
  it('produces no back-in-stock alert when backInStock is off', async () => {
    const { service, prisma } = buildService({
      rows: [cameBackIntoStock()],
      prefs: { backInStock: false },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('produces no nearby-restock alert when nearbyRestock is off', async () => {
    const { service, prisma } = buildService({
      rows: [freshlyRestocked()],
      prefs: { nearbyRestock: false },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('produces no running-low alert when runningLow is off', async () => {
    const { service, prisma } = buildService({
      rows: [runningLow()],
      prefs: { runningLow: false },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('governs LIMITED with the same runningLow switch', async () => {
    // Both surface as the one "Running low" row on the settings page, so one
    // switch has to cover both or turning it off leaves half the alerts coming.
    const limited = savedRow({ notifiedStatus: 'available' }, [
      signal({ confidence: AvailabilityConfidence.MODERATE }),
    ]);
    const on = buildService({ rows: [limited] });
    const off = buildService({ rows: [limited], prefs: { runningLow: false } });

    await on.service.listNotifications(USER);
    await off.service.listNotifications(USER);

    expect(producedTypes(on.prisma)).toContain(SignalNotificationType.LIMITED);
    expect(off.prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('switches are independent — one off does not silence the others', async () => {
    const { service, prisma } = buildService({
      rows: [cameBackIntoStock()],
      prefs: { runningLow: false, nearbyRestock: false },
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.BACK_IN_STOCK);
  });
});

describe('turning a switch off clears what it already produced', () => {
  it('prunes rows for that medicine, unread included', async () => {
    // "Do not tell me about this" is not "keep the last one on the page".
    const { service, prisma } = buildService({
      rows: [cameBackIntoStock()],
      prefs: { backInStock: false },
    });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.deleteMany.mock.calls[0];
    expect(args.where.dedupeKey).toEqual({ startsWith: `med:${MEDICINE}:` });
    // Not narrowed to read rows, and not excluding a current key.
    expect(args.where.read).toBeUndefined();
    expect(args.where.NOT).toBeUndefined();
  });

  it('still spares unread rows when there is simply no current event', async () => {
    // The pre-existing behaviour: an alert the patient has not opened in time
    // must not be wiped by a background regeneration.
    const stale = savedRow({ notifiedStatus: 'available' }, [
      signal({ computedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000) }),
    ]);
    const { service, prisma } = buildService({ rows: [stale] });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.deleteMany.mock.calls[0][0].where.read).toBe(true);
  });
});

describe('the transition record advances regardless of the switch', () => {
  it('records the new status even while suppressed, so re-enabling replays nothing', async () => {
    // Otherwise: switch off, medicine returns to stock, switch back on, and a
    // transition from days ago fires as if it had just happened.
    const { service, prisma } = buildService({
      rows: [cameBackIntoStock()],
      prefs: { backInStock: false },
    });

    await service.listNotifications(USER);

    expect(prisma.savedMedicine.update).toHaveBeenCalledWith({
      where: { id: 'saved_1' },
      data: { notifiedStatus: 'available' },
    });
  });

  it('does not duplicate on an unchanged state', async () => {
    // available → available with a stale signal is not an event.
    const unchanged = savedRow({ notifiedStatus: 'available' }, [
      signal({ computedAt: new Date(Date.now() - 10 * 24 * 60 * 60_000) }),
    ]);
    const { service, prisma } = buildService({ rows: [unchanged] });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });
});

describe('platform advisories obey their switches too', () => {
  it('fans a recall broadcast out when recall is on', async () => {
    const { service, prisma } = buildService({
      rows: [],
      broadcasts: [broadcast('Urgent recall: Batch 42')],
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.RECALL);
  });

  it('withholds it when recall is off, and clears the existing row', async () => {
    const { service, prisma } = buildService({
      rows: [],
      broadcasts: [broadcast('Urgent recall: Batch 42')],
      prefs: { recall: false },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
    expect(prisma.signalNotification.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER, dedupeKey: 'broadcast:bc_1' },
    });
  });

  it('treats a non-recall advisory as safety, on its own switch', async () => {
    const advisory = [broadcast('National advisory on paracetamol dosing')];
    const on = buildService({ rows: [], broadcasts: advisory });
    const off = buildService({ rows: [], broadcasts: advisory, prefs: { safety: false } });

    await on.service.listNotifications(USER);
    await off.service.listNotifications(USER);

    expect(producedTypes(on.prisma)).toContain(SignalNotificationType.SAFETY);
    expect(off.prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('keeps a recall coming when only the safety switch is off', async () => {
    const { service, prisma } = buildService({
      rows: [],
      broadcasts: [broadcast('Urgent recall: Batch 42')],
      prefs: { safety: false },
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.RECALL);
  });
});

describe('preferences are per patient', () => {
  it('reads the switches for the account being regenerated', async () => {
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    expect(prisma.signalNotificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER } }),
    );
  });

  it('creates the default set on first use rather than assuming one', async () => {
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    const [args] = prisma.signalNotificationPreference.upsert.mock.calls[0];
    expect(args.create).toEqual({ userId: USER });
    expect(args.update).toEqual({});
  });
});
