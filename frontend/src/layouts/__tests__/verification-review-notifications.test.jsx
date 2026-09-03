// @vitest-environment jsdom
//
// The Super Admin bell telling an administrator a pharmacy is waiting.
//
// The bell read one endpoint — GET /admin/notifications, the broadcast outbox
// an admin composes into. A pharmacy could upload its licence, submit for
// verification, and sit in the Verification Center queue with nobody told:
// there was no producer for a verification submission anywhere, and nothing in
// the bell that would have shown one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'

const broadcastsMock = vi.fn()
const inboxMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listNotifications: () => broadcastsMock(),
  listAdminInbox: () => inboxMock(),
  globalSearch: vi.fn(async () => ({ results: [] })),
}))

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: () => {} }),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: { fullName: 'Sam Reviewer', email: 's@zoiko.test', role: 'SUPER_ADMIN' }, logout: vi.fn() }),
}))

const { Topbar } = await import('../topbar')

const REVIEW = {
  id: 'verification-req_1',
  kind: 'verification',
  requestId: 'req_1',
  title: 'testerpharma — verification review needed',
  message: 'testerpharma submitted verification documents for review.',
  severity: 'serious',
  status: 'PENDING',
  documentAttached: true,
  date: new Date().toISOString(),
}

const BROADCAST = {
  id: 'bc_1',
  title: 'Scheduled maintenance',
  message: 'The platform is unavailable on Sunday.',
  type: 'MAINTENANCE',
  target: 'ALL_USERS',
  date: new Date(Date.now() - 86_400_000).toISOString(),
}

const renderTopbar = () =>
  render(
    // main.jsx wraps the app in TooltipProvider; the topbar's icon-only
    // controls name themselves through tooltips, so the test needs it too.
    <MemoryRouter>
      <TooltipProvider>
        <Topbar onOpenCommand={() => {}} onOpenMobileNav={() => {}} onToggleRightSidebar={() => {}} rightSidebarOpen />
      </TooltipProvider>
    </MemoryRouter>,
  )

/** Open the bell and return the popover contents. */
const openBell = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  renderTopbar()
  await waitFor(() => expect(inboxMock).toHaveBeenCalled())
  await user.click(screen.getByRole('button', { name: /notifications/i }))
  return user
}

beforeEach(() => {
  broadcastsMock.mockResolvedValue([])
  inboxMock.mockResolvedValue([])
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a verification submission reaches the bell', () => {
  it('asks the inbox endpoint at all', async () => {
    renderTopbar()
    await waitFor(() => expect(inboxMock).toHaveBeenCalled())
  })

  it('shows the submission message', async () => {
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    expect(
      await screen.findByText('testerpharma submitted verification documents for review.'),
    ).toBeDefined()
  })

  it('counts as unread on the badge', async () => {
    inboxMock.mockResolvedValue([REVIEW])
    renderTopbar()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1 unread/i })).toBeDefined(),
    )
  })

  it('links to the request it is about', async () => {
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    const row = await screen.findByRole('link', {
      name: /verification review needed/i,
    })
    expect(row.getAttribute('href')).toBe('/admin/verification?request=req_1')
  })

  it('shows a resubmission with its own wording', async () => {
    inboxMock.mockResolvedValue([
      { ...REVIEW, message: 'testerpharma updated and resubmitted its verification request.' },
    ])
    await openBell()

    expect(
      await screen.findByText('testerpharma updated and resubmitted its verification request.'),
    ).toBeDefined()
  })

  it('labels the channel so it is not mistaken for a broadcast', async () => {
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    expect(await screen.findByText(/Verification Center/)).toBeDefined()
  })
})

describe('it does not displace the broadcasts', () => {
  it('shows both sources together', async () => {
    broadcastsMock.mockResolvedValue([BROADCAST])
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    expect(await screen.findByText('Scheduled maintenance')).toBeDefined()
    expect(screen.getByText('testerpharma — verification review needed')).toBeDefined()
  })

  it('puts the newer one first', async () => {
    broadcastsMock.mockResolvedValue([BROADCAST])
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    const titles = screen
      .getAllByText(/verification review needed|Scheduled maintenance/)
      .map((el) => el.textContent)
    expect(titles[0]).toContain('verification review needed')
  })

  it('keeps the broadcasts when the inbox call fails', async () => {
    broadcastsMock.mockResolvedValue([BROADCAST])
    inboxMock.mockRejectedValue(new Error('403'))
    await openBell()

    expect(await screen.findByText('Scheduled maintenance')).toBeDefined()
  })

  it('keeps the reviews when the broadcast call fails', async () => {
    broadcastsMock.mockRejectedValue(new Error('500'))
    inboxMock.mockResolvedValue([REVIEW])
    await openBell()

    expect(await screen.findByText('testerpharma — verification review needed')).toBeDefined()
  })
})

describe('an empty queue says nothing', () => {
  it('shows no badge', async () => {
    renderTopbar()

    await waitFor(() => expect(inboxMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /unread/i })).toBeNull()
  })

  it('shows the empty state rather than an invented row', async () => {
    await openBell()

    expect(await screen.findByText(/No announcements yet/i)).toBeDefined()
  })
})
