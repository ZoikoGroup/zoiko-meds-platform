import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { VerificationService } from './verification.service';

/**
 * What the Verification Center is told about an attached document.
 *
 * The panel used to read `docName`, a column copied onto the request when a
 * file is stored. A copy can drift from the row it describes, and "is there a
 * document" is a question only the VerificationDocument relation can answer —
 * it is what View File actually serves. So the queue reports the relation, and
 * reports it as metadata: the bytes are the reason the document has its own
 * table, and dragging them through a list query to render a filename would put
 * every licence scan on the wire at once.
 */

const REQUEST = {
  id: 'req_zoiko',
  pharmacyId: 'ph_zoiko',
  pharmacyName: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  submittedBy: 'naveen (gdbdata3@gmail.com)',
  status: 'PENDING',
  reviewer: null,
  docName: 'prescription.jpg',
  docUrl: '/admin/verification-requests/req_zoiko/document',
  notes: null,
  createdAt: new Date('2026-08-03T00:00:00Z'),
  updatedAt: new Date('2026-08-03T00:00:00Z'),
  pharmacy: {
    id: 'ph_zoiko',
    name: 'Zoiko Meds',
    licenseNumber: 'LIC-JHC951',
    addressLine1: 'Prakruthi nivas',
    city: 'Gandimaisamma',
    region: 'Telangana',
    postalCode: '500043',
    country: 'IN',
    verificationStatus: 'VERIFIED',
  },
};

const DOCUMENT = {
  id: 'doc_1',
  filename: 'prescription.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 38_912,
  updatedAt: new Date('2026-08-03T10:15:00Z'),
};

function buildService({ rows = [{ ...REQUEST, document: DOCUMENT }] }: { rows?: any[] } = {}) {
  const prisma: any = {
    pharmacy: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    verificationRequest: {
      findMany: jest.fn(async (args: any) => {
        // Two different queries reach here: the queue listing, and the mapper
        // asking which pharmacies have ever been approved. Only the first
        // carries an include, so record that one rather than the last call.
        if (args?.include) prisma.__listArgs = args;
        return args?.include ? rows : [];
      }),
      findUnique: jest.fn(async () => rows[0] ?? null),
    },
    verificationDocument: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new VerificationService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );
  return { service, prisma };
}

describe('B. the queue reports the attached document', () => {
  it('carries the metadata a reviewer is shown', async () => {
    const { service } = buildService();

    const [dto]: any = await service.list();

    expect(dto.document).toEqual({
      id: 'doc_1',
      filename: 'prescription.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 38_912,
      uploadedAt: DOCUMENT.updatedAt,
    });
  });

  it('names the pharmacy the request belongs to', async () => {
    // The reported confusion was two pharmacies side by side, so the row has to
    // carry its own identity rather than being read off whatever is selected.
    const { service } = buildService();

    const [dto]: any = await service.list();

    expect(dto.pharmacy).toBe('Zoiko Meds');
    expect(dto.licenseNumber).toBe('LIC-JHC951');
  });
});

describe('G. no document', () => {
  it('reports null rather than a filename from somewhere else', async () => {
    const { service } = buildService({ rows: [{ ...REQUEST, docName: null, document: null }] });

    const [dto]: any = await service.list();

    expect(dto.document).toBeNull();
  });

  it('reports null even when the copied docName column says otherwise', async () => {
    // The drift case: the column still holds a filename, the row it described
    // is gone. Trusting the column offered View File on a file that is not
    // there, and the endpoint behind it 404s.
    const { service } = buildService({
      rows: [{ ...REQUEST, docName: 'prescription.jpg', document: null }],
    });

    const [dto]: any = await service.list();

    expect(dto.document).toBeNull();
  });
});

describe('9. the queue does not carry the file itself', () => {
  it('selects metadata only', async () => {
    const { service, prisma } = buildService();

    await service.list();
    const select = prisma.__listArgs.include.document.select;

    expect(select.data).toBeUndefined();
    expect(select).toEqual({
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      updatedAt: true,
    });
  });

  it('never returns bytes on a listed request', async () => {
    const { service } = buildService();

    const [dto]: any = await service.list();

    // Checked as a key rather than as a substring: the submitter's address is
    // gdbdata3@gmail.com, so searching the serialized DTO for "data" matches
    // the reviewer's own email and would fail on a perfectly clean response.
    expect(dto.document.data).toBeUndefined();
    expect(Object.keys(dto.document)).not.toContain('data');
  });
});

describe('C. View File', () => {
  it('serves the document for the request asked for', async () => {
    const { service, prisma } = buildService();
    prisma.verificationDocument.findUnique.mockResolvedValue({
      filename: 'prescription.jpg',
      mimeType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff]),
    });

    const file = await service.getDocument('req_zoiko');

    expect(prisma.verificationDocument.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { verificationRequestId: 'req_zoiko' } }),
    );
    expect(file.filename).toBe('prescription.jpg');
  });

  it('E. is keyed by request, so one pharmacy cannot ask for another’s file', async () => {
    // Ownership is the unique key itself: there is no way to name a document
    // except through the request it belongs to, and the route is SUPER_ADMIN.
    const { service, prisma } = buildService();

    await expect(service.getDocument('req_someone_else')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.verificationDocument.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { verificationRequestId: 'req_someone_else' } }),
    );
  });

  it('says so when the request has no document', async () => {
    const { service } = buildService();

    await expect(service.getDocument('req_zoiko')).rejects.toThrow(/No document has been uploaded/i);
  });
});
