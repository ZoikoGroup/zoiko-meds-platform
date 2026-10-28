// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/providers/theme-provider'

/**
 * Arriving at sign-in from a completed password reset.
 *
 * On the web from the reset page, or in the app from the reset email's way
 * back. Either way the person should be told why they are here and what to do:
 * sign in with the password they just chose. Before, they were dropped on a
 * blank sign-in form with no sign the reset had worked.
 */

vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ login: vi.fn() }) }))
vi.mock('@/lib/api-client', () => ({
  consumeSessionExpired: () => false,
  apiBaseUrl: () => 'http://localhost:3000',
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const { default: Login } = await import('../Login')

const renderAt = (path) =>
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Login />
      </MemoryRouter>
    </ThemeProvider>,
  )

afterEach(cleanup)

describe('sign-in after a password reset', () => {
  it('says the password was updated and to sign in with the new one', () => {
    renderAt('/login?reset=success')
    expect(screen.getByRole('status').textContent).toMatch(
      /password updated\. sign in with your new password\./i,
    )
  })

  it('says nothing of the kind on an ordinary visit', () => {
    renderAt('/login')
    expect(screen.queryByText(/password updated/i)).toBeNull()
  })

  it('does not take a look-alike flag for a reset', () => {
    renderAt('/login?reset=1')
    expect(screen.queryByText(/password updated/i)).toBeNull()
  })

  it('leaves the sign-in form itself as it was', () => {
    renderAt('/login?reset=success')
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /sign in|log in/i })).toBeDefined()
  })
})
