import {
  SavedMedicineLinkService,
  normalizeMedicineName,
} from './saved-medicine-link.service';

/**
 * The off-catalog follow loop:
 *
 *   patient saves "Volini Gel" (no MediBase entry, no availability)
 *     → a verified pharmacy later stocks Volini Gel
 *     → the save is linked to the new governed identity
 *     → the patient is told it is now available — exactly once.
 */

const MEDICINE = { id: 'med_volini', canonicalName: 'Volini Gel' };

function buildService(pending: Array<Record<string, unknown>> = []) {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(pending),
      updateMany: jest.fn().mockResolvedValue({ count: pending.length }),
    },
    signalNotificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    signalNotification: { upsert: jest.fn().mockResolvedValue({}) },
  };
  return { service: new SavedMedicineLinkService(prisma as never), prisma };
}

const pendingRow = (over: Record<string, unknown> = {}) => ({
  id: 'saved_1',
  userId: 'user_1',
  medicineName: 'Volini Gel',
  alertsEnabled: true,
  ...over,
});

describe('normalizeMedicineName', () => {
  it('collapses case, spacing and punctuation to one key', () => {
    const key = normalizeMedicineName('Volini Gel');
    expect(normalizeMedicineName('volini gel')).toBe(key);
    expect(normalizeMedicineName('  VOLINI-GEL ')).toBe(key);
    expect(normalizeMedicineName('Volini.Gel')).toBe(key);
    expect(key).toBe('volinigel');
  });

  it('keeps genuinely different medicines apart', () => {
    // Conservative by design: it absorbs formatting, never spelling.
    expect(normalizeMedicineName('Volini Gel')).not.toBe(normalizeMedicineName('Volini Spray'));
    expect(normalizeMedicineName('Amoxicillin')).not.toBe(normalizeMedicineName('Amoxycillin'));
  });

  it('yields an empty key for input with nothing matchable', () => {
    expect(normalizeMedicineName('###')).toBe('');
    expect(normalizeMedicineName('')).toBe('');
  });
});

describe('SavedMedicineLinkService.linkPendingSaves', () => {
  it('links waiting saves and alerts the patient that it is now available', async () => {
    const { service, prisma } = buildService([pendingRow()]);

    await expect(service.linkPendingSaves(MEDICINE)).resolves.toBe(1);

    // Only unlinked rows matching the normalized name are considered.
    expect(prisma.savedMedicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { medicineId: null, normalizedName: 'volinigel' },
      }),
    );

    // The identity is attached and the notified status reset so the regular
    // availability generator treats this as a fresh transition.
    const [update] = prisma.savedMedicine.updateMany.mock.calls[0];
    expect(update.data.medicineId).toBe('med_volini');
    expect(update.data.notifiedStatus).toBeNull();
    expect(update.data.linkedAt).toBeInstanceOf(Date);

    const [notification] = prisma.signalNotification.upsert.mock.calls[0];
    expect(notification.create.type).toBe('BACK_IN_STOCK');
    expect(notification.create.userId).toBe('user_1');
    expect(notification.create.title).toMatch(/Volini Gel is now available/i);
    expect(notification.create.description).toMatch(/now available at a nearby pharmacy/i);
  });

  it('matches regardless of how the pharmacy spelled it', async () => {
    const { service, prisma } = buildService([pendingRow()]);

    await service.linkPendingSaves({ id: 'med_x', canonicalName: '  volini-GEL ' });

    expect(prisma.savedMedicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { medicineId: null, normalizedName: 'volinigel' } }),
    );
  });

  it('does nothing when nobody is waiting on that medicine', async () => {
    const { service, prisma } = buildService([]);

    await expect(service.linkPendingSaves(MEDICINE)).resolves.toBe(0);
    expect(prisma.savedMedicine.updateMany).not.toHaveBeenCalled();
    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('notifies every patient waiting on the medicine', async () => {
    const { service, prisma } = buildService([
      pendingRow({ id: 's1', userId: 'user_1' }),
      pendingRow({ id: 's2', userId: 'user_2' }),
      pendingRow({ id: 's3', userId: 'user_3' }),
    ]);

    await expect(service.linkPendingSaves(MEDICINE)).resolves.toBe(3);
    expect(prisma.signalNotification.upsert).toHaveBeenCalledTimes(3);
    expect(
      prisma.signalNotification.upsert.mock.calls.map(([args]) => args.create.userId).sort(),
    ).toEqual(['user_1', 'user_2', 'user_3']);
  });

  describe('duplicate prevention', () => {
    it('upserts on a stable per-medicine key rather than inserting', async () => {
      const { service, prisma } = buildService([pendingRow()]);

      await service.linkPendingSaves(MEDICINE);

      const [args] = prisma.signalNotification.upsert.mock.calls[0];
      // A second pharmacy stocking the same medicine, a retry, or a replayed
      // import all resolve to this same row.
      expect(args.where).toEqual({
        userId_dedupeKey: { userId: 'user_1', dedupeKey: 'saved-linked:med_volini' },
      });
    });

    it('never resurrects a notification the patient already handled', async () => {
      const { service, prisma } = buildService([pendingRow()]);

      await service.linkPendingSaves(MEDICINE);

      const [args] = prisma.signalNotification.upsert.mock.calls[0];
      // Refreshing copy is fine; read/dismissed/archived must not be reset.
      expect(args.update).not.toHaveProperty('read');
      expect(args.update).not.toHaveProperty('dismissed');
      expect(args.update).not.toHaveProperty('archived');
    });

    it('re-running the link does not double-notify', async () => {
      const { service, prisma } = buildService([pendingRow()]);
      await service.linkPendingSaves(MEDICINE);

      // Second run: the rows are linked now, so nothing is pending.
      prisma.savedMedicine.findMany.mockResolvedValue([]);
      await service.linkPendingSaves(MEDICINE);

      expect(prisma.signalNotification.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('alert settings', () => {
    it('links the medicine but stays silent when alerts are off for that save', async () => {
      const { service, prisma } = buildService([pendingRow({ alertsEnabled: false })]);

      await expect(service.linkPendingSaves(MEDICINE)).resolves.toBe(1);
      // Still linked — the patient sees it on the Saved page…
      expect(prisma.savedMedicine.updateMany).toHaveBeenCalled();
      // …but is not alerted.
      expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
    });

    it('respects the patient turning restock alerts off globally', async () => {
      const { service, prisma } = buildService([pendingRow()]);
      prisma.signalNotificationPreference.findUnique.mockResolvedValue({ backInStock: false });

      await service.linkPendingSaves(MEDICINE);
      expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
    });

    it('alerts when no preferences have been set yet', async () => {
      const { service, prisma } = buildService([pendingRow()]);
      prisma.signalNotificationPreference.findUnique.mockResolvedValue(null);

      await service.linkPendingSaves(MEDICINE);
      expect(prisma.signalNotification.upsert).toHaveBeenCalledTimes(1);
    });
  });

  it('never lets a linking failure break the pharmacy inventory write', async () => {
    const { service, prisma } = buildService([pendingRow()]);
    prisma.savedMedicine.updateMany.mockRejectedValue(new Error('db down'));

    await expect(service.linkPendingSaves(MEDICINE)).resolves.toBe(0);
  });

  it('ignores a medicine whose name normalizes to nothing', async () => {
    const { service, prisma } = buildService([pendingRow()]);

    await expect(service.linkPendingSaves({ id: 'm', canonicalName: '###' })).resolves.toBe(0);
    expect(prisma.savedMedicine.findMany).not.toHaveBeenCalled();
  });
});
