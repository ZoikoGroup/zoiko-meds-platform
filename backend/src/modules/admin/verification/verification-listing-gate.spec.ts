import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { VerificationService } from './verification.service';

/**
 * Approving a licence is not the same act as putting the pharmacy in front of
 * patients.
 *
 * They were one write. A verification request that arrives without a pharmacy
 * row creates one with no address and no coordinates, and approving the licence
 * marked it participating - so it counted as part of the verified network while
 * every distance-bounded patient search dropped it for having no pin. Two such
 * pharmacies sat in the production network for weeks, reading as healthy and
 * verified in the console the whole time.
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

function buildService(coords: { latitude: number | null; longitude: number | null }) {
  const tx: any = {
    verificationRequest: {
      update: jest.fn(async () => ({ ...REQUEST, status: 'APPROVED' })),
      findUnique: jest.fn().mockResolvedValue(REQUEST),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'admin_1', fullName: 'Super Admin' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'user_1', pharmacyId: 'ph_1' }),
      update: jest.fn(),
    },
    pharmacy: {
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(coords),
    },
    signalNotification: { create: jest.fn() },
    pharmacyNotificationPreference: {
      findUnique: jest.fn().mockResolvedValue({
        inventoryAlerts: true,
        verificationUpdates: true,
        uploadResults: true,
        systemMessages: true,
      }),
    },
  };

  const prisma = {
    verificationRequest: { findUnique: jest.fn().mockResolvedValue(REQUEST) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const service = new VerificationService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );
  return { service, tx };
}

/** What approval wrote to the pharmacy row. */
const written = (tx: any) =>
  tx.pharmacy.update.mock.calls.find(
    (c: any[]) => c[0]?.data?.verificationStatus === 'VERIFIED',
  )?.[0].data;

describe('approving a verification request', () => {
  it('verifies and lists a pharmacy that has a position', async () => {
    const { service, tx } = buildService({ latitude: 17.5561, longitude: 78.4181 });

    await service.update('admin_1', 'req_1', { status: 'APPROVED' } as never);

    expect(written(tx)).toMatchObject({
      verificationStatus: 'VERIFIED',
      isParticipating: true,
    });
  });

  it('verifies a pharmacy with no position but does not list it', async () => {
    const { service, tx } = buildService({ latitude: null, longitude: null });

    await service.update('admin_1', 'req_1', { status: 'APPROVED' } as never);

    // The licence judgement stands on its own merits - the reviewer read the
    // document and approved it. What is withheld is the separate claim to a
    // patient that there is somewhere to go, which nothing here can support.
    expect(written(tx)).toMatchObject({
      verificationStatus: 'VERIFIED',
      isParticipating: false,
    });
  });
});
