import { AvailabilityConfidence, SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * Stock Alerts on the patient notifications page (MN-25).
 *
 * The section was permanently empty for a medicine that is actually in stock.
 * Every other category on that page can also be filled by a dispatched admin
 * broadcast, so stock was the one that had nothing else to fall back on and the
 * one that read as broken.
 *
 * The cause was a read of `AvailabilitySignal.freshnessMinutes`, which nothing
 * in the platform writes: the pharmacy portal's upsert sets `confidence` and
 * `computedAt` only. So the restock branch — the only notification an in-stock
 * saved medicine can produce — tested a column that is always null and never
 * fired.
 */

const USER = 'user_1';
const MEDICINE = 'med_1';

const PHARMACY = {
  id: 'ph_1',
  name: 'Apollo Kompally',
  latitude: 17.5561,
  longitude: 78.4181,
};

/** A signal as the pharmacy portal actually writes one: no freshnessMinutes. */
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

function buildService(rows: Record<string, unknown>[]) {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    // Regeneration now reads the patient's switches before producing anything.
    // These specs are about which event is detected, so every switch is on —
    // the defaults a new account gets.
    signalNotificationPreference: {
      upsert: jest.fn().mockResolvedValue({
        userId: USER,
        runningLow: true,
        backInStock: true,
        nearbyRestock: true,
        recall: true,
        safety: true,
        push: true,
        email: false,
        sms: false,
      }),
    },
  };
  // No caller location in these units: they are about notification state, and
  // a null origin is exactly what a patient who has not shared one produces.
  const service = new PatientSignalService(prisma as never, {
    resolveOrigin: jest.fn().mockResolvedValue(null),
  } as never);
  return { service, prisma };
}

/** The notification regeneration wrote, if it wrote one. */
const upserted = (prisma: { signalNotification: { upsert: jest.Mock } }) =>
  prisma.signalNotification.upsert.mock.calls[0]?.[0];

describe('Stock Alerts for a saved medicine that is in stock (MN-25)', () => {
  it('raises a restock alert from a signal written minutes ago', async () => {
    // freshnessMinutes is null, as it is on every row the portal writes. The age
    // has to come from computedAt or there is no event to report.
    const { service, prisma } = buildService([
      savedRow({}, [signal({ computedAt: new Date(Date.now() - 5 * 60_000) })]),
    ]);

    await service.listNotifications(USER);

    expect(upserted(prisma)?.create?.type).toBe(SignalNotificationType.NEARBY_RESTOCK);
    expect(upserted(prisma)?.create?.medicineId).toBe(MEDICINE);
  });

  it('says nothing about a signal that has not been refreshed for days', async () => {
    // An old signal is not an event. Silence here is the honest answer, and it
    // is what makes the case above a restock rather than a status readout.
    const { service, prisma } = buildService([
      savedRow({}, [signal({ computedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000) })]),
    ]);

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('still prefers a stored freshness snapshot when a row has one', async () => {
    const { service, prisma } = buildService([
      // Written long ago but explicitly snapshotted as fresh: the stored value
      // wins, because it is the one the rest of the platform quotes.
      savedRow({}, [
        signal({ freshnessMinutes: 10, computedAt: new Date(Date.now() - 90 * 24 * 60 * 60_000) }),
      ]),
    ]);

    await service.listNotifications(USER);

    expect(upserted(prisma)?.create?.type).toBe(SignalNotificationType.NEARBY_RESTOCK);
  });

  it('reports a medicine coming back into stock as back-in-stock, not a restock', async () => {
    const { service, prisma } = buildService([
      savedRow({ notifiedStatus: 'out-of-stock' }),
    ]);

    await service.listNotifications(USER);

    expect(upserted(prisma)?.create?.type).toBe(SignalNotificationType.BACK_IN_STOCK);
  });

  it('keeps an unread alert the patient has not opened the page in time to see', async () => {
    // Regeneration runs on read and a restock stops being current after three
    // hours, so pruning on "no current event" used to delete the alert itself.
    const { service, prisma } = buildService([
      savedRow({}, [signal({ computedAt: new Date(Date.now() - 5 * 60 * 60_000) })]),
    ]);

    await service.listNotifications(USER);

    const [{ where }] = prisma.signalNotification.deleteMany.mock.calls[0];
    expect(where.read).toBe(true);
  });

  it('still replaces the previous alert when the state moves on', async () => {
    // A superseding event must clear whatever the medicine said before, read or
    // not, or the page shows two contradictory answers for one medicine.
    const { service, prisma } = buildService([
      savedRow({ notifiedStatus: 'available' }, [
        signal({ confidence: AvailabilityConfidence.LOW }),
      ]),
    ]);

    await service.listNotifications(USER);

    const [{ where }] = prisma.signalNotification.deleteMany.mock.calls[0];
    expect(where.read).toBeUndefined();
    expect(where.NOT).toEqual({ dedupeKey: `med:${MEDICINE}:running-low` });
  });
});

describe('choosing which pharmacy an alert names', () => {
  it('prefers the more recently refreshed signal at equal confidence', async () => {
    const stale = signal({
      id: 'sig_stale',
      computedAt: new Date(Date.now() - 170 * 60_000),
      pharmacy: { ...PHARMACY, id: 'ph_stale', name: 'Stale Pharmacy' },
    });
    const fresh = signal({
      id: 'sig_fresh',
      computedAt: new Date(Date.now() - 2 * 60_000),
      pharmacy: { ...PHARMACY, id: 'ph_fresh', name: 'Fresh Pharmacy' },
    });
    const { service, prisma } = buildService([savedRow({}, [stale, fresh])]);

    await service.listNotifications(USER);

    // Both are in the restock window, so the tie is broken on age. Read raw,
    // freshnessMinutes made every signal equally stale and the order was decided
    // by whichever row came back first.
    expect(upserted(prisma)?.create?.description).toContain('Fresh Pharmacy');
  });
});
