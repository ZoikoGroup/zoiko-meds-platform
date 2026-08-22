// @vitest-environment jsdom
//
// MP-22 — the pharmacy profile's "Upload logo" button did nothing at all. It had
// no click handler, no file input behind it and no endpoint to call, so the only
// way to notice was to press it and watch for something that never happened.
// These tests hold the whole path: pick a file, send it, show what came back.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getProfileMock = vi.fn()
const updateProfileMock = vi.fn()
const uploadLogoMock = vi.fn()
const removeLogoMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  getProfile: () => getProfileMock(),
  updateProfile: (...args) => updateProfileMock(...args),
  uploadPharmacyLogo: (...args) => uploadLogoMock(...args),
  removePharmacyLogo: (...args) => removeLogoMock(...args),
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
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  country: 'IN',
  postalCode: '',
  reliabilityScore: 90,
  logoUrl: null,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
  reviewStatus: null,
  reviewedBy: null,
  submittedAt: null,
  notes: null,
}

const pngFile = (name = 'logo.png', bytes = 1024) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' })

async function renderProfile(profile = PROFILE) {
  getProfileMock.mockResolvedValue(profile)
  const { default: PharmacyProfile } = await import('@/pages/pharmacy/PharmacyProfile')
  render(<PharmacyProfile />)
  await screen.findByText('Pharmacy logo')
}

/** The input is hidden by design, so it is reached by role-less query. */
const fileInput = () => document.querySelector('input[type="file"]')

describe('pharmacy profile logo upload', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    uploadLogoMock.mockResolvedValue({ logoUrl: '/pharmacies/ph_1/logo?v=1755511200000' })
    removeLogoMock.mockResolvedValue({ logoUrl: null })
  })

  it('offers a file picker behind the button, rather than a dead control', async () => {
    await renderProfile()

    expect(screen.getByRole('button', { name: /upload logo/i })).toBeTruthy()
    expect(fileInput()).toBeTruthy()
    expect(fileInput().accept).toContain('image/png')
  })

  it('uploads the chosen file and shows the logo it stored', async () => {
    await renderProfile()

    await userEvent.upload(fileInput(), pngFile())

    await waitFor(() => expect(uploadLogoMock).toHaveBeenCalledTimes(1))
    expect(uploadLogoMock.mock.calls[0][0].name).toBe('logo.png')

    // The URL is API-relative, so the page has to resolve it against the base.
    const img = await screen.findByAltText(/Apollo Kompally logo/i)
    expect(img.getAttribute('src')).toBe('/internal/pharmacies/ph_1/logo?v=1755511200000')
    expect(await screen.findByText(/logo updated/i)).toBeTruthy()
  })

  it('offers Replace and Remove once a logo exists', async () => {
    await renderProfile({ ...PROFILE, logoUrl: '/pharmacies/ph_1/logo?v=1' })

    expect(screen.getByRole('button', { name: /replace logo/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy()
  })

  it('removes the logo and falls back to the initials', async () => {
    await renderProfile({ ...PROFILE, logoUrl: '/pharmacies/ph_1/logo?v=1' })

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))

    await waitFor(() => expect(removeLogoMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByAltText(/logo/i)).toBeNull())
    expect(screen.getByRole('button', { name: /upload logo/i })).toBeTruthy()
  })

  describe('files it refuses before spending an upload', () => {
    it('rejects a type the endpoint would not accept', async () => {
      await renderProfile()

      await userEvent.upload(
        fileInput(),
        new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
      )

      expect(await screen.findByText(/PNG, JPEG or WebP/i)).toBeTruthy()
      expect(uploadLogoMock).not.toHaveBeenCalled()
    })

    it('rejects an image over the size cap, saying how big it was', async () => {
      await renderProfile()

      await userEvent.upload(fileInput(), pngFile('huge.png', 300 * 1024))

      expect(await screen.findByText(/maximum logo size/i)).toBeTruthy()
      expect(uploadLogoMock).not.toHaveBeenCalled()
    })
  })

  it('reports a rejected upload without claiming the profile failed to save', async () => {
    await renderProfile()
    uploadLogoMock.mockRejectedValue(new Error('That file is not a PNG, JPEG or WebP image.'))

    await userEvent.upload(fileInput(), pngFile())

    expect(await screen.findByText(/not a PNG, JPEG or WebP image/i)).toBeTruthy()
    // The profile fields are a separate request and were never submitted.
    expect(updateProfileMock).not.toHaveBeenCalled()
  })

  it('waits for the pharmacy record before offering an upload', async () => {
    // A draft has no pharmacy row yet, so there is nothing to attach a logo to.
    await renderProfile({ ...PROFILE, id: null, isDraft: true, name: '', logoUrl: null })

    expect(screen.getByRole('button', { name: /upload logo/i }).disabled).toBe(true)
    expect(screen.getByText(/Save your pharmacy details first/i)).toBeTruthy()
  })
})
