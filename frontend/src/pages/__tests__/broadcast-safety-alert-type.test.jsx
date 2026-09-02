// @vitest-environment jsdom
//
// Compose Broadcast Announcement — saying which safety category an emergency
// alert is.
//
// ZoikoSignal split a dispatched Emergency Alert into the patient's two safety
// categories with /recall/i against the title. So "Urgent product withdrawal"
// reached patients as a government advisory, a recall drill announcement
// reached them as a recall, and which of a patient's two toggles governed a
// broadcast came down to how the heading happened to be worded. The person
// dispatching it now says which it is.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const createMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listNotifications: vi.fn(async () => []),
  createNotification: (...a) => createMock(...a),
  deleteNotification: vi.fn(async () => ({})),
}))

const { default: Notifications } = await import('../Notifications')

const CHANNEL = /Alert Channel Type/i
const SAFETY = /Safety Alert Type/i

/** Open the compose dialog and return a user-event session. */
const openCompose = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<Notifications />)
  const compose = await screen.findByRole('button', { name: /compose/i })
  await user.click(compose)
  await waitFor(() => expect(screen.getByLabelText(CHANNEL)).toBeDefined())
  return user
}

/** Choose a broadcast channel type by its visible label. */
const chooseChannel = async (user, label) =>
  user.selectOptions(screen.getByLabelText(CHANNEL), screen.getByRole('option', { name: label }))

/** Fill the two always-required fields. */
const fillBody = async (user, title = 'Urgent product withdrawal') => {
  await user.type(screen.getByPlaceholderText(/Critical SSO Maintenance Window/i), title)
  await user.type(screen.getByPlaceholderText(/detailed messaging text/i), 'Return affected packs.')
}

const dispatch = (user) =>
  user.click(screen.getByRole('button', { name: /Dispatch Broadcast/i }))

beforeEach(() => {
  createMock.mockResolvedValue({ id: 'bc_1' })
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('when the field appears', () => {
  it('is hidden on the default channel', async () => {
    await openCompose()
    expect(screen.queryByLabelText(SAFETY)).toBeNull()
  })

  it('appears for Emergency Alert', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')

    expect(screen.getByLabelText(SAFETY)).toBeDefined()
  })

  it.each(['Platform Update', 'Maintenance', 'System Announcement'])(
    'stays hidden for %s',
    async (label) => {
      // Those three never become ZoikoSignal notifications, so a safety
      // category would be a value nothing reads.
      const user = await openCompose()
      await chooseChannel(user, label)

      expect(screen.queryByLabelText(SAFETY)).toBeNull()
    },
  )

  it('offers exactly the two patient categories', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')

    const options = [...screen.getByLabelText(SAFETY).options]
      .map((o) => o.value)
      .filter(Boolean)
    expect(options).toEqual(['MEDICINE_RECALL', 'GOVERNMENT_SAFETY'])
  })

  it('keeps every field the dialog already had', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')

    expect(screen.getByPlaceholderText(/Critical SSO Maintenance Window/i)).toBeDefined()
    expect(screen.getByLabelText(CHANNEL)).toBeDefined()
    expect(screen.getByLabelText(/Target Recipient Group/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/detailed messaging text/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Dispatch Broadcast/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeDefined()
  })
})

describe('validation', () => {
  it('marks the field required, so the browser blocks the submit', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')

    expect(screen.getByLabelText(SAFETY).required).toBe(true)
  })

  it('refuses to dispatch an emergency alert with no category chosen', async () => {
    // Native validation stops it first; the handler carries the same guard so a
    // programmatic submit cannot get past it either, and the backend refuses it
    // a third time.
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await fillBody(user)
    await dispatch(user)

    expect(createMock).not.toHaveBeenCalled()
  })

  it('dispatches once a category is chosen', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await fillBody(user)
    await user.selectOptions(screen.getByLabelText(SAFETY), 'MEDICINE_RECALL')
    await dispatch(user)

    await waitFor(() => expect(createMock).toHaveBeenCalled())
  })
})

describe('what is sent', () => {
  it('sends MEDICINE_RECALL for a title that never says "recall"', async () => {
    // The exact case the old title rule got wrong.
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await fillBody(user, 'Urgent product withdrawal')
    await user.selectOptions(screen.getByLabelText(SAFETY), 'MEDICINE_RECALL')
    await dispatch(user)

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EMERGENCY_ALERT',
          safetyKind: 'MEDICINE_RECALL',
          title: 'Urgent product withdrawal',
        }),
      ),
    )
  })

  it('sends GOVERNMENT_SAFETY for a regulator advisory', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await fillBody(user, 'National regulator advisory')
    await user.selectOptions(screen.getByLabelText(SAFETY), 'GOVERNMENT_SAFETY')
    await dispatch(user)

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ safetyKind: 'GOVERNMENT_SAFETY' }),
      ),
    )
  })

  it('sends no category on a non-emergency broadcast', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Maintenance')
    await fillBody(user, 'Scheduled maintenance')
    await dispatch(user)

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('safetyKind')
  })

  it('drops a choice made before switching away from Emergency Alert', async () => {
    // Otherwise a maintenance notice could carry a stale recall category.
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await user.selectOptions(screen.getByLabelText(SAFETY), 'MEDICINE_RECALL')
    await chooseChannel(user, 'Platform Update')
    await fillBody(user, 'Release 4.2')
    await dispatch(user)

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('safetyKind')
  })

  it('keeps the recipient group the operator picked', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')
    await fillBody(user)
    await user.selectOptions(screen.getByLabelText(SAFETY), 'GOVERNMENT_SAFETY')
    await dispatch(user)

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'ALL_USERS' }),
      ),
    )
  })

  it('says what the choice decides, so it is not guessed at', async () => {
    const user = await openCompose()
    await chooseChannel(user, 'Emergency Alert')

    expect(
      screen.getByText(/Patients with that toggle off will not receive it/i),
    ).toBeDefined()
  })
})
