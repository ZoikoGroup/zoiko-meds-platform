// @vitest-environment jsdom
//
// What the Pharmacy Profile save actually puts on the wire, once a licence
// document is already attached.
//
// The page kept the GET response in one `profile` state object and sent that
// object back on save. GET describes the file on record — filename, mimeType,
// sizeBytes, uploadedAt — while the upload DTO takes filename + content, so the
// description of the stored file arrived at the API as an upload of a new one.
// A pharmacy editing only its licence number was told a 31 KB screenshot it had
// never touched was over the 5 MB limit.
//
// The attached-document metadata is display-only now. Only a file the operator
// has just chosen is submitted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getProfileMock = vi.fn()
const updateProfileMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  getProfile: () => getProfileMock(),
  updateProfile: (...args) => updateProfileMock(...args),
  uploadPharmacyLogo: vi.fn(),
  removePharmacyLogo: vi.fn(),
  resolveMapLink: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ apiBaseUrl: () => '/internal' }))

/** Exactly the metadata shape GET /pharmacies/me returns. */
const ATTACHED = {
  filename: 'Screenshot 2026-06-16 132925.png',
  mimeType: 'image/png',
  sizeBytes: 31 * 1024,
  uploadedAt: '2026-06-16T13:29:25.000Z',
}

const PROFILE = {
  id: 'ph_1',
  isDraft: false,
  name: 'testerpharma',
  licenseNumber: 'LC-1234567',
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  phone: '9876543210',
  email: 'owner@testerpharma.test',
  addressLine1: 'Kompally Main Rd',
  addressLine2: '',
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500014',
  reliabilityScore: 90,
  logoUrl: null,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
  // The document already on file.
  document: ATTACHED,
}

async function renderProfile(profile = PROFILE) {
  getProfileMock.mockResolvedValue(profile)
  updateProfileMock.mockResolvedValue({ ...profile })
  const { default: PharmacyProfile } = await import('@/pages/pharmacy/PharmacyProfile')
  render(<PharmacyProfile />)
  await screen.findByText('Contact details')
}

const licenceField = () => document.querySelector('#p-license')
const saveButton = () => screen.getByRole('button', { name: /save|submit/i })

/** The body handed to updateProfile by the last save. */
const sentBody = () => updateProfileMock.mock.calls.at(-1)?.[0]

async function save() {
  await userEvent.click(saveButton())
  await waitFor(() => expect(updateProfileMock).toHaveBeenCalled())
}

afterEach(cleanup)
beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a profile-only save, with a document already attached', () => {
  it('sends no document at all', async () => {
    // The whole bug in one assertion.
    await renderProfile()

    await save()

    expect(sentBody()).not.toHaveProperty('document')
  })

  it.each(['mimeType', 'sizeBytes', 'uploadedAt'])(
    'never sends the response-only %s',
    async (field) => {
      await renderProfile()

      await save()

      expect(JSON.stringify(sentBody())).not.toContain(field)
    },
  )

  it('still sends the profile fields the operator edited', async () => {
    await renderProfile()
    await userEvent.clear(licenceField())
    await userEvent.type(licenceField(), 'LC-9999999')

    await save()

    expect(sentBody()).toMatchObject({ name: 'testerpharma', licenseNumber: 'LC-9999999' })
  })

  it('reports no error to the operator', async () => {
    // The red banner quoted mimeType/sizeBytes/uploadedAt and a size limit.
    await renderProfile()

    await save()

    expect(screen.queryByText(/should not exist/i)).toBeNull()
    expect(screen.queryByText(/too large/i)).toBeNull()
  })

  it('keeps showing the attached file after saving', async () => {
    // Display-only does not mean forgotten: the operator must still see what is
    // on record, and the API preserves it because nothing asked it to change.
    await renderProfile()

    await save()

    expect(await screen.findByText(ATTACHED.filename)).toBeTruthy()
  })
})

describe('a save with no document ever attached', () => {
  it('sends no document key', async () => {
    await renderProfile({ ...PROFILE, document: null })

    await save()

    expect(sentBody()).not.toHaveProperty('document')
  })
})

describe('what the page shows about the attached file', () => {
  it('names it and offers to replace it', async () => {
    await renderProfile()

    expect(screen.getByText(ATTACHED.filename)).toBeTruthy()
    expect(screen.getByRole('button', { name: /replace document/i })).toBeTruthy()
  })

  it('offers to upload when there is nothing on file', async () => {
    await renderProfile({ ...PROFILE, document: null })

    expect(screen.getByRole('button', { name: /upload document/i })).toBeTruthy()
  })
})
