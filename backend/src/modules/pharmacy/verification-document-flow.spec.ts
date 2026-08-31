import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * Submitting a licence document with a verification request.
 *
 * The Verification Center has always shown an "Uploaded Documents" panel, and
 * the request row has always had docName/docUrl. Nothing ever wrote them: the
 * portal had no upload control and its submit path never touched those columns,
 * so every self-submitted request reached a reviewer reading "No document".
 */

const PDF = Buffer.from('%PDF-1.4\nlicence\n%%EOF\n', 'latin1').toString('base64');
const NOT_A_PDF = Buffer.from('MZ this is an executable').toString('base64');

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: 'ph_1',
};

const STORED = {
  id: 'ph_1',
  name: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-1',
  phone: '+91 40 2345 6789',
  addressLine1: 'Gandimaisamma',
  addressLine2: null,
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500043',
  latitude: 17.5878,
  longitude: 78.4236,
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  reliabilityScore: 0.9,
  commercialClassification: 'NETWORK_CORE',
};

function buildService({ requestId = 'req_1' }: { requestId?: string | null } = {}) {
  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(STORED),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => ({ ...STORED, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'ph_new', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ pharmacyId: 'ph_1' }), update: jest.fn() },
    verificationRequest: {
      findFirst: jest.fn().mockResolvedValue(requestId ? { id: requestId } : null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    verificationDocument: { upsert: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );
  return { service, prisma };
}

const withDocument = (over: Record<string, unknown> = {}) => ({
  addressLine2: 'Near the metro',
  document: { filename: 'pharmacy-licence.pdf', content: PDF },
  ...over,
});

describe('a document submitted with the profile', () => {
  it('is stored against the pharmacy’s open verification request', async () => {
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(args.where).toEqual({ verificationRequestId: 'req_1' });
    expect(args.create).toMatchObject({
      verificationRequestId: 'req_1',
      pharmacyId: 'ph_1',
      uploadedById: 'user_1',
      filename: 'pharmacy-licence.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('fills in the fields the Verification Center reads', async () => {
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);

    const call = prisma.verificationRequest.update.mock.calls.at(-1)[0];
    expect(call.where).toEqual({ id: 'req_1' });
    expect(call.data).toEqual({
      docName: 'pharmacy-licence.pdf',
      // An authenticated API path, not a storage URL — there is nothing public
      // to leak and nothing to expire.
      docUrl: '/admin/verification-requests/req_1/document',
    });
  });

  it('replaces the document on the open request rather than adding a second', async () => {
    // A pharmacy that corrects its profile and re-uploads must not leave the
    // reviewer choosing between two files.
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);
    await service.updateProfile('ph_1', withDocument() as never, USER);

    expect(prisma.verificationDocument.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of prisma.verificationDocument.upsert.mock.calls) {
      expect(args.where).toEqual({ verificationRequestId: 'req_1' });
    }
  });

  it('stores the bytes, not the string it was sent as', async () => {
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(Buffer.isBuffer(args.create.data)).toBe(true);
    expect(args.create.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(args.create.sizeBytes).toBe(args.create.data.length);
  });

  it('leaves the stored document alone on a save that does not include one', async () => {
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', { addressLine2: 'Near the metro' } as never, USER);

    expect(prisma.verificationDocument.upsert).not.toHaveBeenCalled();
    expect(prisma.pharmacy.update).toHaveBeenCalled();
  });
});

describe('a document the API will not accept', () => {
  it('fails the whole submission', async () => {
    const { service } = buildService();

    await expect(
      service.updateProfile(
        'ph_1',
        withDocument({ document: { filename: 'licence.pdf', content: NOT_A_PDF } }) as never,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not save the profile either — no half-done submission', async () => {
    // Reporting a successful submission for a request the reviewer cannot act
    // on is the failure mode worth preventing.
    const { service, prisma } = buildService();

    await expect(
      service.updateProfile(
        'ph_1',
        withDocument({ document: { filename: 'licence.pdf', content: NOT_A_PDF } }) as never,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.pharmacy.update).not.toHaveBeenCalled();
    expect(prisma.verificationDocument.upsert).not.toHaveBeenCalled();
    expect(prisma.verificationRequest.update).not.toHaveBeenCalled();
  });

  it('refuses an oversized file before writing anything', async () => {
    const { service, prisma } = buildService();
    const huge = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(6 * 1024 * 1024, 7),
    ]).toString('base64');

    await expect(
      service.updateProfile(
        'ph_1',
        withDocument({ document: { filename: 'big.pdf', content: huge } }) as never,
        USER,
      ),
    ).rejects.toThrow(/under 5 MB/);
    expect(prisma.pharmacy.update).not.toHaveBeenCalled();
  });
});

describe('a document can only be attached to the caller’s own request', () => {
  it('resolves the request from the pharmacy being saved, never from the request body', async () => {
    // There is no request id in the payload to point elsewhere: the target is
    // looked up from the pharmacy the session belongs to.
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);

    expect(prisma.verificationRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pharmacyId: 'ph_1' } }),
    );
  });

  it('records which pharmacy the document belongs to', async () => {
    const { service, prisma } = buildService();

    await service.updateProfile('ph_1', withDocument() as never, USER);

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(args.create.pharmacyId).toBe('ph_1');
    expect(args.update.pharmacyId).toBe('ph_1');
  });

  it('refuses when the pharmacy has no verification request to attach to', async () => {
    const { service } = buildService({ requestId: null });

    await expect(service.updateProfile('ph_1', withDocument() as never, USER)).rejects.toThrow(
      /no open verification request/i,
    );
  });
});

describe('the portal shows what is currently attached', () => {
  it('returns the document metadata, and never its bytes', async () => {
    const { service, prisma } = buildService();
    prisma.verificationRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      status: 'PENDING',
      reviewer: null,
      notes: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      document: {
        filename: 'pharmacy-licence.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      },
    });

    const profile = await service.getProfile('ph_1', USER);

    expect(profile.document).toMatchObject({
      filename: 'pharmacy-licence.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    });
    expect(JSON.stringify(profile)).not.toContain('%PDF');
  });

  it('reports null when nothing has been uploaded', async () => {
    const { service, prisma } = buildService();
    prisma.verificationRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      status: 'PENDING',
      reviewer: null,
      notes: null,
      createdAt: new Date(),
      document: null,
    });

    const profile = await service.getProfile('ph_1', USER);
    expect(profile.document).toBeNull();
  });
});
