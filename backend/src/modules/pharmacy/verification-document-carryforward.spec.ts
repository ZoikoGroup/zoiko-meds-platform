import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * A licence document surviving the request it arrived on.
 *
 * VerificationDocument is keyed `verificationRequestId @unique` — one document
 * per request — and nothing ever copied one forward. So the flow the reviewer
 * actually hit was:
 *
 *   request A filed → licence.pdf attached to A → admin approves or rejects A
 *   → pharmacy corrects its profile and resubmits → no open request, so
 *   request B is created → B has docName null → the Verification Center opens B
 *   and reads "No document", while the file sits on the closed request beside
 *   it. The pharmacy's own profile page reverted to "No document uploaded yet"
 *   at the same time, under a banner still saying the submission was in review.
 *
 * The licence belongs to the pharmacy, not to whichever request happened to
 * carry it, and VerificationDocument.pharmacyId has always said so.
 *
 * Second defect on the same path: `currentRequestId` ordered by createdAt
 * across every status while `submitForReview` reuses the most recent *open*
 * request. With a newer closed request beside an older open one the two
 * disagreed, and a fresh upload attached to the request nobody was reviewing.
 */

const PDF = Buffer.from('%PDF-1.4\nlicence\n%%EOF\n', 'latin1').toString('base64');

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: 'ph_1',
};

const STORED = {
  id: 'ph_1',
  name: 'testerpharma',
  licenseNumber: 'LC-123456',
  phone: '+91 40 2345 6789',
  addressLine1: 'Gandimaisamma',
  addressLine2: null,
  city: 'Ghaziabad',
  region: null,
  country: 'India',
  postalCode: null,
  latitude: 17.5878,
  longitude: 78.4236,
  // Not verified, so every save goes back into the review queue — the state the
  // reported pharmacy was in.
  verificationStatus: 'PENDING',
  isParticipating: false,
  reliabilityScore: 0.9,
  commercialClassification: 'DIRECTORY_UNCLAIMED',
};

/** The document already on file from an earlier, now-closed request. */
const PREVIOUS_DOC = {
  id: 'doc_1',
  verificationRequestId: 'req_closed',
  pharmacyId: 'ph_1',
  uploadedById: 'user_1',
  filename: 'licence.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  data: Buffer.from('%PDF-1.4 stored'),
  updatedAt: new Date(),
};

function buildService({
  openRequest = null as { id: string; notes?: string | null } | null,
  latestRequest = null as { id: string } | null,
  previousDocument = null as typeof PREVIOUS_DOC | null,
  documentOnNewRequest = null as { id: string } | null,
}: {
  openRequest?: { id: string; notes?: string | null } | null;
  latestRequest?: { id: string } | null;
  previousDocument?: typeof PREVIOUS_DOC | null;
  documentOnNewRequest?: { id: string } | null;
} = {}) {
  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(STORED),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => ({ ...STORED, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'ph_new', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ pharmacyId: 'ph_1' }), update: jest.fn() },
    verificationRequest: {
      // submitForReview asks for the open request first; currentRequestId then
      // asks the same way, so both calls are answered from the same fixture.
      findFirst: jest.fn(async ({ where }: any) =>
        where?.status ? openRequest : (latestRequest ?? openRequest),
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 'req_new', ...data })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    verificationDocument: {
      upsert: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(documentOnNewRequest),
      findFirst: jest.fn().mockResolvedValue(previousDocument),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {
      inventoryBecameAvailable: jest.fn(),
      inventoryBecameUnavailable: jest.fn(),
      bulkUploadCompleted: jest.fn(),
    } as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );
  return { service, prisma };
}

/** An ordinary profile save that carries no new file. */
const profileEdit = { addressLine2: 'Near the metro' };

describe('resubmitting after the previous request was closed', () => {
  it('creates a new request, as it always did', async () => {
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationRequest.create).toHaveBeenCalled();
  });

  it('carries the licence already on file onto that new request', async () => {
    // The reported bug. Without this the reviewer opens the new request and
    // reads "No document" while licence.pdf sits on the closed one.
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    const [args] = prisma.verificationDocument.create.mock.calls[0];
    expect(args.data).toMatchObject({
      verificationRequestId: 'req_new',
      pharmacyId: 'ph_1',
      filename: 'licence.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(args.data.data).toEqual(PREVIOUS_DOC.data);
  });

  it('fills in the fields the Verification Center reads', async () => {
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    const call = prisma.verificationRequest.update.mock.calls.at(-1)[0];
    expect(call.where).toEqual({ id: 'req_new' });
    expect(call.data).toEqual({
      docName: 'licence.pdf',
      docUrl: '/admin/verification-requests/req_new/document',
    });
  });

  it('looks for the document by pharmacy, not by request', async () => {
    // Which is the whole point: the licence belongs to the pharmacy.
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    const [args] = prisma.verificationDocument.findFirst.mock.calls[0];
    expect(args.where).toMatchObject({ pharmacyId: 'ph_1' });
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
  });

  it('copies nothing when the pharmacy has never uploaded one', async () => {
    const { service, prisma } = buildService({ previousDocument: null });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationDocument.create).not.toHaveBeenCalled();
  });

  it('does not overwrite a document the new request already holds', async () => {
    const { service, prisma } = buildService({
      previousDocument: PREVIOUS_DOC,
      documentOnNewRequest: { id: 'doc_new' },
    });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationDocument.create).not.toHaveBeenCalled();
  });
});

describe('resubmitting into a request that is still open', () => {
  it('reuses it rather than filing another', async () => {
    const { service, prisma } = buildService({
      openRequest: { id: 'req_open', notes: 'Under review.' },
      previousDocument: PREVIOUS_DOC,
    });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
  });

  it('leaves the document already attached to it alone', async () => {
    // Nothing was created and nothing needs copying — the request the reviewer
    // is reading already holds the file.
    const { service, prisma } = buildService({
      openRequest: { id: 'req_open', notes: null },
      previousDocument: PREVIOUS_DOC,
    });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationDocument.create).not.toHaveBeenCalled();
  });

  it('replaces it when the pharmacy uploads a new one', async () => {
    const { service, prisma } = buildService({
      openRequest: { id: 'req_open', notes: null },
      previousDocument: PREVIOUS_DOC,
    });

    await service.updateProfile(
      'ph_1',
      { ...profileEdit, document: { filename: 'licence-v2.pdf', content: PDF } } as never,
      USER,
    );

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(args.where).toEqual({ verificationRequestId: 'req_open' });
    expect(args.update).toMatchObject({ filename: 'licence-v2.pdf' });
  });
});

describe('an upload lands on the request being reviewed, not the newest row', () => {
  it('attaches to the open request even when a closed one is newer', async () => {
    // currentRequestId used to order by createdAt across every status, so a
    // newer approved or rejected request outranked the open one and took the
    // upload with it.
    const { service, prisma } = buildService({
      openRequest: { id: 'req_open', notes: null },
      latestRequest: { id: 'req_closed_but_newer' },
      previousDocument: PREVIOUS_DOC,
    });

    await service.updateProfile(
      'ph_1',
      { ...profileEdit, document: { filename: 'licence.pdf', content: PDF } } as never,
      USER,
    );

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(args.where).toEqual({ verificationRequestId: 'req_open' });
  });

  it('attaches to the request the submission just filed', async () => {
    const { service, prisma } = buildService({
      openRequest: null,
      latestRequest: { id: 'req_stale' },
      previousDocument: null,
    });

    await service.updateProfile(
      'ph_1',
      { ...profileEdit, document: { filename: 'licence.pdf', content: PDF } } as never,
      USER,
    );

    const [args] = prisma.verificationDocument.upsert.mock.calls[0];
    expect(args.where).toEqual({ verificationRequestId: 'req_new' });
  });
});

describe('a save that does not need review', () => {
  it('files no request and copies no document', async () => {
    // A verified pharmacy editing a field that is not its attested identity.
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });
    prisma.pharmacy.findUnique.mockResolvedValue({
      ...STORED,
      verificationStatus: 'VERIFIED',
    });

    await service.updateProfile('ph_1', profileEdit as never, USER);

    expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
    expect(prisma.verificationDocument.create).not.toHaveBeenCalled();
  });
});

describe('the submission is audited on the existing writer', () => {
  it('records the resubmission against the pharmacy', async () => {
    const audit = { write: jest.fn() };
    const { service, prisma } = buildService({ previousDocument: PREVIOUS_DOC });
    const svc = new PharmacyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
      { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
      {
        inventoryBecameAvailable: jest.fn(),
        inventoryBecameUnavailable: jest.fn(),
        bulkUploadCompleted: jest.fn(),
      } as unknown as PharmacyNotificationService,
      {} as unknown as NotificationPreferencesService,
      { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
    );

    await svc.updateProfile('ph_1', profileEdit as never, USER);

    const [, action, entity, id, meta] = audit.write.mock.calls.at(-1)!;
    expect(action).toBe('pharmacy.profile.update');
    expect(entity).toBe('Pharmacy');
    expect(id).toBe('ph_1');
    expect(meta).toMatchObject({ resubmittedForReview: true });
  });
});
