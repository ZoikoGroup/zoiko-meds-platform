// @vitest-environment jsdom
//
// What the Pharmacy Profile tells an operator about where they stand.
//
// The page already had a state for pending and one for rejected, and none at
// all for the outcome an operator is actually waiting for. Being approved
// looked exactly like nothing having happened.
//
// The success state is the one that has to be earned rather than assumed.
// "Verified" is only one of three gates a patient search puts a pharmacy
// through — it must also be participating, and its commercial standing must be
// one patients are shown. A pharmacy can hold VERIFIED and be returned by no
// search at all, so the page asks the API whether patients can see this
// pharmacy and says so only when the answer is yes. Getting that wrong in the
// congratulatory direction is worse than saying nothing: the operator stops
// looking for the reason they have no traffic.

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
  apiFetch: () => Promise.resolve(undefined),
}))

/** A verified pharmacy that patients can find — every gate open. */
const VISIBLE = {
  id: 'ph_1',
  isDraft: false,
  name: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  patientVisible: true,
  listingBlockedReason: null,
  phone: '+91 96663 44441',
  email: 'owner@zoiko.test',
  addressLine1: 'Prakruthi nivas',
  addressLine2: '',
  city: 'Gandimaisamma',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500043',
  latitude: 17.5878,
  longitude: 78.4236,
  locationPrecision: 'EXACT',
  reliabilityScore: 90,
  logoUrl: null,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
  visibilityState: 'VERIFIED_VISIBLE',
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
  document: null,
}

async function renderProfile(over = {}) {
  getProfileMock.mockResolvedValue({ ...VISIBLE, ...over })
  const { default: PharmacyProfile } = await import('@/pages/pharmacy/PharmacyProfile')
  render(<PharmacyProfile />)
  await screen.findByText('Contact details')
}

const successBanner = () => screen.queryByText("You're all set!")

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('VERIFIED and patient-visible', () => {
  it('says so', async () => {
    await renderProfile()

    expect(successBanner()).toBeTruthy()
  })

  it('tells the operator patients can see them', async () => {
    await renderProfile()

    expect(
      screen.getByText('Your pharmacy is verified and is now visible to users on ZoikoMeds.'),
    ).toBeTruthy()
  })

  it('raises nothing to fix', async () => {
    await renderProfile()

    expect(screen.queryByText('Verification complete')).toBeNull()
    expect(screen.queryByText(/Verification pending|being reviewed/i)).toBeNull()
    expect(screen.queryByText(/Verification rejected/i)).toBeNull()
  })
})

describe('VERIFIED but not patient-visible', () => {
  // Each of the three gates, since any one of them keeps the pharmacy out of
  // patient search while `verificationStatus` still reads VERIFIED.
  const CASES = [
    [
      'no map location',
      {
        isParticipating: false,
        latitude: null,
        longitude: null,
        locationPrecision: null,
        listingBlockedReason:
          'Verified, but not listed to patients yet: this pharmacy has no map location, ' +
          'and every patient search is distance-bounded. It is listed automatically as ' +
          'soon as a location is set.',
      },
    ],
    [
      'no longer participating',
      {
        isParticipating: false,
        listingBlockedReason:
          'Your licence is approved, but your pharmacy is currently not taking part in ' +
          'the ZoikoMeds network, so patient searches do not include it. Contact support ' +
          'to rejoin.',
      },
    ],
    [
      'a commercial standing patients are not shown',
      {
        // Located and participating, and still returned by no search: approval
        // says the pharmacy is real, not that anyone has claimed it. This case
        // used to produce no message whatsoever.
        commercialClassification: 'CLAIMED_PENDING',
        listingBlockedReason:
          'Your licence is approved. Your pharmacy account is still being set up on the ' +
          'ZoikoMeds network, so patient searches do not include it yet. The ZoikoMeds ' +
          'team completes this step — there is nothing for you to do.',
      },
    ],
  ]

  it.each(CASES)('never claims patients can see them — %s', async (_label, over) => {
    // The assertion this whole state exists for.
    await renderProfile({ patientVisible: false, visibilityState: 'VERIFIED_NOT_VISIBLE', ...over })

    expect(successBanner()).toBeNull()
    expect(screen.queryByText(/visible to users on ZoikoMeds/i)).toBeNull()
  })

  it.each(CASES)('reports an accurate state instead — %s', async (_label, over) => {
    await renderProfile({ patientVisible: false, visibilityState: 'VERIFIED_NOT_VISIBLE', ...over })

    expect(screen.getByText('Verification complete')).toBeTruthy()
  })

  it.each(CASES)('explains what is holding it back — %s', async (_label, over) => {
    await renderProfile({ patientVisible: false, visibilityState: 'VERIFIED_NOT_VISIBLE', ...over })

    expect(screen.getByText(over.listingBlockedReason)).toBeTruthy()
  })

  it('does not decide visibility from verificationStatus alone', async () => {
    // VERIFIED, participating, located — and still not visible, because the
    // classification gate is closed. Nothing the page can see locally would
    // distinguish this from the success case.
    await renderProfile({
      patientVisible: false,
      visibilityState: 'VERIFIED_NOT_VISIBLE',
      commercialClassification: 'CLAIMED_PENDING',
      listingBlockedReason: 'Your pharmacy account is still being set up.',
    })

    expect(screen.getByText('Verified')).toBeTruthy()
    expect(successBanner()).toBeNull()
  })
})

describe('PENDING', () => {
  const PENDING = {
    verificationStatus: 'PENDING',
    visibilityState: 'PENDING_REVIEW',
    isParticipating: false,
    patientVisible: false,
    listingBlockedReason: null,
    reviewStatus: 'PENDING',
  }

  it('says the submission is under review', async () => {
    await renderProfile(PENDING)

    expect(screen.getByText('Verification under review')).toBeTruthy()
  })

  it('says the pharmacy is not visible to users yet', async () => {
    await renderProfile(PENDING)

    expect(screen.getByText(/not visible to users yet/i)).toBeTruthy()
  })

  it('says the operator can keep working while it is reviewed', async () => {
    // A pharmacy under review can still fill in its profile and import stock;
    // the banner has to say so, or the wait reads as a lockout.
    await renderProfile(PENDING)

    expect(screen.getByText(/continue updating your profile and inventory/i)).toBeTruthy()
  })

  it('shows no success banner', async () => {
    await renderProfile(PENDING)

    expect(successBanner()).toBeNull()
  })

  it('does not also raise the listing warning', async () => {
    // "Verification complete" over a request still being read would contradict
    // the notice directly above it.
    await renderProfile(PENDING)

    expect(screen.queryByText('Verification complete')).toBeNull()
  })
})

describe('REJECTED', () => {
  const REJECTED = {
    verificationStatus: 'REJECTED',
    visibilityState: 'REJECTED',
    isParticipating: false,
    patientVisible: false,
    listingBlockedReason: null,
    reviewStatus: 'REJECTED',
  }

  it('says the verification was rejected', async () => {
    await renderProfile(REJECTED)

    expect(screen.getByText('Verification rejected')).toBeTruthy()
  })

  it('says what to do next', async () => {
    await renderProfile(REJECTED)

    expect(screen.getByText(/Correct the details below/i)).toBeTruthy()
  })

  it('shows no success banner', async () => {
    await renderProfile(REJECTED)

    expect(successBanner()).toBeNull()
  })
})

describe('the state survives a reload', () => {
  it('is rendered from the API response, not from anything held locally', async () => {
    // Same component, two answers from the API, two different banners — which
    // is what makes a refresh after a Super Admin approval show the new state.
    await renderProfile({
      patientVisible: false,
      visibilityState: 'VERIFIED_NOT_VISIBLE',
      listingBlockedReason: 'Still being set up.',
    })
    expect(successBanner()).toBeNull()

    cleanup()
    await renderProfile()

    expect(successBanner()).toBeTruthy()
  })

  it('asks the API on every mount', async () => {
    await renderProfile()

    expect(getProfileMock).toHaveBeenCalled()
  })
})
