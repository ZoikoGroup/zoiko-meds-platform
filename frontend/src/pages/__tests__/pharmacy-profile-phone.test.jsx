// @vitest-environment jsdom
//
// MP-23 — the Contact details phone field accepted anything at all. It was a plain
// text input with no validation on either side, so "12345" or "call the shop" saved
// as the number patients would be given to reach the pharmacy.

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
  // The page imports it for the Maps-link field; nothing here uses it.
  resolveMapLink: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiBaseUrl: () => '/internal',
}))

const PROFILE = {
  id: 'ph_1',
  isDraft: false,
  name: 'Apollo Kompally',
  licenseNumber: 'LIC-9',
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  phone: '',
  email: 'owner@apollo.test',
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
}

async function renderProfile(profile = PROFILE) {
  getProfileMock.mockResolvedValue(profile)
  updateProfileMock.mockResolvedValue({ ...profile })
  const { default: PharmacyProfile } = await import('@/pages/pharmacy/PharmacyProfile')
  render(<PharmacyProfile />)
  await screen.findByText('Contact details')
}

const phoneField = () => document.querySelector('#p-phone')
const saveButton = () => screen.getByRole('button', { name: /save|submit/i })

describe('pharmacy profile phone validation', () => {
  afterEach(cleanup)

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('complains once too few digits have been entered and the field left', async () => {
    await renderProfile()

    // Opens with 9, so this is a mobile prefix India accepts — it is only the
    // length that is wrong, which is what puts the length rule in play.
    await userEvent.type(phoneField(), '98765')
    await userEvent.tab()

    expect(await screen.findByText(/too short/i)).toBeTruthy()
  })

  it('refuses to save an invalid number', async () => {
    await renderProfile()

    await userEvent.type(phoneField(), '98765')
    await userEvent.click(saveButton())

    // Twice over by design: on the field, and in the summary above the save
    // button, so it is visible wherever the operator is looking.
    await waitFor(() => expect(screen.getAllByText(/too short/i).length).toBeGreaterThan(0))
    // The whole point: nothing reached the API.
    expect(updateProfileMock).not.toHaveBeenCalled()
  })

  it('will not accept letters into the field at all', async () => {
    await renderProfile()

    await userEvent.type(phoneField(), 'call the shop')

    // The input refuses them outright, so this never becomes a stored value that
    // validation has to catch later.
    expect(phoneField().value.replace(/[^a-z]/gi, '')).toBe('')
  })

  it('rejects an Indian mobile that does not open with 6 to 9', async () => {
    await renderProfile()

    await userEvent.type(phoneField(), '1234567890')
    await userEvent.tab()

    expect(await screen.findByText(/valid Indian mobile/i)).toBeTruthy()
  })

  it('saves a valid number', async () => {
    await renderProfile()

    await userEvent.type(phoneField(), '9876543210')
    await userEvent.click(saveButton())

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1))
    expect(updateProfileMock.mock.calls[0][0].phone).toContain('9876543210')
  })

  it('will not save with the number left empty', async () => {
    // Patient search offers one action on every pharmacy card - call before you
    // travel - so the number is required rather than optional, and the API
    // refuses the save too.
    await renderProfile()

    await userEvent.click(saveButton())

    expect(await screen.findByText(/contact number/i)).toBeTruthy()
    expect(updateProfileMock).not.toHaveBeenCalled()
  })

  it('does not scold the operator before they have typed anything', async () => {
    await renderProfile()

    // An error on an untouched, empty field reads as the form already being wrong.
    expect(screen.queryByText(/too short/i)).toBeNull()
    expect(screen.queryByText(/valid phone/i)).toBeNull()
  })

  it('judges the number against the pharmacy country, not a fixed one', async () => {
    // Ten digits starting with 4 is a real US number and not a valid Indian mobile.
    await renderProfile({ ...PROFILE, country: 'US' })

    await userEvent.type(phoneField(), '4155552671')
    await userEvent.click(saveButton())

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1))
  })
})
