// @vitest-environment jsdom
//
// MSA-42 — the second factor a patient or a pharmacy can actually use.
//
// The authenticator app was only ever reachable by a super admin: enrolment
// needs a session, and the screen offering it is on the admin settings page. So
// the workspace switch that required a second factor of everybody could turn
// every patient and every pharmacy out of the platform, with nowhere for any of
// them to enrol and no session in which to try.
//
// The emailed link needs no app and no enrolment. The account turns it on
// itself, and the next sign-in is confirmed from the inbox it already owns.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/providers/theme-provider'

const loginMock = vi.fn()
const completeLoginLinkMock = vi.fn()
const navigateMock = vi.fn()
const statusMock = vi.fn()
const setEnabledMock = vi.fn()

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ login: loginMock, completeLoginLink: completeLoginLinkMock }),
}))

vi.mock('@/lib/api-client', () => ({
  consumeSessionExpired: () => false,
  apiBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/services/auth-api', () => ({
  emailFactorStatusRequest: () => statusMock(),
  setEmailFactorRequest: (enabled) => setEnabledMock(enabled),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const { default: Login } = await import('../Login')
const { default: VerifyLogin } = await import('../VerifyLogin')
const { EmailSecondFactorCard } = await import('@/components/shared/email-second-factor-card')

const LINK_SENT = {
  mfaEmailSent: true,
  email: 'as****@zoikomeds.test',
  expiresInMinutes: 10,
  message: 'We sent a sign-in link to as****@zoikomeds.test.',
}

const wrap = (ui, entries = ['/']) =>
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={entries}>{ui}</MemoryRouter>
    </ThemeProvider>,
  )

async function signIn(user) {
  await user.type(screen.getByLabelText(/email address/i), 'asha@zoikomeds.test')
  await user.type(screen.getByLabelText(/^password/i), 'correct-horse')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /continue securely/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  loginMock.mockResolvedValue({ role: 'PUBLIC' })
  completeLoginLinkMock.mockResolvedValue({ role: 'PUBLIC' })
  statusMock.mockResolvedValue({
    enabled: false,
    available: true,
    email: 'as****@zoikomeds.test',
  })
  setEnabledMock.mockImplementation((enabled) => Promise.resolve({ mfaEmailEnabled: enabled }))
})

afterEach(cleanup)

describe('signing in with the emailed factor on', () => {
  it('says the link was sent rather than signing anybody in', async () => {
    loginMock.mockResolvedValue(LINK_SENT)
    const user = userEvent.setup()
    wrap(<Login />, ['/login'])

    await signIn(user)

    expect(await screen.findByText(/check your email/i)).toBeDefined()
    // A right password is now half a sign-in. Navigating would be the app
    // acting as though the second factor had already been proved.
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('names the inbox as the server masked it, not in full', async () => {
    loginMock.mockResolvedValue(LINK_SENT)
    const user = userEvent.setup()
    wrap(<Login />, ['/login'])

    await signIn(user)

    expect(await screen.findByText('as****@zoikomeds.test')).toBeDefined()
    expect(screen.queryByText(/asha@zoikomeds\.test/)).toBeNull()
  })

  it('takes the password field down with the form', async () => {
    // Nothing left to type here: the next step is in a mail client, and leaving
    // the form up invites another attempt that would only send a second link.
    loginMock.mockResolvedValue(LINK_SENT)
    const user = userEvent.setup()
    wrap(<Login />, ['/login'])

    await signIn(user)

    await waitFor(() => expect(screen.queryByLabelText(/^password/i)).toBeNull())
  })

  it('offers a way back to sign in as somebody else', async () => {
    loginMock.mockResolvedValue(LINK_SENT)
    const user = userEvent.setup()
    wrap(<Login />, ['/login'])

    await signIn(user)
    await user.click(await screen.findByRole('button', { name: /different account/i }))

    expect(screen.getByLabelText(/^password/i)).toBeDefined()
    expect(screen.queryByText(/check your email/i)).toBeNull()
  })

  it('leaves an account without the factor signing in as before', async () => {
    const user = userEvent.setup()
    wrap(<Login />, ['/login'])

    await signIn(user)

    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    expect(screen.queryByText(/check your email/i)).toBeNull()
  })
})

describe('opening the link', () => {
  it('exchanges the token and sends the member to their portal', async () => {
    wrap(<VerifyLogin />, ['/auth/verify-login?token=abc123'])

    await waitFor(() => expect(completeLoginLinkMock).toHaveBeenCalledWith('abc123'))
    expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('spends the token once, even though StrictMode runs the effect twice', async () => {
    // The token is single use. A second exchange would spend it and then report
    // a working link as invalid.
    wrap(<VerifyLogin />, ['/auth/verify-login?token=abc123'])

    await waitFor(() => expect(completeLoginLinkMock).toHaveBeenCalled())
    expect(completeLoginLinkMock).toHaveBeenCalledTimes(1)
  })

  it('explains a spent or expired link instead of looking broken', async () => {
    completeLoginLinkMock.mockRejectedValue(
      new Error('This sign-in link is no longer valid. Sign in again to get a new one.'),
    )
    wrap(<VerifyLogin />, ['/auth/verify-login?token=stale'])

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/no longer valid/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /sign in again/i })).toBeDefined()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('says so when the link arrived without its token', async () => {
    wrap(<VerifyLogin />, ['/auth/verify-login'])

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(completeLoginLinkMock).not.toHaveBeenCalled()
  })
})

describe('choosing to use it', () => {
  it('offers the switch to an account that may have it', async () => {
    wrap(<EmailSecondFactorCard />)

    expect(
      await screen.findByRole('switch', { name: /confirm each sign-in by email/i }),
    ).toBeDefined()
  })

  it('turns it on, which is the account holder’s own decision', async () => {
    const user = userEvent.setup()
    wrap(<EmailSecondFactorCard />)

    await user.click(await screen.findByRole('switch'))

    await waitFor(() => expect(setEnabledMock).toHaveBeenCalledWith(true))
    expect(await screen.findByText(/is on/i)).toBeDefined()
  })

  it('turns it back off again, with nothing in the way', async () => {
    // A factor an account cannot undo for itself is a lockout waiting for a
    // lost phone or a closed mailbox.
    statusMock.mockResolvedValue({
      enabled: true,
      available: true,
      email: 'as****@zoikomeds.test',
    })
    const user = userEvent.setup()
    wrap(<EmailSecondFactorCard />)

    const control = await screen.findByRole('switch')
    expect(control.getAttribute('data-state')).toBe('checked')
    await user.click(control)

    await waitFor(() => expect(setEnabledMock).toHaveBeenCalledWith(false))
  })

  it('renders nothing for an account the factor does not apply to', async () => {
    // An administrator has the authenticator app, which is a better one. Being
    // shown a disabled switch would say this was theirs to use.
    statusMock.mockResolvedValue({ enabled: false, available: false, email: 'ro****@z.test' })
    const { container } = wrap(<EmailSecondFactorCard />)

    await waitFor(() => expect(container.querySelector('[role="switch"]')).toBeNull())
    expect(screen.queryByText(/sign-in security/i)).toBeNull()
  })

  it('puts the switch back when a save is refused', async () => {
    setEnabledMock.mockRejectedValue(new Error('Could not save that change.'))
    const user = userEvent.setup()
    wrap(<EmailSecondFactorCard />)

    await user.click(await screen.findByRole('switch'))

    expect(await screen.findByRole('alert')).toBeDefined()
    await waitFor(() =>
      expect(screen.getByRole('switch').getAttribute('data-state')).toBe('unchecked'),
    )
  })

  it('reports a failed read rather than quietly disappearing', async () => {
    // A card that vanished would tell an account that had this on that it did not.
    statusMock.mockRejectedValue(new Error('Could not load your sign-in settings.'))
    wrap(<EmailSecondFactorCard />)

    expect(await screen.findByRole('alert')).toBeDefined()
  })
})
