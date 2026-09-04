import { VerificationChangeKind, VerificationRequest } from '@prisma/client';

/**
 * Turning a verification request into something a reviewer can act on.
 *
 * The Verification Center showed a pharmacy, a licence, a document and a status
 * — and nothing about why the request existed. A reviewer opening the Zoiko
 * Meds row could see that a file called prescription.jpg was attached and had
 * no way to tell whether it was a first submission, a replacement, an answer to
 * a question they had asked, or a licence change that happened to carry a file.
 * The only free space on the page was Reviewer Notes, which the reviewer writes
 * themselves and which is therefore empty exactly when it is needed.
 *
 * Everything here is derived from stored facts. Nothing is read out of notes,
 * filenames or review comments: those are prose, written by people, and a
 * reviewer's decision must not depend on a word search over them.
 *
 * Two sources, deliberately:
 *
 *   - `changeKinds`, recorded by the pharmacy service at submission time. It
 *     holds the two things that cannot be recovered afterwards — whether a
 *     document was uploaded or merely carried forward, and whether a
 *     resubmission was answering a REQUEST_INFO before that status was
 *     overwritten.
 *   - the difference between the approved pharmacy row and the requested one,
 *     computed live. That comparison is authoritative and cannot go stale,
 *     which a value copied onto the request at submission time could.
 */

export type VerificationRequestType =
  | 'FIRST_TIME_VERIFICATION'
  | 'DOCUMENT_SUBMISSION'
  | 'DOCUMENT_REPLACEMENT'
  | 'PHARMACY_NAME_CHANGE'
  | 'LICENCE_NUMBER_CHANGE'
  | 'NAME_AND_LICENCE_CHANGE'
  | 'PROFILE_REVERIFICATION'
  | 'REQUEST_INFO_RESPONSE'
  | 'UNRECORDED';

export type VerificationChange = {
  field: string;
  label: string;
  kind: string;
  /** Null where there is no approved value to compare against. */
  previousValue: string | null;
  requestedValue: string | null;
};

/** One line of reviewer-facing prose per request type. */
const TYPE_LABEL: Record<VerificationRequestType, string> = {
  FIRST_TIME_VERIFICATION: 'Initial pharmacy verification',
  DOCUMENT_SUBMISSION: 'Verification document submission',
  DOCUMENT_REPLACEMENT: 'Verification document replacement',
  PHARMACY_NAME_CHANGE: 'Re-verification — pharmacy name changed',
  LICENCE_NUMBER_CHANGE: 'Re-verification — licence number changed',
  NAME_AND_LICENCE_CHANGE: 'Re-verification — pharmacy identity changed',
  PROFILE_REVERIFICATION: 'Profile re-verification',
  REQUEST_INFO_RESPONSE: 'Response to information request',
  // Requests raised before submissions were recorded. Saying so is the honest
  // answer; picking a plausible type for them would be a guess presented to a
  // reviewer as a fact.
  UNRECORDED: 'Submission details not recorded',
};

type RequestRow = VerificationRequest & {
  pharmacy?: { name?: string | null; licenseNumber?: string | null } | null;
};

const has = (row: RequestRow, kind: VerificationChangeKind) =>
  (row.changeKinds ?? []).includes(kind);

/**
 * Which attested fields this request is asking to change.
 *
 * Live comparison, so it answers what is still undecided. After approval the
 * two rows agree and this is empty — correct, because there is nothing left for
 * a reviewer to weigh; what was approved lives in the audit trail, and the
 * recorded change kinds keep the request's type readable.
 *
 * A pharmacy being verified for the first time has no approved identity to
 * differ from, so `previousValue` is null and the row reads as new information
 * rather than as a change.
 */
export function identityChanges(row: RequestRow, isFirstTime: boolean): VerificationChange[] {
  const changes: VerificationChange[] = [];

  const requestedName = row.pharmacyName?.trim();
  if (requestedName && requestedName !== row.pharmacy?.name) {
    changes.push({
      field: 'name',
      label: 'Pharmacy name',
      kind: isFirstTime ? 'SUBMITTED' : 'CHANGED',
      previousValue: isFirstTime ? null : (row.pharmacy?.name ?? null),
      requestedValue: requestedName,
    });
  }

  const requestedLicence = row.licenseNumber?.trim();
  if (requestedLicence && requestedLicence !== (row.pharmacy?.licenseNumber ?? '')) {
    changes.push({
      field: 'licenseNumber',
      label: 'Licence number',
      kind: isFirstTime ? 'SUBMITTED' : 'CHANGED',
      previousValue: isFirstTime ? null : (row.pharmacy?.licenseNumber ?? null),
      requestedValue: requestedLicence,
    });
  }

  return changes;
}

/** The document row of the summary, when a document was actually submitted. */
function documentChange(row: RequestRow, documentName: string | null): VerificationChange | null {
  const replaced = has(row, VerificationChangeKind.DOCUMENT_REPLACED);
  const submitted = has(row, VerificationChangeKind.DOCUMENT_SUBMITTED);
  if (!replaced && !submitted) return null;

  return {
    field: 'verificationDocument',
    label: 'Verification document',
    kind: replaced ? 'DOCUMENT_REPLACED' : 'DOCUMENT_SUBMITTED',
    // Only where the system genuinely kept it. A replacement overwrites the
    // document row in place, so the previous name is stored at that moment or
    // it is gone — and a reviewer is told nothing rather than something made up.
    previousValue: replaced ? (row.previousDocName ?? null) : null,
    requestedValue: documentName,
  };
}

/**
 * The request's type, from what was recorded and what differs.
 *
 * Ordered by what a reviewer most needs to know first. Answering a question
 * they asked outranks everything: it changes what they are looking for. An
 * identity change outranks a document, because approving one grants a new name
 * or licence to patients while the other only refreshes evidence.
 */
export function requestTypeOf(
  row: RequestRow,
  changes: VerificationChange[],
  isFirstTime: boolean,
): VerificationRequestType {
  if (has(row, VerificationChangeKind.REQUEST_INFO_RESPONSE)) return 'REQUEST_INFO_RESPONSE';
  if (isFirstTime) return 'FIRST_TIME_VERIFICATION';

  const nameChanged =
    has(row, VerificationChangeKind.PHARMACY_NAME_CHANGED) ||
    changes.some((c) => c.field === 'name');
  const licenceChanged =
    has(row, VerificationChangeKind.LICENCE_NUMBER_CHANGED) ||
    changes.some((c) => c.field === 'licenseNumber');

  if (nameChanged && licenceChanged) return 'NAME_AND_LICENCE_CHANGE';
  if (nameChanged) return 'PHARMACY_NAME_CHANGE';
  if (licenceChanged) return 'LICENCE_NUMBER_CHANGE';

  if (has(row, VerificationChangeKind.DOCUMENT_REPLACED)) return 'DOCUMENT_REPLACEMENT';
  if (has(row, VerificationChangeKind.DOCUMENT_SUBMITTED)) return 'DOCUMENT_SUBMISSION';
  if (has(row, VerificationChangeKind.PROFILE_DETAILS_CHANGED)) return 'PROFILE_REVERIFICATION';

  return 'UNRECORDED';
}

export type SubmissionSummary = {
  requestType: VerificationRequestType;
  requestTypeLabel: string;
  isFirstTimeVerification: boolean;
  changes: VerificationChange[];
  /** True when nothing about the pharmacy's attested identity is in question. */
  identityUnchanged: boolean;
  currentIdentity: { name: string | null; licenseNumber: string | null } | null;
  requestedIdentity: { name: string | null; licenseNumber: string | null };
};

/**
 * The whole reviewer-facing picture of one request.
 *
 * `isFirstTime` is decided by the caller, which is the only place that can ask
 * the database whether this pharmacy has ever had a request approved. Passed in
 * rather than looked up here so this stays a pure function over rows — the part
 * worth testing exhaustively.
 */
export function buildSubmissionSummary(
  row: RequestRow,
  { documentName, isFirstTime }: { documentName: string | null; isFirstTime: boolean },
): SubmissionSummary {
  const changes = identityChanges(row, isFirstTime);
  const document = documentChange(row, documentName);
  const all = document ? [...changes, document] : changes;

  return {
    requestType: requestTypeOf(row, changes, isFirstTime),
    requestTypeLabel: TYPE_LABEL[requestTypeOf(row, changes, isFirstTime)],
    isFirstTimeVerification: isFirstTime,
    changes: all,
    identityUnchanged: changes.length === 0,
    // Null for a first submission: there is no approved identity to compare
    // against, and showing "Current: —" beside every field invites a reviewer
    // to read a new pharmacy as one that has changed something.
    currentIdentity: isFirstTime
      ? null
      : {
          name: row.pharmacy?.name ?? null,
          licenseNumber: row.pharmacy?.licenseNumber ?? null,
        },
    requestedIdentity: {
      name: row.pharmacyName ?? null,
      licenseNumber: row.licenseNumber || null,
    },
  };
}
