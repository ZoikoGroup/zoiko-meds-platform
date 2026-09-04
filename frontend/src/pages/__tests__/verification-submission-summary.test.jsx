// @vitest-environment jsdom
//
// What the Verification Center tells a reviewer about a request.
//
// The panel showed a pharmacy, a licence, a document and a status. Opening the
// Zoiko Meds row, a reviewer could see that prescription.jpg was attached and
// had no way to tell whether it was a first submission, a replacement, an
// answer to a question they had asked, or a licence change that happened to
// carry a file. The only free space was Reviewer Notes — which the reviewer
// writes themselves, and is therefore empty exactly when it is needed.
//
// Everything asserted here is rendered from the API's own summary fields. The
// page computes no diffs of its own and reads nothing out of notes or
// filenames.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const listMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listVerifications: () => listMock(),
  getVerificationDocument: vi.fn(),
  updateVerification: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

const { default: VerificationCenter } = await import('../VerificationCenter')

const BASE = {
  id: 'req_zoiko',
  pharmacyId: 'ph_zoiko',
  pharmacy: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  requestedName: 'Zoiko Meds',
  requestedLicenseNumber: 'LIC-JHC951',
  submittedBy: 'naveen (gdbdata3@gmail.com)',
  date: '2026-09-04T10:15:00.000Z',
  status: 'PENDING',
  reviewer: null,
  notes: null,
  addressLine1: 'Prakruthi nivas',
  city: 'Gandimaisamma',
  region: 'Telangana',
  postalCode: '500043',
  country: 'IN',
  isFirstTimeVerification: false,
  identityUnchanged: true,
  requestType: 'DOCUMENT_SUBMISSION',
  requestTypeLabel: 'Verification document submission',
  changes: [],
  currentIdentity: { name: 'Zoiko Meds', licenseNumber: 'LIC-JHC951' },
  requestedIdentity: { name: 'Zoiko Meds', licenseNumber: 'LIC-JHC951' },
  document: {
    id: 'doc_1',
    filename: 'prescription.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 38_912,
    uploadedAt: '2026-09-04T10:15:00.000Z',
  },
  docName: 'prescription.jpg',
  docUrl: '/admin/verification-requests/req_zoiko/document',
}

/** The reported case: a document-only submission from a verified pharmacy. */
const DOCUMENT_ONLY = {
  ...BASE,
  changes: [
    {
      field: 'verificationDocument',
      label: 'Verification document',
      kind: 'DOCUMENT_SUBMITTED',
      previousValue: null,
      requestedValue: 'prescription.jpg',
    },
  ],
}

const open = async (requests = [DOCUMENT_ONLY]) => {
  listMock.mockResolvedValue(requests)
  render(<VerificationCenter />)
  await screen.findByText('Submission Summary')
  return userEvent.setup({ pointerEventsCheck: 0 })
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('23 & 16. the reported case is no longer ambiguous', () => {
  it('names the request type', async () => {
    await open()

    expect(screen.getByText('Verification document submission')).toBeTruthy()
  })

  it('says who submitted it', async () => {
    // Twice on purpose: the panel header names the submitter, and the summary
    // repeats it beside the date so the block reads on its own.
    await open()

    expect(screen.getAllByText('naveen (gdbdata3@gmail.com)').length).toBeGreaterThan(0)
  })

  it('says when', async () => {
    await open()

    expect(screen.getByText(new Date(BASE.date).toLocaleString())).toBeTruthy()
  })

  it('lists the document as the thing requiring verification', async () => {
    await open()

    expect(screen.getByText('Verification document')).toBeTruthy()
    expect(screen.getAllByText('prescription.jpg').length).toBeGreaterThan(0)
  })

  it('states plainly that the identity was not touched', async () => {
    // Otherwise "nothing changed" and "we did not tell you" look identical,
    // and only one of them is safe to approve quickly.
    await open()

    expect(screen.getByText(/No pharmacy identity fields were changed/i)).toBeTruthy()
  })

  it('shows no current-versus-requested comparison for a first document', async () => {
    // It replaced nothing, so there is no previous value to strike through.
    await open()

    expect(screen.queryByText('Previous document')).toBeNull()
    expect(screen.getByText('New document')).toBeTruthy()
  })
})

describe('C. a replacement document', () => {
  const REPLACED = {
    ...BASE,
    requestType: 'DOCUMENT_REPLACEMENT',
    requestTypeLabel: 'Verification document replacement',
    changes: [
      {
        field: 'verificationDocument',
        label: 'Verification document',
        kind: 'DOCUMENT_REPLACED',
        previousValue: 'licence.pdf',
        requestedValue: 'prescription.jpg',
      },
    ],
  }

  it('shows the old name beside the new one', async () => {
    await open([REPLACED])

    expect(screen.getByText('Previous document')).toBeTruthy()
    expect(screen.getByText('licence.pdf')).toBeTruthy()
  })

  it('distinguishes it from a first submission', async () => {
    await open([REPLACED])

    expect(screen.getByText('Verification document replacement')).toBeTruthy()
  })
})

describe('7. an identity change', () => {
  const RENAMED = {
    ...BASE,
    identityUnchanged: false,
    requestType: 'NAME_AND_LICENCE_CHANGE',
    requestTypeLabel: 'Re-verification — pharmacy identity changed',
    changes: [
      {
        field: 'name',
        label: 'Pharmacy name',
        kind: 'CHANGED',
        previousValue: 'Zoiko Meds',
        requestedValue: 'Zoiko Meds Hyderabad',
      },
      {
        field: 'licenseNumber',
        label: 'Licence number',
        kind: 'CHANGED',
        previousValue: 'LIC-JHC951',
        requestedValue: 'LIC-JHC999',
      },
    ],
  }

  it('shows both values so the reviewer can compare', async () => {
    await open([RENAMED])

    expect(screen.getAllByText('Current verified')).toHaveLength(2)
    expect(screen.getByText('Zoiko Meds Hyderabad')).toBeTruthy()
    expect(screen.getByText('LIC-JHC999')).toBeTruthy()
  })

  it('does not claim the identity was untouched', async () => {
    await open([RENAMED])

    expect(screen.queryByText(/No pharmacy identity fields were changed/i)).toBeNull()
  })
})

describe('6. first-time verification', () => {
  const FIRST = {
    ...BASE,
    isFirstTimeVerification: true,
    identityUnchanged: false,
    requestType: 'FIRST_TIME_VERIFICATION',
    requestTypeLabel: 'Initial pharmacy verification',
    currentIdentity: null,
    changes: [
      {
        field: 'name',
        label: 'Pharmacy name',
        kind: 'SUBMITTED',
        previousValue: null,
        requestedValue: 'New Chemist',
      },
    ],
  }

  it('says there is no previously approved identity', async () => {
    await open([FIRST])

    expect(screen.getByText(/no previously approved identity/i)).toBeTruthy()
  })

  it('shows the submitted value without a misleading comparison', async () => {
    // "Current: Not set" reads as a fact about an old record that never existed.
    await open([FIRST])

    expect(screen.queryByText('Current verified')).toBeNull()
    expect(screen.getByText('New Chemist')).toBeTruthy()
  })
})

describe('9. a response to an information request', () => {
  it('is obvious without reconstructing history', async () => {
    await open([
      {
        ...BASE,
        requestType: 'REQUEST_INFO_RESPONSE',
        requestTypeLabel: 'Response to information request',
        notes: 'The licence photo is unreadable. Please upload a clearer scan.',
      },
    ])

    expect(screen.getByText('Response to information request')).toBeTruthy()
    // And the reviewer's own question stays where reviewers write, separately.
    expect(screen.getByText(/licence photo is unreadable/i)).toBeTruthy()
  })
})

describe('11 & 19. layout', () => {
  it('keeps reviewer notes separate from the submission summary', async () => {
    await open()

    // The heading is uppercased in CSS, so match the text as authored.
    expect(screen.getByText('Submission Summary')).toBeTruthy()
    expect(screen.getByText(/Current Reviewer Notes/i)).toBeTruthy()
  })

  it('puts a one-line reason on the queue card', async () => {
    await open()

    expect(screen.getByText('Document submitted')).toBeTruthy()
  })

  it.each([
    ['NAME_AND_LICENCE_CHANGE', 'Name + licence change'],
    ['LICENCE_NUMBER_CHANGE', 'Licence change'],
    ['FIRST_TIME_VERIFICATION', 'Initial verification'],
    ['REQUEST_INFO_RESPONSE', 'Responded to info request'],
  ])('summarises %s on the card as "%s"', async (requestType, label) => {
    await open([{ ...BASE, requestType, requestTypeLabel: 'ignored on the card' }])

    expect(screen.getByText(label)).toBeTruthy()
  })
})

describe('a request from before submissions were recorded', () => {
  it('says so rather than inventing a type', async () => {
    await open([
      {
        ...BASE,
        requestType: 'UNRECORDED',
        requestTypeLabel: 'Submission details not recorded',
        changes: [],
      },
    ])

    expect(screen.getByText('Submission details not recorded')).toBeTruthy()
  })
})
