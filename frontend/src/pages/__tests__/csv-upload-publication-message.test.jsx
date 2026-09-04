// @vitest-environment jsdom
//
// A CSV import must not report stock as live when it is only stored.
//
// A pharmacy under review is meant to be able to prepare its catalogue, so the
// import succeeds and the rows are kept. They just do not reach patients yet:
// every patient surface filters on the pharmacy's standing, so an operator who
// is told "Inventory replaced successfully" and nothing else will go looking
// for a fault in their data that is not there.
//
// The caveat is keyed on the API's own visibility state. This page does not
// re-derive who is visible.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const importCsvMock = vi.fn()
const getProfileMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  importCsv: (...a) => importCsvMock(...a),
  getProfile: () => getProfileMock(),
}))

const { default: PharmacyUpload } = await import('../pharmacy/PharmacyUpload')

const CSV = 'name,generic,strength,dosageform,status\nAmoxicillin,Amoxicillin,500mg,Capsule,IN_STOCK\n'

const PROFILE = {
  id: 'ph_1',
  name: 'Zoiko Meds',
  verificationStatus: 'VERIFIED',
  visibilityState: 'VERIFIED_VISIBLE',
  patientVisible: true,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
}

/** Drive the page through parse → upload and return once the result shows. */
async function upload(profileOver = {}) {
  getProfileMock.mockResolvedValue({ ...PROFILE, ...profileOver })
  importCsvMock.mockResolvedValue({ imported: 1, updated: 0, skipped: 0 })
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  const { container } = render(<PharmacyUpload />)

  const input = container.querySelector('input[type="file"]')
  const file = new File([CSV], 'stock.csv', { type: 'text/csv' })
  await user.upload(input, file)
  await screen.findByText(/row parsed|rows parsed/i)

  const button = screen
    .getAllByRole('button')
    .find((b) => /upload|import/i.test(b.textContent) && !b.disabled)
  await user.click(button)
  await waitFor(() => expect(importCsvMock).toHaveBeenCalled())
  await screen.findByText(/Inventory saved successfully/i)
  return user
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('a pharmacy patients can see', () => {
  it('reports the import plainly', async () => {
    await upload()

    expect(screen.getByText(/Inventory saved successfully/i)).toBeTruthy()
  })

  it('adds no caveat', async () => {
    await upload()

    expect(screen.queryByText(/not visible to users/i)).toBeNull()
    expect(screen.queryByText(/still under review/i)).toBeNull()
  })
})

describe('a pharmacy under review', () => {
  const PENDING = {
    verificationStatus: 'PENDING',
    visibilityState: 'PENDING_REVIEW',
    patientVisible: false,
  }

  it('still saves the inventory', async () => {
    // The import is not blocked: preparing a catalogue while waiting is the
    // whole point of letting a pending pharmacy use the tool.
    await upload(PENDING)

    expect(importCsvMock).toHaveBeenCalled()
    expect(screen.getByText(/Inventory saved successfully/i)).toBeTruthy()
  })

  it('says the inventory is not visible to users yet', async () => {
    await upload(PENDING)

    expect(
      screen.getByText(
        /still under review, so this inventory is not visible to users yet/i,
      ),
    ).toBeTruthy()
  })
})

describe('a rejected pharmacy', () => {
  it('saves the inventory and says why it is not published', async () => {
    await upload({
      verificationStatus: 'REJECTED',
      visibilityState: 'REJECTED',
      patientVisible: false,
    })

    expect(importCsvMock).toHaveBeenCalled()
    expect(
      screen.getByText(/not visible to users until the verification issue is resolved/i),
    ).toBeTruthy()
  })
})

describe('verified but not yet visible', () => {
  it('does not claim the stock is published', async () => {
    await upload({ visibilityState: 'VERIFIED_NOT_VISIBLE', patientVisible: false })

    expect(screen.getByText(/stored and not yet published/i)).toBeTruthy()
  })

  it('falls back to the flag when the state is missing', async () => {
    // A response from a build without `visibilityState` still must not be read
    // as "published".
    await upload({ visibilityState: undefined, patientVisible: false })

    expect(screen.getByText(/not currently visible to users/i)).toBeTruthy()
  })
})

describe('what the page never does', () => {
  it('never claims stock is live for a non-visible pharmacy', async () => {
    await upload({ visibilityState: 'PENDING_REVIEW', patientVisible: false })

    expect(screen.queryByText(/now visible to users/i)).toBeNull()
    expect(screen.queryByText(/published to patients/i)).toBeNull()
  })

  it('does not decide visibility from verificationStatus', async () => {
    // VERIFIED, and still not visible. Only the API knows.
    await upload({
      verificationStatus: 'VERIFIED',
      visibilityState: 'VERIFIED_NOT_VISIBLE',
      patientVisible: false,
    })

    expect(screen.getByText(/not yet published/i)).toBeTruthy()
  })
})
