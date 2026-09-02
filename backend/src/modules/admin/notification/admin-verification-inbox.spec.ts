import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NotificationService } from './notification.service';

/**
 * Telling a Super Admin that a pharmacy is waiting on them.
 *
 * The console bell read one endpoint: GET /admin/notifications, which is the
 * broadcast *outbox* an administrator composes into. Nothing in the platform
 * produced a notification for a verification submission — not for a new
 * request, not for a resubmission, not for a document upload — and there was no
 * admin inbox for one to be written to. A pharmacy could upload its licence,
 * submit, and sit in the queue with nobody told.
 *
 * These rows are derived from the queue rather than written when a submission
 * happens, which is what makes the "exactly one notification" rule hold by
 * construction: one row per request awaiting review, so ten saves cannot make
 * ten notifications; a save that submits nothing changes no request and so
 * raises nothing; a failed upload throws before any write, so there is nothing
 * to describe; and reviewing the request retires the reminder with it.
 */

const HOURS_AGO = (n: number) => new Date(Date.now() - n * 3600_000);

const request = (over: Record<string, unknown> = {}) => ({
  id: 'req_1',
  pharmacyId: 'ph_1',
  pharmacyName: 'testerpharma',
  docName: 'licence.pdf',
  status: 'PENDING',
  notes: 'Submitted by the pharmacy from the pharmacy portal profile.',
  createdAt: HOURS_AGO(2),
  updatedAt: HOURS_AGO(2),
  ...over,
});

function buildService({
  requests = [request()],
  counts = [{ pharmacyId: 'ph_1', _count: { _all: 1 } }],
}: {
  requests?: Record<string, unknown>[];
  counts?: Array<{ pharmacyId: string | null; _count: { _all: number } }>;
} = {}) {
  const prisma: any = {
    verificationRequest: {
      findMany: jest.fn().mockResolvedValue(requests),
      groupBy: jest.fn().mockResolvedValue(counts),
    },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new NotificationService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );
  return { service, prisma };
}

describe('a pharmacy that has just submitted for the first time', () => {
  it('produces one notification', async () => {
    const { service } = buildService();

    const rows = await service.inbox();

    expect(rows).toHaveLength(1);
  });

  it('says the pharmacy submitted its documents', async () => {
    const { service } = buildService();

    const [row] = await service.inbox();

    expect(row.message).toBe('testerpharma submitted verification documents for review.');
    expect(row.title).toBe('testerpharma — verification review needed');
  });

  it('carries the request it is about, so the bell can open it', async () => {
    const { service } = buildService();

    const [row] = await service.inbox();

    expect(row.requestId).toBe('req_1');
    expect(row.id).toBe('verification-req_1');
    expect(row.kind).toBe('verification');
  });

  it('says so plainly when no document is attached', async () => {
    // A request needing review with nothing to review is the case a reviewer
    // has to act on differently, so it is not dressed up as a document arriving.
    const { service } = buildService({ requests: [request({ docName: null })] });

    const [row] = await service.inbox();

    expect(row.message).toBe(
      'testerpharma submitted a verification request. No document is attached.',
    );
    expect(row.documentAttached).toBe(false);
    expect(row.severity).toBe('warning');
  });
});

describe('a pharmacy that has resubmitted', () => {
  it('says it updated and resubmitted, when the note was appended', async () => {
    // submitForReview appends a line per resubmission on a reused request —
    // exactly what the reported request carried.
    const { service } = buildService({
      requests: [
        request({
          notes:
            'Pharmacy updated its name or licence number — re-verification required.\nPharmacy updated its profile and resubmitted for verification.',
        }),
      ],
    });

    const [row] = await service.inbox();

    expect(row.message).toBe('testerpharma updated and resubmitted its verification request.');
  });

  it('says the same when a fresh request follows an earlier one', async () => {
    // A closed request before it means this is not a first submission, even
    // though the new row carries a single note line.
    const { service } = buildService({
      counts: [{ pharmacyId: 'ph_1', _count: { _all: 3 } }],
    });

    const [row] = await service.inbox();

    expect(row.message).toBe('testerpharma updated and resubmitted its verification request.');
  });

  it('still produces exactly one notification for that request', async () => {
    const { service } = buildService({
      counts: [{ pharmacyId: 'ph_1', _count: { _all: 4 } }],
    });

    expect(await service.inbox()).toHaveLength(1);
  });
});

describe('what it will not do', () => {
  it('raises nothing when the queue is empty', async () => {
    // An autosave, a field edit, a repeated identical save — none of them puts
    // a request into the queue, so none of them can raise a notification.
    const { service, prisma } = buildService({ requests: [] });

    expect(await service.inbox()).toEqual([]);
    // Nothing to count, so it does not go back to the database for it.
    expect(prisma.verificationRequest.groupBy).not.toHaveBeenCalled();
  });

  it('never duplicates a request, however many times it was saved', async () => {
    // The queue holds one row per pharmacy under review, and this reads the
    // queue — duplication is not something it can express.
    const { service } = buildService({
      requests: [request(), request({ id: 'req_2', pharmacyId: 'ph_2', pharmacyName: 'Zoiko Group Pharmacy' })],
      counts: [
        { pharmacyId: 'ph_1', _count: { _all: 1 } },
        { pharmacyId: 'ph_2', _count: { _all: 1 } },
      ],
    });

    const rows = await service.inbox();

    expect(rows.map((r) => r.id)).toEqual(['verification-req_1', 'verification-req_2']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('only reads requests that are still awaiting a reviewer', async () => {
    const { service, prisma } = buildService();

    await service.inbox();

    const [args] = prisma.verificationRequest.findMany.mock.calls[0];
    expect(args.where.status.in).toEqual([
      'PENDING',
      'UNDER_REVIEW',
      'ESCALATED',
      'REQUEST_INFO',
    ]);
  });

  it('drops the reminder once the request is reviewed', async () => {
    // An approved or rejected request is outside the status filter, so it is
    // simply not there any more.
    const { service } = buildService({ requests: [] });

    expect(await service.inbox()).toEqual([]);
  });

  it('leaves the broadcast outbox untouched', async () => {
    // The composer page renders list(); a derived reminder must not appear
    // there as something an admin sent, or could delete.
    const { service, prisma } = buildService();

    await service.inbox();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });
});

describe('ordering and bounds', () => {
  it('puts the most recently touched request first', async () => {
    const { service, prisma } = buildService();

    await service.inbox();

    const [args] = prisma.verificationRequest.findMany.mock.calls[0];
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
    expect(args.take).toBe(20);
  });

  it('dates the row from the request, not from now', async () => {
    const touched = HOURS_AGO(5);
    const { service } = buildService({ requests: [request({ updatedAt: touched })] });

    const [row] = await service.inbox();

    expect(row.date).toEqual(touched);
  });

  it('names a request with no pharmacy record without inventing one', async () => {
    const { service } = buildService({
      requests: [request({ pharmacyId: null, pharmacyName: '' })],
      counts: [],
    });

    const [row] = await service.inbox();

    expect(row.message).toBe('A pharmacy submitted verification documents for review.');
  });
});
