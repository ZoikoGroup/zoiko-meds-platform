// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ThemeProvider } from '@/providers/theme-provider'

/**
 * After a successful reset, where does the person go?
 *
 * The reported bug: a reset asked for in the app often finishes in the phone's
 * browser (mail clients drop custom-scheme links), and success sent everyone to
 * this site's sign-in two seconds later — signed out, in the browser, with the
 * app they started in never reopened.
 *
 * Now there are three answers, and these tests hold each one:
 *   - inside the app: the app's own sign-in, with a note;
 *   - in a phone browser, for a reset the app asked for: a button back to the
 *     app, and the page stays put until it is used;
 *   - anywhere else (a computer, or a reset begun on the web): this site's
 *     sign-in, with a note, as before.
 * And in none of them does anything happen before the server says the reset
 * succeeded.
 */

const resetMock = vi.hoisted(() => vi.fn())
const logoutMock = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ IS_NATIVE: false }))

vi.mock('@/services/auth-api', () => ({
  resetPasswordRequest: (...args) => resetMock(...args),
}))
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ logout: logoutMock }),
}))
vi.mock('@/lib/platform', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    WEB_ORIGIN: 'https://app.zoikomeds.com',
    get IS_NATIVE() {
      return platform.IS_NATIVE
    },
  }
})

const { default: ResetPassword } = await import('../ResetPassword')

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Mobile Safari/537.36'
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'

/** Where the router is, so a navigation is visible to the test. */
function SignIn() {
  const { search } = useLocation()
  return <p>sign-in page{search}</p>
}

function renderAt(path, userAgent) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<SignIn />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

// Anchored: the fields' eye buttons are labelled "Show new password" etc.
async function submitNewPassword(user, password = 'NewPass#2026') {
  await user.type(screen.getByLabelText(/^new password/i), password)
  await user.type(screen.getByLabelText(/^confirm password/i), password)
  await user.click(screen.getByRole('button', { name: /set password/i }))
}

/** Step past the success page's two-second pause. */
const afterThePause = () => act(() => vi.advanceTimersByTimeAsync(2500))

let user
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  resetMock.mockReset()
  logoutMock.mockReset()
  platform.IS_NATIVE = false
  resetMock.mockResolvedValue({ message: 'Password updated.' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a reset the app asked for, finished in the phone’s browser', () => {
  it('offers the way back to the app, at sign-in, with nothing secret in it', async () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)

    const open = await screen.findByRole('link', { name: /open the zoikomeds app/i })
    const href = open.getAttribute('href')
    expect(href.startsWith('intent://auth/login?reset=success#Intent;')).toBe(true)
    expect(href).toContain('package=com.zoikomeds.app')
    // Neither the reset token nor the new password goes anywhere near the app.
    expect(href).not.toContain('tok-123')
    expect(href).not.toContain('NewPass')
  })

  it('stays on the confirmation instead of dropping the person on this site’s sign-in', async () => {
    // This is the bug: two seconds later they were in the browser, signed out.
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)
    await screen.findByText('Password updated')

    await afterThePause()

    expect(screen.queryByText(/sign-in page/)).toBeNull()
    expect(screen.getByText('Password updated')).toBeDefined()
  })

  it('still offers this site’s sign-in, for when the app cannot be opened', async () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)

    await user.click(await screen.findByRole('link', { name: /sign in on the web instead/i }))

    expect(await screen.findByText('sign-in page?reset=success')).toBeDefined()
  })
})

describe('everywhere else, sign-in is next — with a note', () => {
  it('a computer opening an email the app asked for: this site’s sign-in, no dead app button', async () => {
    renderAt('/reset-password?token=tok-123&client=app', DESKTOP)
    await submitNewPassword(user)
    await screen.findByText('Password updated')

    expect(screen.queryByRole('link', { name: /open the zoikomeds app/i })).toBeNull()
    await afterThePause()
    expect(await screen.findByText('sign-in page?reset=success')).toBeDefined()
  })

  it('a reset begun on the web: this site’s sign-in, as before', async () => {
    renderAt('/reset-password?token=tok-123', ANDROID)
    await submitNewPassword(user)
    await screen.findByText('Password updated')

    expect(screen.queryByRole('link', { name: /open the zoikomeds app/i })).toBeNull()
    await afterThePause()
    expect(await screen.findByText('sign-in page?reset=success')).toBeDefined()
  })

  it('inside the app: the app’s own sign-in, without detouring through a link', async () => {
    platform.IS_NATIVE = true
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)
    await screen.findByText('Password updated')

    expect(screen.queryByRole('link', { name: /open the zoikomeds app/i })).toBeNull()
    await afterThePause()
    expect(await screen.findByText('sign-in page?reset=success')).toBeDefined()
  })

  it('drops any session this browser held, since its password is gone', async () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)
    await screen.findByText('Password updated')
    expect(logoutMock).toHaveBeenCalledTimes(1)
  })
})

describe('nothing happens before the server says the reset succeeded', () => {
  it('offers no way back before the form is sent', () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    expect(screen.queryByRole('link', { name: /open the zoikomeds app/i })).toBeNull()
  })

  it('an expired or invalid link changes nothing and goes nowhere', async () => {
    resetMock.mockRejectedValue(new Error('This link is invalid or has expired. Please request a new one.'))
    renderAt('/reset-password?token=stale&client=app', ANDROID)
    await submitNewPassword(user)

    expect(await screen.findByText(/invalid or has expired/i)).toBeDefined()
    expect(screen.queryByRole('link', { name: /open the zoikomeds app/i })).toBeNull()
    expect(screen.queryByText('Password updated')).toBeNull()
    await afterThePause()
    expect(screen.queryByText(/sign-in page/)).toBeNull()
    expect(logoutMock).not.toHaveBeenCalled()
  })

  it('keeps the existing checks: mismatched passwords never reach the server', async () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await user.type(screen.getByLabelText(/^new password/i), 'NewPass#2026')
    await user.type(screen.getByLabelText(/^confirm password/i), 'Different#2026')
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeDefined()
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('sends the token from the link, and only the new password, to the server', async () => {
    renderAt('/reset-password?token=tok-123&client=app', ANDROID)
    await submitNewPassword(user)
    await waitFor(() => expect(resetMock).toHaveBeenCalledWith('tok-123', 'NewPass#2026'))
  })
})
