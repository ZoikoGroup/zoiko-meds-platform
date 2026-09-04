import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * A replaced licence document has to reach a reviewer.
 *
 * The reported case: a verified pharmacy opens its profile, attaches
 * prescription.jpg, saves, and the portal then says the file is attached — while
 * the Verification Center has no request for that pharmacy at all.
 *
 * Both halves were telling the truth. Nothing about a document made the save
 * open a request: only a changed name or licence did, and this save changed
 * neither. So the upload fell through to "the current request", which for an
 * approved pharmacy is its last APPROVED one — a closed row no queue lists. The
 * profile page then read that same latest request back and found the document
 * on it, which is why one side showed the file and the other showed nothing.
 *
 * A licence document is verification evidence. Submitting one is a request for
 * review, whether or not the name changed.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0x20), 0xff, 0xd9]).toString(
  'base64',
);

const USER: AuthenticatedUser = {
  id: 'user_zoiko',
  email: 'gdbdata3@gmail.com',
  fullName: 'naveen',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: 'ph_zoiko',
};

/** The pharmacy from the report: verified, approved, listed to patients. */
const ZOIKO = {
  id: 'ph_zoiko',
  name: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  phone: '+91 96663 44441',
  addressLine1: 'Prakruthi nivas',
  addressLine2: null,
  city: 'Gandimaisamma',
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

const OPEN_STATUSES = ['PENDING', 'UNDER_REVIEW', 'ESCALATED', 'REQUEST_INFO'];

/**
 * A verificationRequest table that honours the status filter.
 *
 * The distinction between "an open request" and "the most recent request" is
 * the whole subject here, so a findFirst that ignores `where.status` would
 * report a pass whichever way the code behaved.
 */
function buildService({
  pharmacy = ZOIKO,
  requests = [] as Array<Record<string, any>>,
} = {}) {
  const rows = requests.map((r) => ({ ...r }));
  const documents: Record<string, any> = {};
  let nextId = rows.length + 1;

  const matches = (row: any, where: any = {}) => {
    if (where.pharmacyId !== undefined && row.pharmacyId !== where.pharmacyId) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    if (where.id !== undefined && row.id !== where.id) return false;
    return true;
  };

  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(pharmacy),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => ({ ...pharmacy, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'ph_new', ...data })),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ pharmacyId: pharmacy.id }),
      update: jest.fn(),
    },
    verificationRequest: {
      findFirst: jest.fn(async ({ where, orderBy, include }: any = {}) => {
        const found = rows
          .filter((row) => matches(row, where))
          .sort((a, b) =>
            orderBy?.createdAt === 'asc'
              ? a.createdAt - b.createdAt
              : b.createdAt - a.createdAt,
          )[0];
        if (!found) return null;
        return include?.document
          ? { ...found, document: documents[found.id] ?? null }
          : { ...found };
      }),
      findUnique: jest.fn(async ({ where }: any = {}) => {
        const row = rows.find((r) => r.id === where?.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `req_${nextId++}`, createdAt: Date.now(), changeKinds: [], ...data };
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`no such request: ${where.id}`);
        Object.assign(row, data ?? {});
        return { ...row };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    verificationDocument: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const id = where.verificationRequestId;
        documents[id] = { id: `doc_${id}`, ...(documents[id] ?? create), ...update };
        return documents[id];
      }),
      findUnique: jest.fn(async ({ where }: any = {}) => {
        const found = documents[where?.verificationRequestId];
        return found ? { ...found } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const found = Object.values(documents).find(
          (doc: any) => !where?.pharmacyId || doc.pharmacyId === where.pharmacyId,
        );
        return found ? { ...(found as any) } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        documents[data.verificationRequestId] = { id: `doc_${data.verificationRequestId}`, ...data };
        return documents[data.verificationRequestId];
      }),
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
  return { service, prisma, rows, documents };
}

/** What the portal sends: a chosen file, and nothing else about the identity. */
const documentOnly = () => ({
  document: { filename: 'prescription.jpg', content: JPEG },
});

/** The approved request an already-verified pharmacy is left with. */
const approvedRequest = () => ({
  id: 'req_approved',
  pharmacyId: 'ph_zoiko',
  pharmacyName: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  status: 'APPROVED',
  createdAt: 1_000,
  reviewer: 'ZoikoMeds Super Admin',
  notes: null,
});

const openRequestFor = (rows: Array<Record<string, any>>) =>
  rows.find((row) => OPEN_STATUSES.includes(row.status));

describe('A/F. a document-only save reaches the reviewer', () => {
  it('opens a pending request when the pharmacy has none', async () => {
    // The reported case exactly: verified, last request approved, nothing open.
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(openRequestFor(rows)).toBeDefined();
    expect(openRequestFor(rows)!.status).toBe('PENDING');
  });

  it('attaches the document to that pending request, not to the approved one', async () => {
    const { service, rows, documents } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);
    const open = openRequestFor(rows)!;

    expect(documents[open.id]).toBeDefined();
    expect(documents[open.id].filename).toBe('prescription.jpg');
    expect(documents['req_approved']).toBeUndefined();
  });

  it('files the request against the pharmacy that uploaded it', async () => {
    // The ownership half of the report: a request must never be raised against
    // some other pharmacy's row.
    const { service, rows, documents } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);
    const open = openRequestFor(rows)!;

    expect(open.pharmacyId).toBe('ph_zoiko');
    expect(documents[open.id].pharmacyId).toBe('ph_zoiko');
    expect(documents[open.id].verificationRequestId).toBe(open.id);
  });

  it('reuses an open request instead of raising a second one', async () => {
    const { service, rows } = buildService({
      requests: [
        approvedRequest(),
        {
          id: 'req_open',
          pharmacyId: 'ph_zoiko',
          pharmacyName: 'Zoiko Meds',
          licenseNumber: 'LIC-JHC951',
          status: 'PENDING',
          createdAt: 2_000,
        },
      ],
    });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(rows.filter((r) => OPEN_STATUSES.includes(r.status))).toHaveLength(1);
    expect(openRequestFor(rows)!.id).toBe('req_open');
  });

  it('records the request against the approved identity, unchanged', () => {
    // A document-only submission is not a claim about the name or the licence.
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    return service.updateProfile('ph_zoiko', documentOnly() as any, USER).then(() => {
      const open = openRequestFor(rows)!;

      expect(open.pharmacyName).toBe('Zoiko Meds');
      expect(open.licenseNumber).toBe('LIC-JHC951');
    });
  });
});

describe('I. the approved identity survives a document upload', () => {
  it('leaves the pharmacy verified', async () => {
    // Replacing a licence scan is evidence, not a retraction. Dropping the
    // pharmacy to PENDING would delist it from patient search for the time a
    // reviewer takes to open the file.
    const { service, prisma } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    for (const call of prisma.pharmacy.update.mock.calls) {
      expect(call[0].data.verificationStatus).not.toBe('PENDING');
    }
  });

  it('leaves the pharmacy listed to patients', async () => {
    const { service, prisma } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    for (const call of prisma.pharmacy.update.mock.calls) {
      expect(call[0].data.isParticipating).not.toBe(false);
    }
  });

  it('still stages a name change behind approval', async () => {
    // Unchanged behaviour, asserted here so the document work cannot weaken it.
    const { service, prisma } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds City' } as any, USER);
    const write = prisma.pharmacy.update.mock.calls[0][0].data;

    expect(write.name).toBe('Zoiko Meds');
  });

  it('asks the reviewer for the new name while keeping the old one on the row', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds City' } as any, USER);

    expect(openRequestFor(rows)!.pharmacyName).toBe('Zoiko Meds City');
  });
});

describe('the save still reports what happened', () => {
  it('tells the portal a review is open', async () => {
    // The portal decides between "saved" and "sent for verification" from this.
    const { service } = buildService({ requests: [approvedRequest()] });

    const profile: any = await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(profile.reviewStatus).toBe('PENDING');
    expect(profile.verificationStatus).toBe('VERIFIED');
  });

  it('returns the document it just stored', async () => {
    const { service } = buildService({ requests: [approvedRequest()] });

    const profile: any = await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(profile.document?.filename).toBe('prescription.jpg');
  });

  it('reports no document when none was ever uploaded', async () => {
    const { service } = buildService({ requests: [approvedRequest()] });

    const profile: any = await service.updateProfile('ph_zoiko', { city: 'Hyderabad' } as any, USER);

    expect(profile.document).toBeNull();
  });
});

describe('a first-time pharmacy is unaffected', () => {
  it('still goes into the queue on any save', async () => {
    const { service, rows } = buildService({
      pharmacy: { ...ZOIKO, verificationStatus: 'PENDING', isParticipating: false },
    });

    await service.updateProfile('ph_zoiko', { city: 'Hyderabad' } as any, USER);

    expect(openRequestFor(rows)).toBeDefined();
  });

  it('attaches its document to that same request', async () => {
    const { service, rows, documents } = buildService({
      pharmacy: { ...ZOIKO, verificationStatus: 'PENDING', isParticipating: false },
    });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);
    const open = openRequestFor(rows)!;

    expect(documents[open.id].filename).toBe('prescription.jpg');
  });
});

describe('a suspended pharmacy cannot clear its own suspension', () => {
  it('stays suspended when it uploads a document', async () => {
    const { service, prisma } = buildService({
      pharmacy: { ...ZOIKO, verificationStatus: 'SUSPENDED', isParticipating: false },
      requests: [approvedRequest()],
    });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    for (const call of prisma.pharmacy.update.mock.calls) {
      expect(call[0].data.verificationStatus).toBeUndefined();
    }
  });

  it('still gets its evidence in front of a reviewer', async () => {
    // Suspension is the admin's decision to lift; withholding the document
    // would only stop the reviewer seeing what was submitted.
    const { service, rows, documents } = buildService({
      pharmacy: { ...ZOIKO, verificationStatus: 'SUSPENDED', isParticipating: false },
      requests: [approvedRequest()],
    });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);
    const open = openRequestFor(rows)!;

    expect(documents[open.id].filename).toBe('prescription.jpg');
  });
});

describe('D. replacement', () => {
  it('points the open request at the new file', async () => {
    const { service, rows, documents } = buildService({
      requests: [
        {
          id: 'req_open',
          pharmacyId: 'ph_zoiko',
          pharmacyName: 'Zoiko Meds',
          licenseNumber: 'LIC-JHC951',
          status: 'PENDING',
          createdAt: 2_000,
        },
      ],
    });
    await service.updateProfile(
      'ph_zoiko',
      { document: { filename: 'licence.pdf', content: JPEG } } as any,
      USER,
    );

    await service.updateProfile(
      'ph_zoiko',
      { document: { filename: 'new-licence.jpg', content: JPEG } } as any,
      USER,
    );

    expect(documents['req_open'].filename).toBe('new-licence.jpg');
    expect(Object.keys(documents)).toHaveLength(1);
    expect(rows.filter((r) => OPEN_STATUSES.includes(r.status))).toHaveLength(1);
  });

  it('updates the request label the reviewer reads', async () => {
    const { service, prisma } = buildService({
      requests: [
        {
          id: 'req_open',
          pharmacyId: 'ph_zoiko',
          pharmacyName: 'Zoiko Meds',
          licenseNumber: 'LIC-JHC951',
          status: 'PENDING',
          createdAt: 2_000,
        },
      ],
    });

    await service.updateProfile(
      'ph_zoiko',
      { document: { filename: 'new-licence.jpg', content: JPEG } } as any,
      USER,
    );

    const docNameWrite = prisma.verificationRequest.update.mock.calls
      .map((call: any[]) => call[0].data)
      .find((data: any) => data.docName);
    expect(docNameWrite.docName).toBe('new-licence.jpg');
    expect(docNameWrite.docUrl).toContain('req_open');
  });
});

/**
 * What the request records about the submission that raised it.
 *
 * A reviewer opening the queue has to know why the request exists. Two of the
 * facts they need cannot be recovered from the rows afterwards — whether a
 * document was uploaded or carried forward, and whether a resubmission was
 * answering a question — so the save records them as it happens.
 */
describe('16 & 17. the save records what it was', () => {
  const openRequest = (over: Record<string, any> = {}) => ({
    id: 'req_open',
    pharmacyId: 'ph_zoiko',
    pharmacyName: 'Zoiko Meds',
    licenseNumber: 'LIC-JHC951',
    status: 'PENDING',
    createdAt: 2_000,
    changeKinds: [],
    ...over,
  });

  it('B. records a first document as submitted, not replaced', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(openRequestFor(rows)!.changeKinds).toEqual(['DOCUMENT_SUBMITTED']);
  });

  it('C. records a second document as a replacement', async () => {
    const { service, rows } = buildService({ requests: [openRequest()] });
    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    await service.updateProfile(
      'ph_zoiko',
      { document: { filename: 'new-licence.jpg', content: JPEG } } as any,
      USER,
    );

    expect(openRequestFor(rows)!.changeKinds).toContain('DOCUMENT_REPLACED');
  });

  it('C. keeps the filename it replaced', async () => {
    const { service, rows } = buildService({ requests: [openRequest()] });
    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    await service.updateProfile(
      'ph_zoiko',
      { document: { filename: 'new-licence.jpg', content: JPEG } } as any,
      USER,
    );

    expect(openRequestFor(rows)!.previousDocName).toBe('prescription.jpg');
  });

  it('does not call re-saving the same file a replacement', async () => {
    // Nothing moved, so telling a reviewer a document changed would be noise.
    const { service, rows } = buildService({ requests: [openRequest()] });
    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(openRequestFor(rows)!.previousDocName).toBeUndefined();
  });

  it('D. records a name change', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds Hyderabad' } as any, USER);

    expect(openRequestFor(rows)!.changeKinds).toContain('PHARMACY_NAME_CHANGED');
  });

  it('E. records a licence change', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', { licenseNumber: 'LIC-NEW123' } as any, USER);

    expect(openRequestFor(rows)!.changeKinds).toContain('LICENCE_NUMBER_CHANGED');
  });

  it('G. records an identity change and a document on ONE request', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile(
      'ph_zoiko',
      { name: 'Zoiko Meds Hyderabad', licenseNumber: 'LIC-NEW123', ...documentOnly() } as any,
      USER,
    );

    const open = openRequestFor(rows)!;
    expect(open.changeKinds).toEqual(
      expect.arrayContaining([
        'PHARMACY_NAME_CHANGED',
        'LICENCE_NUMBER_CHANGED',
        'DOCUMENT_SUBMITTED',
      ]),
    );
    expect(rows.filter((r) => OPEN_STATUSES.includes(r.status))).toHaveLength(1);
  });

  it('H. records that a resubmission answered an information request', async () => {
    // The write that follows sets the status back to PENDING, erasing the only
    // other trace that the pharmacy was replying rather than volunteering.
    const { service, rows } = buildService({
      requests: [openRequest({ status: 'REQUEST_INFO' })],
    });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds Hyderabad' } as any, USER);

    expect(openRequestFor(rows)!.changeKinds).toContain('REQUEST_INFO_RESPONSE');
    expect(openRequestFor(rows)!.status).toBe('PENDING');
  });

  it('does not claim an ordinary resubmission answered anything', async () => {
    const { service, rows } = buildService({ requests: [openRequest()] });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds Hyderabad' } as any, USER);

    expect(openRequestFor(rows)!.changeKinds).not.toContain('REQUEST_INFO_RESPONSE');
  });

  it('J. accumulates across saves against one open request', async () => {
    // A pharmacy corrects its profile twice and the reviewer decides on the
    // whole of it. Overwriting would leave the summary describing only the
    // last touch.
    const { service, rows } = buildService({ requests: [openRequest()] });

    await service.updateProfile('ph_zoiko', { name: 'Zoiko Meds Hyderabad' } as any, USER);
    await service.updateProfile('ph_zoiko', documentOnly() as any, USER);

    expect(openRequestFor(rows)!.changeKinds).toEqual(
      expect.arrayContaining(['PHARMACY_NAME_CHANGED', 'DOCUMENT_SUBMITTED']),
    );
    expect(rows.filter((r) => OPEN_STATUSES.includes(r.status))).toHaveLength(1);
  });

  it('I. records nothing for a save that touches nothing verification-sensitive', async () => {
    const { service, rows } = buildService({ requests: [approvedRequest()] });

    await service.updateProfile('ph_zoiko', { city: 'Hyderabad' } as any, USER);

    expect(rows.filter((r) => OPEN_STATUSES.includes(r.status))).toHaveLength(0);
  });
});
