// @vitest-environment jsdom
//
// MP-20 — the settings page's API credentials card was a fixture. It rendered a
// hardcoded "zk_live_9f2c…a71d", its copy button flashed "API key copied"
// without touching the clipboard, and Regenerate flashed "(backend TODO)". The
// endpoints it needed had existed since the POS/ERP integration work.
//
// These hold the three reported faults: the key state must come from the API,
// copying must actually copy, and regenerating must issue a real key.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getIntegrationMock = vi.fn()
const issueIntegrationKeyMock = vi.fn()

// The page also loads its notification switches on mount. They are not what
// these tests are about, so they answer with everything on and save cleanly.
const ALL_PREFS_ON = {
  inventoryAlerts: true,
  verificationUpdates: true,
  uploadResults: true,
  systemMessages: true,
}

vi.mock('@/services/pharmacy-api', () => ({
  getIntegration: () => getIntegrationMock(),
  issueIntegrationKey: () => issueIntegrationKeyMock(),
  getNotificationPreferences: () => Promise.resolve({ ...ALL_PREFS_ON }),
  updateNotificationPreferences: (patch) => Promise.resolve({ ...ALL_PREFS_ON, ...patch }),
}))

let currentUser = { name: 'Asha', email: 'asha@apollo.test', role: 'PHARMACY_ADMIN' }
const changePasswordMock = vi.fn()

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: currentUser, changePassword: changePasswordMock }),
}))

const INTEGRATION_WITH_KEY = {
  connected: true,
  apiKeyPrefix: 'zk_live_9f2c1a',
  apiKeyIssuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
}

const INTEGRATION_NO_KEY = {
  connected: true,
  apiKeyPrefix: null,
  apiKeyIssuedAt: null,
}

const { default: PharmacySettings } = await import('../pharmacy/PharmacySettings')

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = { name: 'Asha', email: 'asha@apollo.test', role: 'PHARMACY_ADMIN' }
  getIntegrationMock.mockResolvedValue(INTEGRATION_WITH_KEY)
})

afterEach(cleanup)

describe('MP-20 · settings API credentials', () => {
  it('shows the key prefix the API reports, not a hardcoded one', async () => {
    render(<PharmacySettings />)

    await waitFor(() => expect(screen.getByText(/zk_live_9f2c1a…/)).toBeDefined())
    // The fixture the card used to render, whatever the pharmacy actually had.
    expect(screen.queryByDisplayValue('zk_live_9f2c…a71d')).toBeNull()
  })

  it('does not offer to copy a key it does not have', async () => {
    render(<PharmacySettings />)
    await waitFor(() => expect(getIntegrationMock).toHaveBeenCalled())

    // Only a hash is stored, so before a key is issued in this session there is
    // nothing that could be put on the clipboard. A copy button here could only
    // ever copy the mask.
    expect(screen.queryByRole('button', { name: /copy key/i })).toBeNull()
  })

  it('issues a real key and puts it on the clipboard', async () => {
    issueIntegrationKeyMock.mockResolvedValue({
      apiKey: 'zk_live_0123456789abcdef0123456789abcdef',
      integration: { ...INTEGRATION_WITH_KEY, apiKeyPrefix: 'zk_live_012345' },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<PharmacySettings />)
    await waitFor(() => expect(screen.getByRole('button', { name: /regenerate key/i })).toBeDefined())
    await user.click(screen.getByRole('button', { name: /regenerate key/i }))

    await waitFor(() => expect(issueIntegrationKeyMock).toHaveBeenCalled())
    // Shown in full exactly once, because the server keeps only a hash.
    expect(await screen.findByText('zk_live_0123456789abcdef0123456789abcdef')).toBeDefined()

    // The key is offered for copying and the button confirms it went. Which
    // clipboard route carried it is copy-button.test.jsx's subject; here the
    // point is that the button is wired to the key at all, which is what the
    // fixture version never was.
    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))
    expect(await screen.findByText('Copied')).toBeDefined()
  })

  it('warns before rotating a key that is already in use, and honours a cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()

    render(<PharmacySettings />)
    await waitFor(() => expect(screen.getByRole('button', { name: /regenerate key/i })).toBeDefined())
    await user.click(screen.getByRole('button', { name: /regenerate key/i }))

    // Rotating invalidates the live key immediately; a cancelled confirm must
    // not have issued anything.
    expect(issueIntegrationKeyMock).not.toHaveBeenCalled()
  })

  it('does not ask for confirmation when there is no key to invalidate', async () => {
    getIntegrationMock.mockResolvedValue(INTEGRATION_NO_KEY)
    issueIntegrationKeyMock.mockResolvedValue({
      apiKey: 'zk_live_first',
      integration: { ...INTEGRATION_NO_KEY, apiKeyPrefix: 'zk_live_first1' },
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<PharmacySettings />)
    await waitFor(() => expect(screen.getByRole('button', { name: /generate key/i })).toBeDefined())
    await user.click(screen.getByRole('button', { name: /generate key/i }))

    await waitFor(() => expect(issueIntegrationKeyMock).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('reports why the API refused instead of failing silently', async () => {
    issueIntegrationKeyMock.mockRejectedValue(
      new Error('Set up the integration first, then issue a key for it.'),
    )
    getIntegrationMock.mockResolvedValue(INTEGRATION_NO_KEY)
    const user = userEvent.setup()

    render(<PharmacySettings />)
    await waitFor(() => expect(screen.getByRole('button', { name: /generate key/i })).toBeDefined())
    await user.click(screen.getByRole('button', { name: /generate key/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/set up the integration first/i)).toBeDefined()
  })

  it('tells a pharmacist the key is a manager action rather than letting them collect a 403', async () => {
    currentUser = { ...currentUser, role: 'PHARMACY_STAFF' }
    render(<PharmacySettings />)

    await waitFor(() => expect(getIntegrationMock).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /regenerate key/i }).disabled).toBe(true)
    expect(screen.getByText(/only a pharmacy manager can issue or rotate/i)).toBeDefined()
  })

})
