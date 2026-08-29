// @vitest-environment jsdom
//
// Pharmacy Portal → Settings → Notification preferences.
//
// The four switches were bound to component state and nothing else. Flipping
// one flashed "Notification preferences updated" — a message that was simply
// untrue — and the value was gone on the next navigation, because there was
// nowhere for it to go. These pin the behaviour the switches always claimed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { fullName: 'Keiko Tanaka', email: 'manager@zoikomeds.io' },
    changePassword: vi.fn(),
  }),
}))

const getPreferencesMock = vi.fn()
const updatePreferencesMock = vi.fn()
vi.mock('@/services/pharmacy-api', () => ({
  getNotificationPreferences: (...args) => getPreferencesMock(...args),
  updateNotificationPreferences: (...args) => updatePreferencesMock(...args),
}))

const { default: PharmacySettings } = await import('../pharmacy/PharmacySettings')

const ALL_ON = {
  inventoryAlerts: true,
  verificationUpdates: true,
  uploadResults: true,
  systemMessages: true,
}

const switchFor = (label) => screen.getByRole('switch', { name: label })
const isOn = (element) => element.getAttribute('aria-checked') === 'true'

/** Render and wait for the saved preferences to arrive. */
async function renderSettings() {
  render(<PharmacySettings />)
  await waitFor(() => expect(getPreferencesMock).toHaveBeenCalled())
  await waitFor(() => expect(switchFor('Inventory alerts').disabled).toBe(false))
}

beforeEach(() => {
  vi.clearAllMocks()
  getPreferencesMock.mockResolvedValue({ ...ALL_ON })
  updatePreferencesMock.mockImplementation(async (patch) => ({ ...ALL_ON, ...patch }))
})

afterEach(cleanup)

describe('the switches show what was saved, not what the component assumed', () => {
  it('loads the saved preferences when Settings opens', async () => {
    getPreferencesMock.mockResolvedValue({ ...ALL_ON, systemMessages: false })

    await renderSettings()

    expect(isOn(switchFor('System messages'))).toBe(false)
    expect(isOn(switchFor('Inventory alerts'))).toBe(true)
  })

  it('does not hardcode anything to on before the answer arrives', async () => {
    // The old page rendered its own defaults immediately, so a member whose
    // preferences were off saw them on for a moment — and after a failed load,
    // permanently.
    let resolve
    getPreferencesMock.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    render(<PharmacySettings />)

    expect(isOn(switchFor('Inventory alerts'))).toBe(false)
    expect(switchFor('Inventory alerts').disabled).toBe(true)

    resolve({ ...ALL_ON })
    await waitFor(() => expect(isOn(switchFor('Inventory alerts'))).toBe(true))
  })

  it.each([
    ['Inventory alerts', 'inventoryAlerts'],
    ['Verification updates', 'verificationUpdates'],
    ['Upload results', 'uploadResults'],
    ['System messages', 'systemMessages'],
  ])('saves %s through the API when switched off', async (label, field) => {
    const user = userEvent.setup()
    await renderSettings()

    await user.click(switchFor(label))

    await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalledWith({ [field]: false }))
    expect(isOn(switchFor(label))).toBe(false)
  })

  it.each([
    ['Inventory alerts', 'inventoryAlerts'],
    ['Verification updates', 'verificationUpdates'],
    ['Upload results', 'uploadResults'],
    ['System messages', 'systemMessages'],
  ])('%s stays off after leaving and reopening Settings', async (label, field) => {
    const user = userEvent.setup()
    await renderSettings()
    await user.click(switchFor(label))
    await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalled())

    // Navigating away and back is a fresh mount reading the API again — which
    // is exactly where the old page lost the value.
    cleanup()
    getPreferencesMock.mockResolvedValue({ ...ALL_ON, [field]: false })
    await renderSettings()

    expect(isOn(switchFor(label))).toBe(false)
  })

  it('renders what the server stored, not what was clicked', async () => {
    const user = userEvent.setup()
    // A server that stores something different — another session, a rule — wins.
    updatePreferencesMock.mockResolvedValue({ ...ALL_ON, inventoryAlerts: true })
    await renderSettings()

    await user.click(switchFor('Inventory alerts'))

    await waitFor(() => expect(isOn(switchFor('Inventory alerts'))).toBe(true))
  })
})

describe('a save that fails does not leave a switch lying', () => {
  it('puts the switch back', async () => {
    const user = userEvent.setup()
    updatePreferencesMock.mockRejectedValue(new Error('Network request failed'))
    await renderSettings()

    expect(isOn(switchFor('System messages'))).toBe(true)
    await user.click(switchFor('System messages'))

    // An operator shown "off" is entitled to believe they will not be notified.
    // If the save failed, they will be.
    await waitFor(() => expect(isOn(switchFor('System messages'))).toBe(true))
  })

  it('says so rather than flashing success', async () => {
    const user = userEvent.setup()
    updatePreferencesMock.mockRejectedValue(new Error('Network request failed'))
    await renderSettings()

    await user.click(switchFor('Upload results'))

    await waitFor(() => expect(screen.getByText(/network request failed/i)).toBeDefined())
    expect(screen.queryByText('Notification preferences updated')).toBeNull()
  })

  it('leaves the other switches untouched when one save fails', async () => {
    const user = userEvent.setup()
    updatePreferencesMock.mockRejectedValue(new Error('nope'))
    await renderSettings()

    await user.click(switchFor('Inventory alerts'))

    await waitFor(() => expect(isOn(switchFor('Inventory alerts'))).toBe(true))
    expect(isOn(switchFor('Verification updates'))).toBe(true)
    expect(isOn(switchFor('System messages'))).toBe(true)
  })

  it('reports a failed load instead of showing invented switches', async () => {
    getPreferencesMock.mockRejectedValue(new Error('offline'))

    render(<PharmacySettings />)

    await waitFor(() =>
      expect(screen.getByText(/could not load your notification preferences/i)).toBeDefined(),
    )
    expect(switchFor('Inventory alerts').disabled).toBe(true)
  })
})

describe('preferences belong to the signed-in account', () => {
  it('shows the next account its own values after logout and login', async () => {
    // User A has system messages off.
    getPreferencesMock.mockResolvedValue({ ...ALL_ON, systemMessages: false })
    await renderSettings()
    expect(isOn(switchFor('System messages'))).toBe(false)

    // User B signs in on the same browser and must not inherit that.
    cleanup()
    getPreferencesMock.mockResolvedValue({ ...ALL_ON })
    await renderSettings()

    expect(isOn(switchFor('System messages'))).toBe(true)
  })

  it('sends no account identifier of its own — the session decides', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await user.click(switchFor('System messages'))

    await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalled())
    // Only the switch that changed; the server scopes it to the caller.
    expect(updatePreferencesMock).toHaveBeenCalledWith({ systemMessages: false })
  })
})
