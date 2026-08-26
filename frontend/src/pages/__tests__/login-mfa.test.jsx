// @vitest-environment jsdom
//
// MSA-42 — with a second factor now enforced at sign-in, the login form has to
// be able to ask for one. It cannot know in advance whether an account is
// enrolled, so the first attempt goes without a code and the API answers with
// mfaRequired; the same call is then repeated with the code.
//
// This only works because apiFetch keeps the response envelope on the error: a
// sign-in refused for want of a factor is not a wrong password, and reporting it
// as one would send someone to reset a password that was correct.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const loginMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ login: loginMock, user: null }),
}))

// The page carries a theme toggle in its showcase panel.
vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))

const { default: Login } = await import('../Login')

function mfaError(message = 'Enter the code from your authenticator app.') {
  const err = new Error(message)
  err.status = 401
  err.body = { mfaRequired: true, message }
  return err
}

/**
 * The form's own submit control. Selected by type rather than by name, because
 * the page also carries "Continue with Google" and "Continue with Microsoft".
 */
const submitButton = () => document.querySelector('button[type="submit"]')

async function signIn(user) {
  await user.type(screen.getByLabelText(/email/i), 'root@zoikomeds.test')
  await user.type(screen.getByLabelText(/^password/i), 'correct-horse')
  // The form gates submission on a "trust this device" acknowledgement.
  const trust = screen.queryByRole('checkbox')
  if (trust) await user.click(trust)
  await user.click(submitButton())
}

beforeEach(() => {
  vi.clearAllMocks()
  loginMock.mockResolvedValue({ role: 'SUPER_ADMIN' })
})

afterEach(cleanup)

describe('MSA-42 · sign-in with a second factor', () => {
  const renderLogin = () =>
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>,
    )

  it('does not ask for a code before the API says one is needed', async () => {
    renderLogin()
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull()
  })

  it('asks for a code once the API says the account has one', async () => {
    loginMock.mockRejectedValueOnce(mfaError())
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    expect(await screen.findByLabelText(/authenticator code/i)).toBeDefined()
    // And says why, rather than reading as a rejected password. Matched on the
    // banner's own wording: the field's helper text also mentions the app.
    expect(screen.getByText(/Enter the code from your authenticator app/i)).toBeDefined()
  })

  it('sends the code on the second attempt and signs in', async () => {
    loginMock.mockRejectedValueOnce(mfaError())
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)
    await user.type(await screen.findByLabelText(/authenticator code/i), '123456')
    await user.click(submitButton())

    await waitFor(() =>
      expect(loginMock).toHaveBeenLastCalledWith(
        'root@zoikomeds.test',
        'correct-horse',
        '123456',
      ),
    )
  })

  it('clears a rejected code but keeps the password', async () => {
    loginMock.mockRejectedValueOnce(mfaError())
    loginMock.mockRejectedValueOnce(mfaError('That code is not right. Try the current one.'))
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)
    await user.type(await screen.findByLabelText(/authenticator code/i), '000000')
    await user.click(submitButton())

    await waitFor(() => expect(screen.getByLabelText(/authenticator code/i).value).toBe(''))
    // Retyping a password to correct a 6-digit typo is punishment.
    expect(screen.getByLabelText(/^password/i).value).toBe('correct-horse')
  })

  // A workspace policy failure is a different thing again: there is no code to
  // enter, so a code box would be a dead end.
  it('does not offer a code box when the account has not enrolled at all', async () => {
    const err = new Error('This workspace requires two-factor authentication.')
    err.status = 401
    err.body = { mfaEnrolmentRequired: true, message: err.message }
    loginMock.mockRejectedValueOnce(err)
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    await waitFor(() =>
      expect(screen.getByText(/workspace requires two-factor/i)).toBeDefined(),
    )
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull()
  })

  it('still reports a wrong password as a wrong password', async () => {
    const err = new Error('Invalid email or password')
    err.status = 401
    err.body = { message: err.message }
    loginMock.mockRejectedValueOnce(err)
    const user = userEvent.setup()
    renderLogin()

    await signIn(user)

    await waitFor(() => expect(screen.getByText(/invalid email or password/i)).toBeDefined())
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull()
  })
})
