// @vitest-environment jsdom
//
// MSA-40 / MSA-41 / MSA-42 — three tabs of the super admin settings page were
// fixtures with dead controls:
//
//   Organization  every deployment showed "Meridian Health Network",
//                 "org-meridian", "North America (us-east)", over a Save button
//                 with no handler.
//   Members       the table came from ops-data, so the same invented colleagues
//                 appeared everywhere, and Invite member did nothing.
//   Security      three switches bound to useState and nothing else, two of them
//                 on by default, describing controls this platform does not have.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const getOrganizationMock = vi.fn()
const updateOrganizationMock = vi.fn()
const getSecurityPostureMock = vi.fn()
const updateSecurityPolicyMock = vi.fn()
const listUsersMock = vi.fn()
const listIntegrationsMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getOrganization: () => getOrganizationMock(),
  updateOrganization: (body) => updateOrganizationMock(body),
  getSecurityPosture: () => getSecurityPostureMock(),
  updateSecurityPolicy: (body) => updateSecurityPolicyMock(body),
  listUsers: (params) => listUsersMock(params),
  listIntegrations: () => listIntegrationsMock(),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ user: { name: 'Root', email: 'root@zoikomeds.test', role: 'SUPER_ADMIN' } }),
}))

const { default: Settings } = await import('../Settings')

const ORG = {
  name: 'Zoiko Group',
  slug: 'zoikomeds',
  dataResidency: 'India (ap-south-1)',
  organizationType: 'Pharmacy network',
  updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  updatedByEmail: 'root@zoikomeds.test',
}

const MEMBERS = [
  {
    id: 'u1',
    fullName: 'Asha Rao',
    email: 'asha@zoikomeds.test',
    role: 'SUPER_ADMIN',
    isActive: true,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: 'u2',
    fullName: null,
    email: 'nameless@zoikomeds.test',
    role: 'PHARMACY_STAFF',
    isActive: false,
    createdAt: new Date(Date.now() - 172800_000).toISOString(),
  },
]

const CONTROLS = [
  {
    id: 'password-policy',
    label: 'Password minimum length',
    detail: 'Every sign-in requires at least 8 characters.',
    state: 'enforced',
    configuredBy: 'Validation on the auth DTOs',
  },
  {
    id: 'mfa',
    label: 'Require two-factor authentication',
    detail: 'Members may enrol an authenticator app, but sign-in does not require one.',
    state: 'available',
    configuredBy: 'This page',
    setting: 'requireMfa',
    enabled: false,
  },
  {
    id: 'ip-allowlist',
    label: 'IP allowlist',
    detail: 'The API accepts requests from any address that reaches it.',
    state: 'available',
    configuredBy: 'This page',
    setting: 'ipAllowlistEnabled',
    enabled: false,
  },
  {
    id: 'saml',
    label: 'SAML 2.0',
    detail:
      'Not implemented. Single sign-on here is OAuth against Google.',
    state: 'not-implemented',
    configuredBy: 'Not available in this release',
  },
]

const POLICY = {
  requireMfa: false,
  ipAllowlistEnabled: false,
  ipAllowlist: [],
  allowOauthSignIn: true,
}

function renderTab(tab) {
  return render(
    <MemoryRouter initialEntries={[`/admin/settings?tab=${tab}`]}>
      <Settings />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getOrganizationMock.mockResolvedValue(ORG)
  updateOrganizationMock.mockResolvedValue({ ...ORG, name: 'Zoiko Health' })
  getSecurityPostureMock.mockResolvedValue(CONTROLS)
  updateSecurityPolicyMock.mockResolvedValue({ controls: CONTROLS, policy: POLICY })
  listUsersMock.mockResolvedValue({ items: MEMBERS, total: MEMBERS.length })
  listIntegrationsMock.mockResolvedValue([])
})

afterEach(cleanup)

describe('MSA-40 · organization profile', () => {
  it('shows the workspace the API reports, not a fixture', async () => {
    renderTab('organization')

    expect(await screen.findByDisplayValue('Zoiko Group')).toBeDefined()
    expect(screen.getByDisplayValue('India (ap-south-1)')).toBeDefined()
    expect(screen.queryByDisplayValue('Meridian Health Network')).toBeNull()
    expect(screen.queryByDisplayValue('North America (us-east)')).toBeNull()
  })

  it('saves the change, which is the whole of the bug', async () => {
    const user = userEvent.setup()
    renderTab('organization')

    const name = await screen.findByLabelText(/workspace name/i)
    await user.clear(name)
    await user.type(name, 'Zoiko Health')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(updateOrganizationMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Zoiko Health' }),
      ),
    )
    expect(await screen.findByText(/workspace profile saved/i)).toBeDefined()
  })

  it('keeps Save inert until something has actually changed', async () => {
    renderTab('organization')

    // Enabled from the start, it says a press will do something when it will not.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i }).disabled).toBe(true),
    )
  })

  it('restores the loaded values on cancel', async () => {
    const user = userEvent.setup()
    renderTab('organization')

    const name = await screen.findByLabelText(/workspace name/i)
    await user.clear(name)
    await user.type(name, 'Something else')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.getByLabelText(/workspace name/i).value).toBe('Zoiko Group'))
    expect(updateOrganizationMock).not.toHaveBeenCalled()
  })

  it('does not let the workspace handle be edited', async () => {
    renderTab('organization')

    const slug = await screen.findByLabelText(/workspace id/i)
    // Renaming the organization must not change what it is.
    expect(slug.readOnly || slug.disabled).toBe(true)
  })

  it('reports a refused save instead of looking like it worked', async () => {
    updateOrganizationMock.mockRejectedValue(new Error('Workspace name cannot be empty.'))
    const user = userEvent.setup()
    renderTab('organization')

    const name = await screen.findByLabelText(/workspace name/i)
    await user.type(name, ' Ltd')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/cannot be empty/i)).toBeDefined()
  })
})

describe('MSA-41 · members', () => {
  it('lists the real accounts rather than invented colleagues', async () => {
    renderTab('members')

    expect(await screen.findByText('Asha Rao')).toBeDefined()
    expect(listUsersMock).toHaveBeenCalled()
  })

  it('falls back to the email for an account with no name', async () => {
    renderTab('members')

    // The fixture always had a name, so a blank cell was never possible before.
    await waitFor(() =>
      expect(screen.getAllByText('nameless@zoikomeds.test').length).toBeGreaterThan(0),
    )
  })

  it('shows a deactivated account as deactivated', async () => {
    renderTab('members')

    expect(await screen.findByText('Deactivated')).toBeDefined()
    expect(screen.getByText('Active')).toBeDefined()
  })

  it('sends Invite member to the page that actually creates accounts', async () => {
    renderTab('members')

    const invite = await screen.findByRole('link', { name: /invite member/i })
    expect(invite.getAttribute('href')).toBe('/admin/users')
  })

  it('reports a failure to load rather than an empty roster', async () => {
    listUsersMock.mockRejectedValue(new Error('Forbidden'))
    renderTab('members')

    expect(await screen.findByRole('alert')).toBeDefined()
  })
})

describe('MSA-42 · security', () => {
  it('offers a switch only for the controls this page can decide', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText('SAML 2.0')).toBeDefined())
    // 2FA is not managed from this console — only the IP allowlist is settable
    // here; password policy and SAML are not.
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('does not render the 2FA control at all', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText('SAML 2.0')).toBeDefined())
    expect(screen.queryByText(/require two-factor/i)).toBeNull()
  })

  it('saves the approved networks as separate entries', async () => {
    const user = userEvent.setup()
    renderTab('security')

    const box = await screen.findByLabelText(/approved networks/i)
    await user.type(box, '203.0.113.0/24\n10.0.0.0/8')
    await user.click(screen.getByRole('button', { name: /save networks/i }))

    await waitFor(() =>
      expect(updateSecurityPolicyMock).toHaveBeenCalledWith({
        ipAllowlist: ['203.0.113.0/24', '10.0.0.0/8'],
      }),
    )
  })

  it('reports a refused policy rather than leaving the switch showing it', async () => {
    updateSecurityPolicyMock.mockRejectedValue(
      new Error('Add at least one address or range before switching the allowlist on.'),
    )
    const user = userEvent.setup()
    renderTab('security')

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /ip allowlist/i })).toBeDefined(),
    )
    await user.click(screen.getByRole('switch', { name: /ip allowlist/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/add at least one address/i)).toBeDefined()
  })

  it('says an unimplemented control is unavailable, not switched off', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText('SAML 2.0')).toBeDefined())
    // "Off" would invite someone to turn it on.
    expect(screen.getByText('Not available')).toBeDefined()
    expect(screen.queryByRole('switch', { name: /SAML/i })).toBeNull()
  })

  it('names where each control is actually decided', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText(/Password minimum length/i)).toBeDefined())
    expect(screen.getByText(/Validation on the auth DTOs/)).toBeDefined()
  })
})
