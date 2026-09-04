import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { VerificationService } from './verification.service';

/**
 * Verification review notifies the pharmacy that submitted the request — unless
 * that member has switched verification updates off.
 *
 * The check belongs here, at the point of creation, so a preference turned off
 * stops future notices without touching the ones already delivered. Filtering
 * on the way out would have hidden their own history from them.
 */

const REQUEST = {
  id: 'req_1',
  pharmacyId: 'ph_1',
  pharmacyName: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-1',
  submittedBy: 'Keiko Tanaka (manager@zoikomeds.io)',
  status: 'PENDING',
  notes: null,
};

function buildService({ wantsUpdates }: { wantsUpdates: boolean }) {
  const tx = {
    verificationRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async () => ({ ...REQUEST, status: 'APPROVED' })),
      findUnique: jest.fn().mockResolvedValue(REQUEST),
    },
    user: {
      // The reviewer performing the review, and the member who submitted it.
      findUnique: jest.fn().mockResolvedValue({ id: 'admin_1', fullName: 'Super Admin' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'user_1', pharmacyId: 'ph_1' }),
      update: jest.fn(),
    },
    pharmacy: {
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      // Approval reads the pharmacy's coordinates to decide whether it can be
      // listed as well as verified. Located, so these specs stay about
      // notification preferences.
      findUnique: jest.fn().mockResolvedValue({ latitude: 17.5561, longitude: 78.4181 }),
    },
    signalNotification: { create: jest.fn() },
    pharmacyNotificationPreference: {
      findUnique: jest.fn().mockResolvedValue({
        inventoryAlerts: true,
        verificationUpdates: wantsUpdates,
        uploadResults: true,
        systemMessages: true,
      }),
    },
  };

  const prisma = {
    verificationRequest: {
      findUnique: jest.fn().mockResolvedValue(REQUEST),
      // Asked by the DTO mapper: has this pharmacy ever had a request approved?
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const service = new VerificationService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );
  return { service, tx };
}

const approve = (service: VerificationService) =>
  service.update('admin_1', 'req_1', { status: 'APPROVED' } as never);

describe('verification review honours the recipient’s preference', () => {
  it('notifies a member who wants verification updates', async () => {
    const { service, tx } = buildService({ wantsUpdates: true });

    await approve(service);

    expect(tx.signalNotification.create).toHaveBeenCalledTimes(1);
    const [args] = tx.signalNotification.create.mock.calls[0];
    expect(args.data).toMatchObject({ userId: 'user_1' });
  });

  it('does not notify a member who switched them off', async () => {
    const { service, tx } = buildService({ wantsUpdates: false });

    await approve(service);

    expect(tx.signalNotification.create).not.toHaveBeenCalled();
  });

  it('still performs the review itself when notifications are off', async () => {
    // The preference silences the notice, not the decision.
    const { service, tx } = buildService({ wantsUpdates: false });

    await approve(service);

    expect(tx.pharmacy.update).toHaveBeenCalled();
    expect(tx.verificationRequest.update).toHaveBeenCalled();
  });

  it('asks about the member being notified, inside the same transaction', async () => {
    const { service, tx } = buildService({ wantsUpdates: true });

    await approve(service);

    expect(tx.pharmacyNotificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
  });
});
