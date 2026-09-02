import { SafetyAlertKind, SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * Which patients a safety broadcast reaches, and on whose authority.
 *
 * Two things were wrong with the old answer. The category came from
 * `/recall/i.test(title)`, so "Urgent product withdrawal" reached patients as a
 * government advisory and a recall drill announcement reached them as a recall
 * — the toggle that governed a broadcast depended on its wording. And the
 * category is what decides eligibility, so a mis-classified broadcast was
 * delivered to the wrong set of people.
 *
 * The classification is now the enum the dispatching administrator chose. The
 * per-user gate itself was already right and these tests hold it: a row is
 * never written for a user whose toggle is off, and one already written is
 * removed when they turn it off. Nothing is created for everybody and hidden.
 */

const USER = 'user_1';

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

const broadcast = (over: Record<string, unknown> = {}) => ({
  id: 'bc_1',
  title: 'Urgent product withdrawal',
  message: 'Return affected packs to your pharmacy.',
  safetyKind: SafetyAlertKind.MEDICINE_RECALL,
  createdAt: new Date(),
  ...over,
});

function buildService({
  prefs = {},
  broadcasts = [broadcast()],
}: {
  prefs?: Record<string, boolean>;
  broadcasts?: Record<string, unknown>[];
} = {}) {
  const merged = { ...ALL_ON, ...prefs };
  const prisma: any = {
    // No saved medicines, so the only thing regeneration can produce is the
    // broadcast fan-out under test.
    savedMedicine: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue(broadcasts) },
    signalNotificationPreference: {
      upsert: jest.fn().mockResolvedValue(merged),
      findUnique: jest.fn().mockResolvedValue(merged),
    },
  };
  const service = new PatientSignalService(prisma as never, {
    resolveOrigin: jest.fn().mockResolvedValue(null),
  } as never);
  return { service, prisma };
}

/** The notification types written for this user during this regeneration. */
const delivered = (prisma: { signalNotification: { upsert: jest.Mock } }) =>
  prisma.signalNotification.upsert.mock.calls.map((c) => c[0]?.create?.type);

const RECALL = broadcast({ id: 'bc_recall', safetyKind: SafetyAlertKind.MEDICINE_RECALL });
const ADVISORY = broadcast({
  id: 'bc_advisory',
  title: 'National regulator advisory',
  safetyKind: SafetyAlertKind.GOVERNMENT_SAFETY,
});

describe('the chosen category decides the classification, not the title', () => {
  it('files a withdrawal chosen as Medicine Recall as a recall', async () => {
    // The word "recall" is absent from the title. It used to be the only thing
    // that mattered.
    const { service, prisma } = buildService({
      broadcasts: [broadcast({ title: 'Urgent product withdrawal' })],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.RECALL]);
  });

  it('files a regulator advisory chosen as Government Safety as safety', async () => {
    const { service, prisma } = buildService({ broadcasts: [ADVISORY] });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.SAFETY]);
  });

  it('ignores the word "recall" in the title when the category says otherwise', async () => {
    // A recall *drill* announcement is not a recall. Under the old rule it was.
    const { service, prisma } = buildService({
      broadcasts: [
        broadcast({
          title: 'Recall drill on Sunday — no patient action needed',
          safetyKind: SafetyAlertKind.GOVERNMENT_SAFETY,
        }),
      ],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.SAFETY]);
  });
});

describe('a legacy broadcast filed before the category existed', () => {
  it('still reads as a recall from its title', async () => {
    // Nothing historical was rewritten; a null category keeps the old reading.
    const { service, prisma } = buildService({
      broadcasts: [broadcast({ title: 'Medicine recall: batch 41A', safetyKind: null })],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.RECALL]);
  });

  it('still reads as safety otherwise', async () => {
    const { service, prisma } = buildService({
      broadcasts: [broadcast({ title: 'Heatwave health advisory', safetyKind: null })],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.SAFETY]);
  });

  it('remains readable rather than being dropped', async () => {
    const { service, prisma } = buildService({
      broadcasts: [broadcast({ safetyKind: null })],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).toHaveBeenCalled();
  });
});

describe('each patient is judged on their own switches', () => {
  it('user with recall on receives the recall', async () => {
    const { service, prisma } = buildService({
      prefs: { recall: true },
      broadcasts: [RECALL],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.RECALL]);
  });

  it('user with recall off gets no record written at all', async () => {
    // Not created and then hidden — never created.
    const { service, prisma } = buildService({
      prefs: { recall: false },
      broadcasts: [RECALL],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('user with safety on receives the advisory', async () => {
    const { service, prisma } = buildService({
      prefs: { safety: true },
      broadcasts: [ADVISORY],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.SAFETY]);
  });

  it('user with safety off gets no record written at all', async () => {
    const { service, prisma } = buildService({
      prefs: { safety: false },
      broadcasts: [ADVISORY],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('recall on, safety off — only the recall', async () => {
    const { service, prisma } = buildService({
      prefs: { recall: true, safety: false },
      broadcasts: [RECALL, ADVISORY],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.RECALL]);
  });

  it('recall off, safety on — only the advisory', async () => {
    const { service, prisma } = buildService({
      prefs: { recall: false, safety: true },
      broadcasts: [RECALL, ADVISORY],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([SignalNotificationType.SAFETY]);
  });

  it('both off — neither', async () => {
    const { service, prisma } = buildService({
      prefs: { recall: false, safety: false },
      broadcasts: [RECALL, ADVISORY],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.upsert).not.toHaveBeenCalled();
  });

  it('both on — both', async () => {
    const { service, prisma } = buildService({
      prefs: { recall: true, safety: true },
      broadcasts: [RECALL, ADVISORY],
    });

    await service.listNotifications(USER);

    expect(delivered(prisma)).toEqual([
      SignalNotificationType.RECALL,
      SignalNotificationType.SAFETY,
    ]);
  });

  it('reads the switches of the user being served, and no one else', async () => {
    const { service, prisma } = buildService({ broadcasts: [RECALL] });

    await service.listNotifications(USER);

    // Regeneration runs per user on every read of this surface, so one
    // patient's choice can never stand in for another's.
    const [args] = prisma.signalNotificationPreference.upsert.mock.calls[0];
    expect(args.where).toEqual({ userId: USER });
  });

  it('turning a switch off withdraws a row already written for that user', async () => {
    // "Do not tell me about this" is not "keep the last one on the page".
    const { service, prisma } = buildService({
      prefs: { recall: false },
      broadcasts: [RECALL],
    });

    await service.listNotifications(USER);

    expect(prisma.signalNotification.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER, dedupeKey: 'broadcast:bc_recall' },
    });
  });
});

describe('the recipient group is applied before any preference', () => {
  it('only reads broadcasts addressed to all users', async () => {
    // ALL_USERS is the one target that addresses patients; a safety alert sent
    // to pharmacy managers or partners reaches no patient however their
    // switches are set.
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    const [args] = prisma.notification.findMany.mock.calls[0];
    expect(args.where).toMatchObject({
      status: 'DISPATCHED',
      target: 'ALL_USERS',
      type: 'EMERGENCY_ALERT',
    });
  });

  it('never fans out a non-emergency broadcast', async () => {
    // Platform Update, Maintenance and System Announcement are excluded by that
    // query, so neither safety toggle governs them and they cannot reach
    // ZoikoSignal at all.
    const { service, prisma } = buildService();

    await service.listNotifications(USER);

    expect(prisma.notification.findMany.mock.calls[0][0].where.type).toBe(
      'EMERGENCY_ALERT',
    );
  });
});

describe('the row a patient receives', () => {
  it('carries the broadcast copy and a stable dedupe key', async () => {
    const { service, prisma } = buildService({ broadcasts: [RECALL] });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.upsert.mock.calls[0];
    expect(args.where).toEqual({
      userId_dedupeKey: { userId: USER, dedupeKey: 'broadcast:bc_recall' },
    });
    expect(args.create).toMatchObject({
      userId: USER,
      type: SignalNotificationType.RECALL,
      title: 'Urgent product withdrawal',
      description: 'Return affected packs to your pharmacy.',
    });
  });

  it('does not disturb read, archived or dismissed state on a re-read', async () => {
    // Regeneration runs on every read, so the update half must refresh copy
    // only — otherwise reading the page would mark everything unread again.
    const { service, prisma } = buildService({ broadcasts: [RECALL] });

    await service.listNotifications(USER);

    const [args] = prisma.signalNotification.upsert.mock.calls[0];
    expect(Object.keys(args.update)).toEqual(['title', 'description']);
  });
});
