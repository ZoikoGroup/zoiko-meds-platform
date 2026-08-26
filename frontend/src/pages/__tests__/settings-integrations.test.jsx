// @vitest-environment jsdom
//
// MSA-39 — the Manage buttons on the super admin's API Integrations tab all
// landed on the 404 page. The admin console is mounted under /admin, and the
// API handed back console-relative paths without it ('/commercial'), which
// matched neither the admin subtree nor the patient portal.
//
// The router already patches the sidebar's own links for this at runtime; the
// paths arriving from the API never went through that. These hold both halves:
// the button links where the API says, and the places the API can name are
// pages the console actually mounts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const listIntegrationsMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listIntegrations: () => listIntegrationsMock(),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: { name: 'Root', email: 'root@zoikomeds.test', role: 'SUPER_ADMIN' } }),
}))

const { default: Settings } = await import('../Settings')

const ROWS = [
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    status: 'operational',
    detail: 'Connected in test mode and authorised to charge.',
    configured: true,
    manage: '/admin/commercial',
  },
  {
    id: 'google',
    name: 'Google sign-in',
    category: 'Identity',
    status: 'disabled',
    detail: 'No client credentials, so the sign-in button answers 503.',
    configured: false,
    manage: null,
    configuredBy: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET',
  },
]

function renderIntegrations() {
  return render(
    <MemoryRouter initialEntries={['/admin/settings?tab=integrations']}>
      <Settings />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listIntegrationsMock.mockResolvedValue(ROWS)
})

afterEach(cleanup)

describe('MSA-39 · admin integrations', () => {
  it('sends Manage to the console page the API named', async () => {
    renderIntegrations()

    const manage = await screen.findByRole('link', { name: /manage/i })
    // getAttribute rather than .href: jsdom resolves href against the document
    // origin, which would hide a path that is merely missing its prefix.
    expect(manage.getAttribute('href')).toBe('/admin/commercial')
  })

  it('offers no Manage button for a service the console does not manage', async () => {
    renderIntegrations()

    await waitFor(() => expect(screen.getByText('Google sign-in')).toBeDefined())
    // One row is manageable, one is not — so exactly one link, not two.
    expect(screen.getAllByRole('link', { name: /manage/i })).toHaveLength(1)
    expect(screen.getByText(/not managed here/i)).toBeDefined()
    // And it says where the answer actually lives instead.
    expect(screen.getByText(/GOOGLE_CLIENT_ID/)).toBeDefined()
  })

  it('reports a failure to read the status rather than an empty page', async () => {
    listIntegrationsMock.mockRejectedValue(new Error('Forbidden'))
    renderIntegrations()

    expect(await screen.findByRole('alert')).toBeDefined()
  })
})

// The service that produces these paths cannot see the router, so the pairing is
// asserted from this side too. Both tests have to be changed together to move a
// page, which is the point.
describe('MSA-39 · the console mounts every page Manage can name', () => {
  it('resolves the paths the integrations API returns', async () => {
    const { router } = await import('@/routes')

    const admin = router.routes.find((route) => route.path === 'admin')
    expect(admin).toBeDefined()

    // Children sit under an unpathed layout route.
    const paths = admin.children
      .flatMap((child) => child.children ?? [child])
      .map((child) => child.path)
      .filter(Boolean)

    // Mirrors integrations.spec.ts, which pins the same two.
    expect(paths).toContain('commercial')
    expect(paths).toContain('notifications')
  })
})
