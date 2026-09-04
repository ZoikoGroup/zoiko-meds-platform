import { VerificationChangeKind } from '@prisma/client';
import { buildSubmissionSummary } from './submission-summary';

/**
 * What a reviewer is told about a request.
 *
 * The Verification Center showed a pharmacy, a licence, a document and a
 * status. Opening the Zoiko Meds row, a reviewer could see that a file called
 * prescription.jpg was attached and had no way to tell whether it was a first
 * submission, a replacement, an answer to a question they had asked, or a
 * licence change that happened to carry a file. The reason line was built from
 * the identity diff alone, so a submission that renamed nothing produced null.
 *
 * Nothing here reads notes, filenames or review comments. Request type comes
 * from facts recorded at submission time plus the live difference between the
 * approved row and the requested one.
 */

const request = (over: Record<string, any> = {}) => ({
  id: 'req_1',
  pharmacyId: 'ph_zoiko',
  pharmacyName: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  submittedBy: 'naveen (gdbdata3@gmail.com)',
  status: 'PENDING',
  reviewer: null,
  docName: null,
  docUrl: null,
  previousDocName: null,
  changeKinds: [] as VerificationChangeKind[],
  notes: null,
  createdAt: new Date('2026-09-04T10:15:00Z'),
  updatedAt: new Date('2026-09-04T10:15:00Z'),
  pharmacy: { name: 'Zoiko Meds', licenseNumber: 'LIC-JHC951' },
  ...over,
});

const summarize = (over: Record<string, any> = {}, opts: Record<string, any> = {}) =>
  buildSubmissionSummary(request(over) as never, {
    documentName: null,
    isFirstTime: false,
    ...opts,
  });

const fieldsOf = (s: ReturnType<typeof summarize>) => s.changes.map((c) => c.field);

describe('B & 16. the reported case — a document-only submission', () => {
  // Verified pharmacy, nothing renamed, nothing relicensed, one file uploaded.
  const DOCUMENT_ONLY = {
    changeKinds: [VerificationChangeKind.DOCUMENT_SUBMITTED],
    docName: 'prescription.jpg',
  };
  const summary = () => summarize(DOCUMENT_ONLY, { documentName: 'prescription.jpg' });

  it('is not blank', () => {
    // The whole bug in one assertion: this used to produce no type and no
    // changes, and the reviewer was shown nothing but a filename.
    expect(summary().changes.length).toBeGreaterThan(0);
    expect(summary().requestType).not.toBe('UNRECORDED');
  });

  it('names the request type', () => {
    expect(summary().requestType).toBe('DOCUMENT_SUBMISSION');
    expect(summary().requestTypeLabel).toBe('Verification document submission');
  });

  it('lists the document as the thing to verify', () => {
    const [change] = summary().changes;

    expect(change.field).toBe('verificationDocument');
    expect(change.kind).toBe('DOCUMENT_SUBMITTED');
    expect(change.requestedValue).toBe('prescription.jpg');
  });

  it('says the identity was not touched', () => {
    // So the reviewer knows there is no name or licence to weigh.
    expect(summary().identityUnchanged).toBe(true);
    expect(fieldsOf(summary())).not.toContain('name');
    expect(fieldsOf(summary())).not.toContain('licenseNumber');
  });

  it('offers no previous document, because a first submission replaced nothing', () => {
    expect(summary().changes[0].previousValue).toBeNull();
  });
});

describe('C. a replacement document', () => {
  const REPLACED = {
    changeKinds: [VerificationChangeKind.DOCUMENT_REPLACED],
    previousDocName: 'licence.pdf',
    docName: 'new-licence.jpg',
  };

  it('is distinguished from a first submission', () => {
    expect(summarize(REPLACED, { documentName: 'new-licence.jpg' }).requestType).toBe(
      'DOCUMENT_REPLACEMENT',
    );
  });

  it('shows what it replaced', () => {
    const [change] = summarize(REPLACED, { documentName: 'new-licence.jpg' }).changes;

    expect(change.previousValue).toBe('licence.pdf');
    expect(change.requestedValue).toBe('new-licence.jpg');
  });

  it('shows no previous name when the system did not keep one', () => {
    // The old bytes are genuinely gone on replacement. Inventing a filename
    // would be worse than the blank it replaces.
    const [change] = summarize(
      { ...REPLACED, previousDocName: null },
      { documentName: 'new-licence.jpg' },
    ).changes;

    expect(change.previousValue).toBeNull();
  });
});

describe('A. first-time verification', () => {
  const FIRST = {
    changeKinds: [VerificationChangeKind.DOCUMENT_SUBMITTED],
    pharmacy: { name: 'New Chemist', licenseNumber: 'LIC-NEW' },
    pharmacyName: 'New Chemist',
    licenseNumber: 'LIC-NEW',
  };

  it('is labelled as an initial verification', () => {
    expect(summarize(FIRST, { isFirstTime: true }).requestType).toBe('FIRST_TIME_VERIFICATION');
  });

  it('offers no current-versus-requested comparison', () => {
    // There is no approved identity to compare against, and a column of
    // "Current: —" invites a reviewer to read a new pharmacy as a changed one.
    expect(summarize(FIRST, { isFirstTime: true }).currentIdentity).toBeNull();
  });

  it('still reports what was submitted', () => {
    const summary = summarize(FIRST, { isFirstTime: true, documentName: 'licence.pdf' });

    expect(summary.requestedIdentity).toEqual({ name: 'New Chemist', licenseNumber: 'LIC-NEW' });
  });

  it('presents a differing name as submitted, not as changed', () => {
    const summary = summarize(
      { ...FIRST, pharmacy: { name: 'Draft', licenseNumber: '' } },
      { isFirstTime: true },
    );

    expect(summary.changes.find((c) => c.field === 'name')?.kind).toBe('SUBMITTED');
    expect(summary.changes.find((c) => c.field === 'name')?.previousValue).toBeNull();
  });
});

describe('D, E, F. identity changes', () => {
  const RENAMED = { pharmacyName: 'Zoiko Meds Hyderabad' };
  const RELICENSED = { licenseNumber: 'LIC-JHC999' };

  it('D. reports a name change', () => {
    expect(summarize(RENAMED).requestType).toBe('PHARMACY_NAME_CHANGE');
  });

  it('E. reports a licence change', () => {
    expect(summarize(RELICENSED).requestType).toBe('LICENCE_NUMBER_CHANGE');
  });

  it('F. reports both together as one request', () => {
    expect(summarize({ ...RENAMED, ...RELICENSED }).requestType).toBe('NAME_AND_LICENCE_CHANGE');
  });

  it('shows the approved value beside the requested one', () => {
    const [change] = summarize(RENAMED).changes;

    expect(change.previousValue).toBe('Zoiko Meds');
    expect(change.requestedValue).toBe('Zoiko Meds Hyderabad');
  });

  it('keeps the approved identity as the current one', () => {
    // The pharmacy row must still hold what a reviewer signed off.
    expect(summarize({ ...RENAMED, ...RELICENSED }).currentIdentity).toEqual({
      name: 'Zoiko Meds',
      licenseNumber: 'LIC-JHC951',
    });
  });

  it('lists only the field that moved', () => {
    expect(fieldsOf(summarize(RENAMED))).toEqual(['name']);
  });
});

describe('G & 8. identity change and a document in one save', () => {
  const BOTH = {
    pharmacyName: 'Zoiko Meds Hyderabad',
    licenseNumber: 'LIC-JHC999',
    changeKinds: [
      VerificationChangeKind.PHARMACY_NAME_CHANGED,
      VerificationChangeKind.LICENCE_NUMBER_CHANGED,
      VerificationChangeKind.DOCUMENT_REPLACED,
    ],
    previousDocName: 'licence.pdf',
  };

  it('reports all three changes on one request', () => {
    const summary = summarize(BOTH, { documentName: 'new-licence.jpg' });

    expect(fieldsOf(summary)).toEqual(['name', 'licenseNumber', 'verificationDocument']);
  });

  it('leads with the identity change, which is the weightier decision', () => {
    // Approving one grants a new name to patients; the other refreshes
    // evidence. A reviewer must not read this as a routine document swap.
    expect(summarize(BOTH, { documentName: 'new.jpg' }).requestType).toBe(
      'NAME_AND_LICENCE_CHANGE',
    );
  });
});

describe('H. a response to an information request', () => {
  const RESPONSE = {
    changeKinds: [
      VerificationChangeKind.REQUEST_INFO_RESPONSE,
      VerificationChangeKind.DOCUMENT_REPLACED,
    ],
    previousDocName: 'blurry.jpg',
    notes: 'The licence photo is unreadable. Please upload a clearer scan.',
  };

  it('is obvious at a glance', () => {
    // It outranks every other type: it changes what the reviewer is looking
    // for. And it survives the resubmission that overwrites REQUEST_INFO with
    // PENDING, which is why it is recorded rather than inferred from status.
    expect(summarize(RESPONSE, { documentName: 'clear.jpg' }).requestType).toBe(
      'REQUEST_INFO_RESPONSE',
    );
  });

  it('still lists what the pharmacy sent back', () => {
    const summary = summarize(RESPONSE, { documentName: 'clear.jpg' });

    expect(summary.changes.find((c) => c.field === 'verificationDocument')?.requestedValue).toBe(
      'clear.jpg',
    );
  });

  it('is recognised even on a request whose status has moved back to pending', () => {
    expect(
      summarize({ ...RESPONSE, status: 'PENDING' }, { documentName: 'clear.jpg' }).requestType,
    ).toBe('REQUEST_INFO_RESPONSE');
  });
});

describe('I. a request with nothing verification-sensitive in it', () => {
  it('says so rather than inventing a type', () => {
    // A row from before submissions were recorded. Picking a plausible label
    // would hand a reviewer a guess dressed as a fact.
    const summary = summarize();

    expect(summary.requestType).toBe('UNRECORDED');
    expect(summary.requestTypeLabel).toBe('Submission details not recorded');
    expect(summary.changes).toEqual([]);
  });

  it('does not treat a carried-forward document as a submission', () => {
    // A new request copies the previous licence forward so the reviewer is not
    // left with nothing. The row looks identical to a fresh upload, which is
    // precisely why the fact is recorded and not derived from the relation.
    const summary = summarize({ docName: 'licence.pdf' }, { documentName: 'licence.pdf' });

    expect(fieldsOf(summary)).not.toContain('verificationDocument');
    expect(summary.requestType).toBe('UNRECORDED');
  });
});

describe('20. free text never decides anything', () => {
  it.each([
    ['notes naming a document', { notes: 'document replaced, new licence uploaded' }],
    ['a filename that reads like a rename', { docName: 'name-change-request.pdf' }],
    ['a reviewer note asking for information', { notes: 'Request info: send a clearer scan' }],
  ])('ignores %s', (_label, over) => {
    const summary = summarize(over, { documentName: (over as any).docName ?? null });

    expect(summary.requestType).toBe('UNRECORDED');
    expect(summary.changes).toEqual([]);
  });
});

describe('after approval', () => {
  it('stays readable once the two rows agree', () => {
    // The live diff is empty — correct, there is nothing left to weigh — but
    // the recorded facts still say what this request was about.
    const summary = summarize({
      status: 'APPROVED',
      pharmacyName: 'Zoiko Meds Hyderabad',
      pharmacy: { name: 'Zoiko Meds Hyderabad', licenseNumber: 'LIC-JHC951' },
      changeKinds: [VerificationChangeKind.PHARMACY_NAME_CHANGED],
    });

    expect(summary.changes).toEqual([]);
    expect(summary.requestType).toBe('PHARMACY_NAME_CHANGE');
  });
});
