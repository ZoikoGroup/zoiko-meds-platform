// @vitest-environment jsdom
//
// The Uploaded Documents panel.
//
// The reported case: a pharmacy attaches prescription.jpg, saves, and the
// portal shows the file attached — while the Verification Center reads
// "No document". The backend half of that is fixed elsewhere; this is the
// reading half. The panel used to key on `docName`, a column copied onto the
// request when a document is stored, so it answered "is there a file" from a
// copy rather than from the row View File actually serves.
//
// Nothing here consults the pharmacy's profile. What an operator sees on their
// own page is a different question from what is attached to the request in
// front of the reviewer, and conflating the two is how this started.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const listMock = vi.fn()
const getDocumentMock = vi.fn()
const updateMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listVerifications: () => listMock(),
  getVerificationDocument: (...a) => getDocumentMock(...a),
  updateVerification: (...a) => updateMock(...a),
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

const { default: VerificationCenter } = await import('../VerificationCenter')

/** The request from the report, with its document attached. */
const ZOIKO = {
  id: 'req_zoiko',
  pharmacyId: 'ph_zoiko',
  pharmacy: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  requestedName: 'Zoiko Meds',
  requestedLicenseNumber: 'LIC-JHC951',
  changes: [],
  reason: null,
  submittedBy: 'naveen (gdbdata3@gmail.com)',
  date: '2026-08-03T00:00:00.000Z',
  status: 'PENDING',
  reviewer: null,
  notes: null,
  addressLine1: 'Prakruthi nivas',
  city: 'Gandimaisamma',
  region: 'Telangana',
  postalCode: '500043',
  country: 'IN',
  docName: 'prescription.jpg',
  docUrl: '/admin/verification-requests/req_zoiko/document',
  document: {
    id: 'doc_1',
    filename: 'prescription.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 38_912,
    uploadedAt: '2026-08-03T10:15:00.000Z',
  },
}

const openQueue = async (requests = [ZOIKO]) => {
  listMock.mockResolvedValue(requests)
  render(<VerificationCenter />)
  await screen.findByText('Uploaded Documents')
  return userEvent.setup({ pointerEventsCheck: 0 })
}

const viewFileButton = () => screen.getByRole('button', { name: /View File/i })

beforeEach(() => {
  vi.clearAllMocks()
  getDocumentMock.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
  vi.stubGlobal('open', vi.fn())
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:doc')
    URL.revokeObjectURL = vi.fn()
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('B. a request with a document', () => {
  it('names the file', async () => {
    await openQueue()

    expect(screen.getByText('prescription.jpg')).toBeDefined()
  })

  it('shows its type and size', async () => {
    await openQueue()

    expect(screen.getByText(/JPG/)).toBeDefined()
    expect(screen.getByText(/38 KB|38\.0 KB/)).toBeDefined()
  })

  it('does not say the pharmacy attached nothing', async () => {
    await openQueue()

    expect(screen.queryByText(/has not attached a document/i)).toBeNull()
  })

  it('C. enables View File', async () => {
    await openQueue()

    expect(viewFileButton().disabled).toBe(false)
  })
})

describe('C. View File uses the protected endpoint', () => {
  it('asks for the document by request id', async () => {
    const user = await openQueue()

    await user.click(viewFileButton())

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledWith('req_zoiko'))
  })

  it('never puts the file bytes in the queue response', async () => {
    // The list carries metadata; the bytes come from the authenticated fetch
    // above, once, when a reviewer actually asks for them.
    await openQueue()

    expect(ZOIKO.document.data).toBeUndefined()
    expect(getDocumentMock).not.toHaveBeenCalled()
  })
})

describe('G. a request with no document', () => {
  const withoutDocument = { ...ZOIKO, document: null, docName: null }

  it('says so', async () => {
    await openQueue([withoutDocument])

    expect(screen.getByText('No document')).toBeDefined()
    expect(screen.getByText(/has not attached a document/i)).toBeDefined()
  })

  it('disables View File', async () => {
    await openQueue([withoutDocument])

    expect(viewFileButton().disabled).toBe(true)
  })
})

describe('10. existence comes from the document, not the copied column', () => {
  it('shows "No document" when the column disagrees with the relation', async () => {
    // The drift case. docName still holds a filename; the row it described is
    // gone, so the endpoint behind View File would 404.
    await openQueue([{ ...ZOIKO, docName: 'prescription.jpg', document: null }])

    expect(screen.getByText('No document')).toBeDefined()
    expect(viewFileButton().disabled).toBe(true)
  })

  it('shows the document when the relation is there but the column is empty', async () => {
    await openQueue([{ ...ZOIKO, docName: null }])

    expect(screen.getByText('prescription.jpg')).toBeDefined()
    expect(viewFileButton().disabled).toBe(false)
  })
})

describe('6. two pharmacies are never conflated', () => {
  const APOLLO = {
    ...ZOIKO,
    id: 'req_apollo',
    pharmacyId: 'ph_apollo',
    pharmacy: 'Apollo Pharmacy',
    licenseNumber: 'LIC-2WOMQH',
    requestedName: 'Apollo Pharmacy',
    requestedLicenseNumber: 'LIC-2WOMQH',
    document: null,
    docName: null,
  }

  it('shows the selected request’s own document, not another request’s', async () => {
    // The screenshots side by side: Apollo selected and holding no document,
    // Zoiko holding one. Reading the wrong row either way is the whole bug.
    await openQueue([APOLLO, ZOIKO])

    expect(screen.getByText('No document')).toBeDefined()
    expect(screen.queryByText('prescription.jpg')).toBeNull()
  })

  it('follows the reviewer to the other request', async () => {
    const user = await openQueue([APOLLO, ZOIKO])

    await user.click(screen.getByText('Zoiko Meds'))

    expect(await screen.findByText('prescription.jpg')).toBeDefined()
  })
})
