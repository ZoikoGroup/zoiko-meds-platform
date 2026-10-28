// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/providers/theme-provider'

/**
 * Show / hide on the reset form's two password fields.
 *
 * The reported bug: Confirm password had no eye button, so what was typed
 * there could not be checked. It also had no visibility of its own — it
 * followed New password's toggle, so revealing one revealed both. Now each
 * field has its own button, and neither touches the other.
 */

const resetMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/auth-api', () => ({
  resetPasswordRequest: (...args) => resetMock(...args),
}))
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const { default: ResetPassword } = await import('../ResetPassword')

const renderForm = () =>
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/reset-password?token=tok-123']}>
        <ResetPassword />
      </MemoryRouter>
    </ThemeProvider>,
  )

// Anchored, so the field is found and not its own eye button.
const newPassword = () => screen.getByLabelText(/^new password/i)
const confirmPassword = () => screen.getByLabelText(/^confirm password/i)

let user
beforeEach(() => {
  user = userEvent.setup()
  resetMock.mockReset()
  resetMock.mockResolvedValue({ message: 'Password updated.' })
})
afterEach(cleanup)

describe('Confirm password has its own show / hide button', () => {
  it('is there, masked to begin with', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Show confirm password' })).toBeDefined()
    expect(confirmPassword().getAttribute('type')).toBe('password')
  })

  it('reveals what was typed, then masks it again, keeping the value', async () => {
    renderForm()
    await user.type(confirmPassword(), 'NewPass#2026')

    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    expect(confirmPassword().getAttribute('type')).toBe('text')
    expect(confirmPassword().value).toBe('NewPass#2026')

    await user.click(screen.getByRole('button', { name: 'Hide confirm password' }))
    expect(confirmPassword().getAttribute('type')).toBe('password')
    expect(confirmPassword().value).toBe('NewPass#2026')
  })

  it('works from the keyboard: Tab reaches it, Enter and Space toggle it', async () => {
    renderForm()
    await user.click(confirmPassword())
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Show confirm password' }),
    )

    await user.keyboard('{Enter}')
    expect(confirmPassword().getAttribute('type')).toBe('text')
    await user.keyboard(' ')
    expect(confirmPassword().getAttribute('type')).toBe('password')
  })

  it('does not send the form', async () => {
    renderForm()
    await user.type(newPassword(), 'NewPass#2026')
    await user.type(confirmPassword(), 'NewPass#2026')
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    expect(resetMock).not.toHaveBeenCalled()
  })
})

describe('the two fields are toggled independently', () => {
  it('revealing Confirm password leaves New password masked', async () => {
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    expect(confirmPassword().getAttribute('type')).toBe('text')
    expect(newPassword().getAttribute('type')).toBe('password')
    expect(screen.getByRole('button', { name: 'Show new password' })).toBeDefined()
  })

  it('revealing New password leaves Confirm password masked', async () => {
    // Before, this revealed both: Confirm followed New password's toggle.
    renderForm()
    await user.type(newPassword(), 'NewPass#2026')
    await user.click(screen.getByRole('button', { name: 'Show new password' }))
    expect(newPassword().getAttribute('type')).toBe('text')
    expect(newPassword().value).toBe('NewPass#2026')
    expect(confirmPassword().getAttribute('type')).toBe('password')
    expect(screen.getByRole('button', { name: 'Show confirm password' })).toBeDefined()
  })

  it('each can be shown and hidden while the other stays as it is', async () => {
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Show new password' }))
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    expect(newPassword().getAttribute('type')).toBe('text')
    expect(confirmPassword().getAttribute('type')).toBe('text')

    await user.click(screen.getByRole('button', { name: 'Hide new password' }))
    expect(newPassword().getAttribute('type')).toBe('password')
    expect(confirmPassword().getAttribute('type')).toBe('text')
  })
})

describe('the form itself is unchanged', () => {
  it('still rejects mismatched passwords, revealed or not', async () => {
    renderForm()
    await user.type(newPassword(), 'NewPass#2026')
    await user.type(confirmPassword(), 'Different#2026')
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeDefined()
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('still rejects a password under 8 characters', async () => {
    renderForm()
    await user.type(newPassword(), 'short')
    await user.type(confirmPassword(), 'short')
    await user.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeDefined()
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('still resets with the token and the new password, with Confirm revealed', async () => {
    renderForm()
    await user.type(newPassword(), 'NewPass#2026')
    await user.type(confirmPassword(), 'NewPass#2026')
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    await user.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(resetMock).toHaveBeenCalledWith('tok-123', 'NewPass#2026'))
    expect(await screen.findByText('Password updated')).toBeDefined()
  })
})
