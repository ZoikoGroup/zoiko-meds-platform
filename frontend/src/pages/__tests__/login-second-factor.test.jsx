// @vitest-environment jsdom
//
// MSA-42 — the sign-in half of the two-factor flow.
//
// Enforcement was built and the enrolment endpoints existed, but the login form
// only ever sent an address and a password. An account with a second factor was
// refused, shown the refusal as though it were a bad password, and given
// nowhere to type the code — so enrolling was the one thing that could take an
// account's sign-in away, and the settings switch that required it of everybody
// took the workspace's.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/providers/theme-provider'

const loginMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ login: loginMock }),
}))

vi.mock('@/lib/api-client', () => ({
  consumeSessionExpired: () => false,
  apiBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const { default: Login } = await import('../Login')

/** A refusal that carries the reason, as apiFetch builds it. */
function refusal(message, body) {
  const err = new Error(message)
  err.status = 401
  err.body = { message, ...body }
  return err
}

// AuthLayout reads the theme, so the provider is part of rendering this page
// at all rather than anything the test is asserting about.
const renderLogin = () =>
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </ThemeProvider>,
  )

/** Fill the form and press the button. "Trust this device" gates submission. */
async function signIn(user, { email = 'root@zoikomeds.test', password = 'correct-horse' } = {}) {
  await user.type(screen.getByLabelText(/email address/i), email)
  await user.type(screen.getByLabelText(/^password/i), password)
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /continue securely/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  loginMock.mockResolvedValue({ role: 'SUPER_ADMIN' })
})

afterEach(cleanup)

describe('an account with no second factor', () => {
  it('signs in on the first attempt, and is never asked for a code', async () => {
    // Most accounts. Asking every one of them for a code would be asking for
    // something they do not have.
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()
    expect(loginMock).toHaveBeenCalledWith('root@zoikomeds.test', 'correct-horse', undefined)
  })

  it('still reports a wrong password as a wrong password', async () => {
    loginMock.mockRejectedValue(refusal('Invalid credentials'))
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    expect(await screen.findByText(/invalid credentials/i)).toBeDefined()
    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()
  })
})

describe('an account that has enrolled', () => {
  it('asks for the code once the server says one is needed', async () => {
    // The client cannot know in advance, so the first attempt goes without and
    // the refusal is what turns the field on.
    loginMock.mockRejectedValueOnce(
      refusal('Enter the code from your authenticator app.', { mfaRequired: true }),
    )
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    expect(await screen.findByLabelText(/authentication code/i)).toBeDefined()
  })

  it('sends the same credentials again with the code', async () => {
    loginMock.mockRejectedValueOnce(
      refusal('Enter the code from your authenticator app.', { mfaRequired: true }),
    )
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)
    await user.type(await screen.findByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify code/i }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenLastCalledWith(
        'root@zoikomeds.test',
        'correct-horse',
        '123456',
      ),
    )
    expect(navigateMock).toHaveBeenCalled()
  })

  it('clears a code the server rejected, and keeps asking', async () => {
    loginMock
      .mockRejectedValueOnce(
        refusal('Enter the code from your authenticator app.', { mfaRequired: true }),
      )
      .mockRejectedValueOnce(
        refusal('That code is not right. Try the current one.', { mfaRequired: true }),
      )
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)
    const code = await screen.findByLabelText(/authentication code/i)
    await user.type(code, '000000')
    await user.click(screen.getByRole('button', { name: /verify code/i }))

    expect(await screen.findByText(/not right/i)).toBeDefined()
    // Cleared, because the next attempt needs a different code — the previous
    // one is wrong and, thirty seconds on, may also be stale.
    await waitFor(() => expect(screen.getByLabelText(/authentication code/i).value).toBe(''))
  })

  it('does not carry a code into a sign-in for somebody else', async () => {
    // Editing the address starts a different sign-in. Carrying the last
    // account's code into it would send a code that cannot be right.
    loginMock.mockRejectedValueOnce(
      refusal('Enter the code from your authenticator app.', { mfaRequired: true }),
    )
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)
    await user.type(await screen.findByLabelText(/authentication code/i), '123456')
    await user.type(screen.getByLabelText(/email address/i), '.uk')

    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: /continue securely/i }))
    await waitFor(() =>
      expect(loginMock).toHaveBeenLastCalledWith(
        'root@zoikomeds.test.uk',
        'correct-horse',
        undefined,
      ),
    )
  })
})

describe('an account the workspace policy has outrun', () => {
  it('explains that enrolment is needed rather than offering a code field', async () => {
    // requireMfa is on and this account never enrolled. There is nothing to
    // type: another attempt cannot succeed, and a code field would invite one.
    loginMock.mockRejectedValue(
      refusal(
        'This workspace requires two-factor authentication. Ask an administrator to help you set it up.',
        { mfaEnrolmentRequired: true },
      ),
    )
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    expect(await screen.findByText(/has not set it up yet/i)).toBeDefined()
    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()
  })
})
