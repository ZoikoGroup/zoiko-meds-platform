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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  getSecurityPostureMock.mockResolvedValue({ controls: CONTROLS, policy: POLICY })
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
  // A switch is interactive only where the platform really enforces the control;
  // the rest say Coming Soon rather than sitting at "off", which invites a click.
  //
  // The IP allowlist row is gone entirely. It was the one live switch here, and
  // it worked: an operator saved a subnet mask as a range, switched it on, and
  // every request from outside that list was refused — including the console
  // session of the only account that could switch it back off.
  const ROWS = [
    ['Enforce multi-factor authentication', 'Require MFA for all members on every sign-in.'],
    ['SSO (SAML 2.0)', 'Single sign-on via your identity provider (Okta).'],
  ]

  const settled = () =>
    waitFor(() => expect(screen.getByText('SSO (SAML 2.0)')).toBeDefined())

  it('lists exactly the remaining rows, in order', async () => {
    renderTab('security')

    await settled()
    const switches = screen.getAllByRole('switch')
    expect(switches.map((el) => el.getAttribute('aria-label'))).toEqual(ROWS.map(([t]) => t))
  })

  it.each(ROWS)('keeps the original wording for %s', async (title, detail) => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText(title)).toBeDefined())
    expect(screen.getByText(detail)).toBeDefined()
  })

  it('shows none of the technical detail the redesign had added', async () => {
    renderTab('security')

    await settled()
    for (const gone of [
      /Password minimum length/i,
      /Session lifetime/i,
      /Single sign-on — Google/i,
      /Set by/i,
      /JWT_EXPIRES_IN/,
      /Not available/i,
    ]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  // The withdrawal, held as a test so the row cannot quietly come back.
  it('offers no IP allowlist anywhere on the tab', async () => {
    const user = userEvent.setup()
    renderTab('security')

    await settled()
    expect(screen.queryByText(/ip allowlist/i)).toBeNull()
    expect(screen.queryByRole('switch', { name: /ip allowlist/i })).toBeNull()
    expect(screen.queryByText(/approved network/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /approved networks/i })).toBeNull()
    expect(screen.queryByLabelText(/approved networks/i)).toBeNull()

    // And nothing left on the tab can send one.
    for (const control of screen.getAllByRole('switch')) await user.click(control)
    expect(updateSecurityPolicyMock).not.toHaveBeenCalled()
  })

  describe('a control that is not built yet', () => {
    const UNBUILT = ['Enforce multi-factor authentication', 'SSO (SAML 2.0)']

    it('opens as an ordinary off switch, saying nothing', async () => {
      renderTab('security')

      await settled()
      expect(screen.queryByText(/coming soon/i)).toBeNull()
      for (const title of UNBUILT) {
        const control = screen.getByRole('switch', { name: title })
        expect(control.getAttribute('data-state')).toBe('unchecked')
        expect(control.disabled).toBe(false)
      }
    })

    it.each(UNBUILT)('lets the %s switch move, so it does not read as broken', async (title) => {
      // Pinning it off made a click look like a dead control rather than an
      // unfinished feature.
      const user = userEvent.setup()
      renderTab('security')

      const control = await screen.findByRole('switch', { name: title })
      await user.click(control)

      expect(control.getAttribute('data-state')).toBe('checked')
    })

    it.each(UNBUILT)('shows the answer beside %s once it is on', async (title) => {
      const user = userEvent.setup()
      renderTab('security')

      const control = await screen.findByRole('switch', { name: title })
      await user.click(control)

      const badge = within(control.parentElement).getByText('Coming soon')
      expect(badge).toBe(control.previousElementSibling)
    })

    it.each(UNBUILT)('turns %s back off, and takes the answer with it', async (title) => {
      const user = userEvent.setup()
      renderTab('security')

      const control = await screen.findByRole('switch', { name: title })
      await user.click(control)
      await user.click(control)

      expect(control.getAttribute('data-state')).toBe('unchecked')
      expect(screen.queryByText(/coming soon/i)).toBeNull()
    })

    it.each(UNBUILT)('sends nothing when %s is switched either way', async (title) => {
      const user = userEvent.setup()
      renderTab('security')

      const control = await screen.findByRole('switch', { name: title })
      await user.click(control)
      await user.click(control)

      expect(updateSecurityPolicyMock).not.toHaveBeenCalled()
    })

    it('moves only the switch that was clicked', async () => {
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('switch', { name: /multi-factor/i }))

      expect(screen.getAllByText('Coming soon')).toHaveLength(1)
      expect(
        screen.getByRole('switch', { name: 'SSO (SAML 2.0)' }).getAttribute('data-state'),
      ).toBe('unchecked')
    })

    it('is off again on a remount, because the feature really is off', async () => {
      const user = userEvent.setup()
      const first = renderTab('security')
      const control = await screen.findByRole('switch', { name: /multi-factor/i })
      await user.click(control)
      expect(control.getAttribute('data-state')).toBe('checked')

      first.unmount()
      renderTab('security')

      const fresh = await screen.findByRole('switch', { name: /multi-factor/i })
      expect(fresh.getAttribute('data-state')).toBe('unchecked')
      expect(screen.queryByText(/coming soon/i)).toBeNull()
    })

    it('ignores what the server holds for it', async () => {
      // requireMfa may well be true in the database; this switch is appearance
      // only and must not report the platform as enforcing something it is not
      // safe to operate from here.
      getSecurityPostureMock.mockResolvedValue({
        controls: CONTROLS.map((c) => (c.id === 'mfa' ? { ...c, enabled: true } : c)),
        policy: { ...POLICY, requireMfa: true },
      })
      renderTab('security')

      const control = await screen.findByRole('switch', { name: /multi-factor/i })
      expect(control.getAttribute('data-state')).toBe('unchecked')
    })
  })

  it('reports a failure to load as a failure, not an empty tab', async () => {
    getSecurityPostureMock.mockRejectedValue(new Error('Could not load security settings.'))
    renderTab('security')

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/could not load security settings/i)).toBeDefined()
  })
})
