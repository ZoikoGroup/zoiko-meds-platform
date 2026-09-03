// @vitest-environment jsdom
//
// Verified is not the same as findable.
//
// Approving a licence used to publish the pharmacy in the same write, so an
// operator with no map position was marked participating and returned by no
// patient search at all. Listing now waits for a location, which means the
// portal has to say so: "Verified" on its own would leave an operator believing
// patients could see them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const getProfileMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  getProfile: () => getProfileMock(),
  updateProfile: vi.fn(),
  uploadPharmacyLogo: vi.fn(),
  removePharmacyLogo: vi.fn(),
  resolveMapLink: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiBaseUrl: () => '/internal',
  // The sign-in security card on this page reads its own status. Stubbed to
  // nothing so it renders nothing: these tests are about the profile form,
  // and an unmocked read would put an error alert in their way (MSA-42).
  apiFetch: () => Promise.resolve(undefined),
}))

const PROFILE = {
  id: 'ph_1',
  isDraft: false,
  name: 'Apollo Kompally',
  licenseNumber: 'LIC-9',
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  listingBlockedReason: null,
  phone: '+91 98765 43210',
  email: 'owner@apollo.test',
  addressLine1: 'Kompally Main Rd',
  addressLine2: '',
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500014',
  latitude: 17.5561,
  longitude: 78.4181,
  locationPrecision: 'EXACT',
  reliabilityScore: 90,
  logoUrl: null,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
}

async function renderProfile(over = {}) {
  getProfileMock.mockResolvedValue({ ...PROFILE, ...over })
  const { default: PharmacyProfile } = await import('@/pages/pharmacy/PharmacyProfile')
  render(<PharmacyProfile />)
  await screen.findByText('Contact details')
}

describe('a verified pharmacy that patients cannot find yet', () => {
  afterEach(cleanup)
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('says the licence is approved but the listing is waiting on a location', async () => {
    await renderProfile({
      isParticipating: false,
      latitude: null,
      longitude: null,
      locationPrecision: null,
      listingBlockedReason:
        'Verified, but not listed to patients yet: this pharmacy has no map location.',
    })

    expect(await screen.findByText(/patients cannot find you yet/i)).toBeTruthy()
    // And what to do about it, in the same breath — a warning with no action is
    // just an operator watching their own pharmacy stay invisible.
    expect(screen.getByText(/set your location below/i)).toBeTruthy()
  })

  it('says nothing when the pharmacy is listed', async () => {
    await renderProfile()

    expect(screen.queryByText(/patients cannot find you yet/i)).toBeNull()
  })

  it('flags an area-level pin as approximate so the operator can improve it', async () => {
    await renderProfile({ locationPrecision: 'APPROXIMATE' })

    // Placed from a city and postcode: enough to be found, not enough to be
    // quoted to a tenth of a kilometre. Only the operator knows the building.
    expect(await screen.findByText(/approximate position/i)).toBeTruthy()
  })

  it('does not call an exact pin approximate', async () => {
    await renderProfile()

    expect(screen.queryByText(/approximate position/i)).toBeNull()
  })
})
