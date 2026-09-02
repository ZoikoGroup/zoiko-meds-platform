import { AvailabilityConfidence, SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * Two defects on the same loop in `regenerate()`.
 *
 * 1. The "Alerts enabled" switch on a saved-medicine card did nothing.
 *    `SavedMedicine.alertsEnabled` was written correctly by
 *    PATCH /me/saved/:id/alerts and read back correctly by the saved list — and
 *    then nothing consumed it. A grep for the column across the backend found
 *    one caller, in the off-catalog link service. ZoikoSignal went on producing
 *    running-low, back-in-stock, limited and restock notifications for a
 *    medicine the patient had explicitly muted.
 *
 * 2. A genuine BACK_IN_STOCK notification was destroyed before anyone could
 *    see it. Availability stays `available` for the three-hour restock window,
 *    so once `notifiedStatus` advanced the next derivation returned the
 *    informational NEARBY_RESTOCK — and the prune, which keeps only the row
 *    matching the current key, deleted the unread back-in-stock row. Since
 *    every read of this surface regenerates and the page reads it several times
 *    per load, the demotion landed inside the same page load. The "Back in
 *    Stock" filter could only ever count zero.
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
  alertsEnabled: true,
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

/** The dedupe key a live back-in-stock row for this medicine would carry. */
const BACK_IN_STOCK_KEY = `med:${MEDICINE}:back-in-stock`;

function buildService({
  rows = [savedRow()],
  standingBackInStock = null as { id: string } | null,
}: {
  rows?: Record<string, unknown>[];
  standingBackInStock?: { id: string } | null;
} = {}) {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(standingBackInStock),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    signalNotificationPreference: {
      upsert: jest.fn().mockResolvedValue(ALL_ON),
      findUnique: jest.fn().mockResolvedValue(ALL_ON),
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

const muted = (over: Record<string, unknown> = {}, signals?: ReturnType<typeof signal>[]) =>
  savedRow({ alertsEnabled: false, ...over }, signals);

// The four states a saved medicine can notify from.
const cameBackIntoStock = (over = {}) => ({ notifiedStatus: 'out-of-stock', ...over });
const freshlyRestocked = () => [signal({ computedAt: new Date(Date.now() - 5 * 60_000) })];
const nothingInStock = () => [signal({ confidence: AvailabilityConfidence.LOW })];

describe('a saved medicine with alerts switched off notifies about nothing', () => {
  it.each([
    ['back in stock', cameBackIntoStock(), undefined],
    ['nearby restock', { notifiedStatus: 'available' }, freshlyRestocked()],
    ['running low', { notifiedStatus: 'available' }, nothingInStock()],
    [
      'limited',
      { notifiedStatus: 'available' },
      [signal({ confidence: AvailabilityConfidence.MODERATE })],
    ],
  ])('produces no %s notification', async (_label, over, signals) => {
    const { service, prisma } = buildService({ rows: [muted(over, signals)] });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('clears the rows it had already written, unread included', async () => {
    // "Do not tell me about this medicine" is not "keep the last alert on the
    // page forever" — the same semantics a global switch already had.
    const { service, prisma } = buildService({ rows: [muted(cameBackIntoStock())] });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.deleteMany.mock.calls[0];
    expect(args.where.dedupeKey).toEqual({ startsWith: `med:${MEDICINE}:` });
    expect(args.where.read).toBeUndefined();
    expect(args.where.NOT).toBeUndefined();
  });

  it('still advances notifiedStatus, so switching back on replays nothing', async () => {
    const { service, prisma } = buildService({ rows: [muted(cameBackIntoStock())] });

    await service.listNotifications(USER);

    expect(prisma.savedMedicine.update).toHaveBeenCalledWith({
      where: { id: 'saved_1' },
      data: { notifiedStatus: 'available' },
    });
  });

  it('does not remove the medicine from the saved list', async () => {
    // The switch mutes notifications. The patient is still following it, and
    // the status surfaces must keep reporting it.
    const { service } = buildService({ rows: [muted()] });

    const rows = await service.savedStatus(USER, {});

    expect(rows).toHaveLength(1);
  });
})

describe('a saved medicine with alerts switched on is unaffected', () => {
  it.each([
    ['back in stock', cameBackIntoStock(), undefined, SignalNotificationType.BACK_IN_STOCK],
    [
      'nearby restock',
      { notifiedStatus: 'available' },
      freshlyRestocked(),
      SignalNotificationType.NEARBY_RESTOCK,
    ],
    [
      'running low',
      { notifiedStatus: 'available' },
      nothingInStock(),
      SignalNotificationType.RUNNING_LOW,
    ],
  ])('still produces %s', async (_label, over, signals, expected) => {
    const { service, prisma } = buildService({ rows: [savedRow(over, signals)] });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(expected);
  });

  it('treats a missing column as on, so an older row is not silently muted', async () => {
    const { service, prisma } = buildService({
      rows: [savedRow({ ...cameBackIntoStock(), alertsEnabled: undefined })],
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toContain(SignalNotificationType.BACK_IN_STOCK);
  });
})

describe('a back-in-stock notification survives long enough to be seen', () => {
  it('is not demoted to a restock while it is still on the page', async () => {
    // The reported case: the medicine is available, notifiedStatus has already
    // advanced, and the signal is inside the three-hour restock window — which
    // used to re-derive NEARBY_RESTOCK and prune the back-in-stock row.
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: { id: 'notif_1' },
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toEqual([SignalNotificationType.BACK_IN_STOCK]);
  });

  it('keeps its own row rather than pruning it', async () => {
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: { id: 'notif_1' },
    });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.deleteMany.mock.calls[0];
    expect(args.where.NOT).toEqual({ dedupeKey: BACK_IN_STOCK_KEY });
  });

  it('looks for the row under the key the filter reads', async () => {
    // The chip matches on the UI type string, so the lookup has to use the same
    // one the writer used.
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: { id: 'notif_1' },
    });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.findFirst.mock.calls[0];
    expect(args.where).toMatchObject({
      userId: USER,
      dedupeKey: BACK_IN_STOCK_KEY,
      dismissed: false,
      archived: false,
    });
  });

  it('falls back to a restock when there is no back-in-stock row to keep', async () => {
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: null,
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toEqual([SignalNotificationType.NEARBY_RESTOCK]);
  });

  it('does not resurrect one the patient dismissed', async () => {
    // findFirst is scoped to dismissed/archived false, so a cleared row returns
    // null and the restock stands.
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: null,
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).not.toContain(SignalNotificationType.BACK_IN_STOCK);
  });

  it('does not keep one for a medicine that has since run out', async () => {
    // Back in stock is only true while the medicine is in stock.
    const { service, prisma } = buildService({
      rows: [savedRow({ notifiedStatus: 'available' }, nothingInStock())],
      standingBackInStock: { id: 'notif_1' },
    });

    await service.listNotifications(USER);

    expect(producedTypes(prisma)).toEqual([SignalNotificationType.RUNNING_LOW]);
  });

  it('does not consult the log at all for a muted medicine', async () => {
    const { service, prisma } = buildService({
      rows: [muted({ notifiedStatus: 'available' }, freshlyRestocked())],
      standingBackInStock: { id: 'notif_1' },
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.findFirst).not.toHaveBeenCalled();
  });
})
