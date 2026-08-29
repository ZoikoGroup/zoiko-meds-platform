// @vitest-environment jsdom
//
// The last three fixture tabs on the super admin settings page. Each rendered
// invented data to every deployment: five roles this platform does not have,
// somebody else's audit trail, and three API keys with Reveal / Rotate / Revoke
// behind them that had no handlers and no endpoint to have handlers for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const getRoleMatrixMock = vi.fn()
const listAuditLogsMock = vi.fn()
const listApiKeysMock = vi.fn()
const createApiKeyMock = vi.fn()
const revokeApiKeyMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getOrganization: vi.fn().mockResolvedValue({}),
  updateOrganization: vi.fn(),
  getSecurityPosture: vi.fn().mockResolvedValue([]),
  updateSecurityPolicy: vi.fn(),
  listUsers: vi.fn().mockResolvedValue([]),
  listIntegrations: vi.fn().mockResolvedValue([]),
  getRoleMatrix: () => getRoleMatrixMock(),
  listAuditLogs: (params) => listAuditLogsMock(params),
  listApiKeys: () => listApiKeysMock(),
  createApiKey: (body) => createApiKeyMock(body),
  revokeApiKey: (id) => revokeApiKeyMock(id),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: { name: 'Root', email: 'root@zoikomeds.test', role: 'SUPER_ADMIN' } }),
}))

const { default: Settings } = await import('../Settings')

const MATRIX = {
  roles: [
    { id: 'PUBLIC', label: 'Patient' },
    { id: 'PHARMACY_STAFF', label: 'Pharmacist' },
    { id: 'SUPER_ADMIN', label: 'Super Admin' },
  ],
  capabilities: [
    {
      id: 'admin',
      label: 'Platform administration',
      roles: ['SUPER_ADMIN'],
      routes: 24,
      hasPublicRoutes: false,
    },
    {
      id: 'medibase',
      label: 'MediBase catalogue',
      roles: ['PUBLIC', 'PHARMACY_STAFF', 'SUPER_ADMIN'],
      routes: 4,
      hasPublicRoutes: true,
    },
  ],
}

const AUDIT = {
  items: [
    {
      id: 'a1',
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      action: 'auth.login',
      actor: 'root@zoikomeds.test',
      module: 'Authentication',
      severity: 'info',
      ip: '10.0.0.1',
      summary: 'Root signed in',
    },
  ],
  total: 1,
}

const KEYS = [
  {
    id: 'k1',
    label: 'Partner feed',
    scope: 'availability',
    prefix: 'zav_1a2b3c',
    createdAt: new Date().toISOString(),
    createdBy: 'Root',
    lastUsedAt: null,
    revokedAt: null,
    status: 'active',
  },
  {
    id: 'k2',
    label: 'Old integration',
    scope: 'medibase',
    prefix: 'zav_9z8y7x',
    createdAt: new Date().toISOString(),
    createdBy: 'Root',
    lastUsedAt: new Date().toISOString(),
    revokedAt: new Date().toISOString(),
    status: 'revoked',
  },
]

function renderTab(tab) {
  return render(
    <MemoryRouter initialEntries={[`/admin/settings?tab=${tab}`]}>
      <Settings />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getRoleMatrixMock.mockResolvedValue(MATRIX)
  listAuditLogsMock.mockResolvedValue(AUDIT)
  listApiKeysMock.mockResolvedValue(KEYS)
})

afterEach(cleanup)

describe('roles & permissions', () => {
  it('names the roles this platform actually has', async () => {
    renderTab('roles')

    await waitFor(() => expect(screen.getByText('Pharmacist')).toBeDefined())
    // The fixture's columns were Owner / Admin / Analyst / Viewer / Auditor,
    // none of which exist in the UserRole enum.
    expect(screen.queryByText('Analyst')).toBeNull()
    expect(screen.queryByText('Viewer')).toBeNull()
  })

  it('marks a capability allowed only for the roles the API reports', async () => {
    renderTab('roles')

    const row = (await screen.findByText('Platform administration')).closest('tr')
    // Three role columns, one tick: SUPER_ADMIN.
    expect(within(row).getAllByLabelText('allowed')).toHaveLength(1)
    expect(within(row).getAllByLabelText('not allowed')).toHaveLength(2)
  })

  // "Every role can reach this" and "this needs no account" look identical in a
  // row of ticks.
  it('says when a capability needs no account at all', async () => {
    renderTab('roles')

    const row = (await screen.findByText('MediBase catalogue')).closest('tr')
    expect(within(row).getByText(/some need no account/i)).toBeDefined()
  })

  it('reports a failure rather than an empty matrix', async () => {
    getRoleMatrixMock.mockRejectedValue(new Error('Forbidden'))
    renderTab('roles')

    expect(await screen.findByRole('alert')).toBeDefined()
  })
})

describe('audit log', () => {
  it('renders the rows the API returns, unwrapping the page envelope', async () => {
    renderTab('audit')

    expect(await screen.findByText('root@zoikomeds.test')).toBeDefined()
    expect(screen.getByText('Root signed in')).toBeDefined()
  })

  // The fixture's columns were actor/action/resource/scope/timestamp; the API
  // returns module and summary and no resource or scope, so reusing them
  // rendered two permanently blank columns.
  it('uses columns the API actually fills', async () => {
    renderTab('audit')

    await waitFor(() => expect(screen.getByText('Authentication')).toBeDefined())
    expect(screen.queryByRole('columnheader', { name: /resource/i })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /scope/i })).toBeNull()
  })

  it('links to the full log rather than reimplementing it', async () => {
    renderTab('audit')

    const link = await screen.findByRole('link', { name: /open the full log/i })
    expect(link.getAttribute('href')).toBe('/admin/audit-logs')
  })

  it('says the trail is empty rather than showing nothing', async () => {
    listAuditLogsMock.mockResolvedValue({ items: [], total: 0 })
    renderTab('audit')

    expect(await screen.findByText(/nothing recorded yet/i)).toBeDefined()
  })
})

describe('API keys', () => {
  it('lists the real keys, live and revoked', async () => {
    renderTab('api-keys')

    expect(await screen.findByText('Partner feed')).toBeDefined()
    expect(screen.getByText('Revoked')).toBeDefined()
  })

  // Only the hash is stored, so there is nothing to reveal and no way to rotate
  // in place. The fixture offered both.
  it('offers no Reveal or Rotate, because neither is possible', async () => {
    renderTab('api-keys')

    await waitFor(() => expect(screen.getByText('Partner feed')).toBeDefined())
    expect(screen.queryByText(/reveal key/i)).toBeNull()
    expect(screen.queryByText(/rotate key/i)).toBeNull()
  })

  it('issues a key and shows it once, with a working copy', async () => {
    createApiKeyMock.mockResolvedValue({
      apiKey: 'zav_0123456789abcdef',
      key: KEYS[0],
    })
    const user = userEvent.setup()
    renderTab('api-keys')

    await user.type(await screen.findByLabelText(/label/i), 'Partner feed')
    await user.click(screen.getByRole('button', { name: /create key/i }))

    await waitFor(() =>
      expect(createApiKeyMock).toHaveBeenCalledWith({
        label: 'Partner feed',
        scope: 'availability',
      }),
    )
    expect(await screen.findByText('zav_0123456789abcdef')).toBeDefined()
    // Said twice on purpose — once in the banner over the key, once in the
    // flash — so this matches the banner's own wording rather than either.
    expect(screen.getByText(/Copy this key now/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /copy key/i })).toBeDefined()
  })

  it('will not issue a key with no usable label', async () => {
    renderTab('api-keys')

    // Nothing to recognise it by later is the same as no label.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create key/i }).disabled).toBe(true),
    )
  })

  it('confirms before revoking, because it stops traffic immediately', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    renderTab('api-keys')

    await user.click(await screen.findByRole('button', { name: /^revoke$/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(revokeApiKeyMock).not.toHaveBeenCalled()
  })

  it('revokes on confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    revokeApiKeyMock.mockResolvedValue({ ...KEYS[0], status: 'revoked' })
    const user = userEvent.setup()
    renderTab('api-keys')

    await user.click(await screen.findByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(revokeApiKeyMock).toHaveBeenCalledWith('k1'))
  })

  it('distinguishes a key carrying traffic from one issued and forgotten', async () => {
    renderTab('api-keys')

    await waitFor(() => expect(screen.getByText('Partner feed')).toBeDefined())
    expect(screen.getByText('Never used')).toBeDefined()
  })

  it('says so when no key has been issued', async () => {
    listApiKeysMock.mockResolvedValue([])
    renderTab('api-keys')

    expect(await screen.findByText(/no keys issued/i)).toBeDefined()
  })
})
