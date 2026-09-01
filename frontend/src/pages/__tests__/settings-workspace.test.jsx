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

/** A literal newline, for the one-range-per-line textarea. */
const NL = String.fromCharCode(10)

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
  // The tab lists the three controls it has always listed. What it no longer
  // does is present all three as live: a switch is interactive only where the
  // platform really enforces the control, and the other two say Coming Soon
  // rather than sitting at "off", which invites a click.
  const ROWS = [
    ['Enforce multi-factor authentication', 'Require MFA for all members on every sign-in.'],
    ['SSO (SAML 2.0)', 'Single sign-on via your identity provider (Okta).'],
    ['IP allowlist', 'Restrict access to approved network ranges.'],
  ]

  it('lists exactly the three original rows, in order', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
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

    await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
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

  it('keeps the editor out of the way until it is asked for', async () => {
    renderTab('security')

    await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
    expect(screen.queryByLabelText(/approved networks/i)).toBeNull()
    expect(screen.getByRole('button', { name: /approved networks/i })).toBeDefined()
  })

  describe('a control that is not built yet', () => {
    const UNBUILT = ['Enforce multi-factor authentication', 'SSO (SAML 2.0)']

    it('opens as an ordinary off switch, saying nothing', async () => {
      renderTab('security')

      await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
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

    it('leaves the IP allowlist on real server state', async () => {
      // A range already saved, so enabling has something to enforce.
      getSecurityPostureMock.mockResolvedValue({
        controls: CONTROLS,
        policy: { ...POLICY, ipAllowlist: ['203.0.113.0/24'] },
      })
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))

      await waitFor(() =>
        expect(updateSecurityPolicyMock).toHaveBeenCalledWith({ ipAllowlistEnabled: true }),
      )
      // And never wears the badge.
      expect(screen.queryByText(/coming soon/i)).toBeNull()
    })
  })

  it('takes the switch state from the server, not from a local default', async () => {
    getSecurityPostureMock.mockResolvedValue({
      controls: CONTROLS.map((c) => (c.id === 'ip-allowlist' ? { ...c, enabled: true } : c)),
      policy: { ...POLICY, ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] },
    })
    renderTab('security')

    const control = await screen.findByRole('switch', { name: /ip allowlist/i })
    expect(control.getAttribute('data-state')).toBe('checked')
  })

  it('does not show a validation message until something is attempted', async () => {
    // It used to sit above a switch that was simply off, reading as a standing
    // complaint about the allowlist rather than the result of a click.
    renderTab('security')

    await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/add at least one address/i)).toBeNull()
  })

  describe('enabling with nothing to enforce', () => {
    it('says what is needed, without asking the server', async () => {
      // The API refuses this too, but answering here saves a pointless round
      // trip and can open the editor at the same time.
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))

      expect(
        await screen.findByText('Add at least one approved IP address or range first.'),
      ).toBeDefined()
      expect(updateSecurityPolicyMock).not.toHaveBeenCalled()
    })

    it('leaves the switch off', async () => {
      const user = userEvent.setup()
      renderTab('security')

      const control = await screen.findByRole('switch', { name: /ip allowlist/i })
      await user.click(control)

      expect(control.getAttribute('data-state')).toBe('unchecked')
    })

    it('opens the editor, which is where the operator has to go next', async () => {
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))

      expect(await screen.findByLabelText(/approved networks/i)).toBeDefined()
    })

    it('does not show the message before anything is attempted', async () => {
      renderTab('security')

      await waitFor(() => expect(screen.getByText('IP allowlist')).toBeDefined())
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('clears the message on its own', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderTab('security')

        await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))
        expect(await screen.findByText(/at least one approved/i)).toBeDefined()

        await vi.advanceTimersByTimeAsync(6000)
        await waitFor(() => expect(screen.queryByText(/at least one approved/i)).toBeNull())
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('the approved-networks editor', () => {
    const WITH_RANGES = {
      controls: CONTROLS,
      policy: { ...POLICY, ipAllowlist: ['203.0.113.25', '203.0.113.0/24', '2001:db8::/32'] },
    }

    /** Open the editor and hand back its textarea. */
    async function openEditor() {
      const user = userEvent.setup()
      renderTab('security')
      await user.click(await screen.findByRole('button', { name: /approved networks/i }))
      return { user, box: await screen.findByLabelText(/approved networks/i) }
    }

    it('opens with the ranges already saved, not blank', async () => {
      // GET used to answer with the controls alone, so the editor had nothing to
      // start from and a workspace with ranges was shown an empty box.
      getSecurityPostureMock.mockResolvedValue(WITH_RANGES)

      const { box } = await openEditor()

      expect(box.value).toBe(['203.0.113.25', '203.0.113.0/24', '2001:db8::/32'].join(NL))
    })

    it('says how many are saved without being opened', async () => {
      getSecurityPostureMock.mockResolvedValue(WITH_RANGES)
      renderTab('security')

      expect(await screen.findByRole('button', { name: /approved networks \(3\)/i })).toBeDefined()
    })

    it.each([
      ['a bare IPv4 address', '203.0.113.25'],
      ['an IPv4 CIDR range', '203.0.113.0/24'],
      ['an IPv6 CIDR range', '2001:db8::/32'],
    ])('saves %s', async (_label, entry) => {
      const { user, box } = await openEditor()
      await user.clear(box)
      await user.type(box, entry)
      await user.click(screen.getByRole('button', { name: /save networks/i }))

      await waitFor(() =>
        expect(updateSecurityPolicyMock).toHaveBeenCalledWith({ ipAllowlist: [entry] }),
      )
    })

    it('sends one entry per line, trimmed, blank lines dropped', async () => {
      const { user, box } = await openEditor()
      await user.clear(box)
      // Typing a newline into a textarea, plus stray whitespace either side.
      await user.type(box, `  203.0.113.25  ${NL}${NL}  2001:db8::/32 `)
      await user.click(screen.getByRole('button', { name: /save networks/i }))

      await waitFor(() =>
        expect(updateSecurityPolicyMock).toHaveBeenCalledWith({
          ipAllowlist: ['203.0.113.25', '2001:db8::/32'],
        }),
      )
    })

    it('shows the reason when the server rejects an entry', async () => {
      updateSecurityPolicyMock.mockRejectedValue(
        new Error('"not-an-ip" is not a valid address or range.'),
      )
      const { user, box } = await openEditor()
      await user.clear(box)
      await user.type(box, 'not-an-ip')
      await user.click(screen.getByRole('button', { name: /save networks/i }))

      expect(await screen.findByText(/not a valid address or range/i)).toBeDefined()
    })

    it('lets the allowlist be enabled once a range is saved', async () => {
      // Saving answers with the new policy, so the switch stops being refused.
      updateSecurityPolicyMock.mockResolvedValue({
        controls: CONTROLS,
        policy: { ...POLICY, ipAllowlist: ['203.0.113.0/24'] },
      })
      const { user, box } = await openEditor()
      await user.clear(box)
      await user.type(box, '203.0.113.0/24')
      await user.click(screen.getByRole('button', { name: /save networks/i }))
      await waitFor(() => expect(updateSecurityPolicyMock).toHaveBeenCalledTimes(1))

      await user.click(screen.getByRole('switch', { name: /ip allowlist/i }))

      await waitFor(() =>
        expect(updateSecurityPolicyMock).toHaveBeenLastCalledWith({ ipAllowlistEnabled: true }),
      )
    })

    it('can always be switched off again', async () => {
      // Whatever the list holds — the way back must never be blocked.
      getSecurityPostureMock.mockResolvedValue({
        controls: CONTROLS.map((c) => (c.id === 'ip-allowlist' ? { ...c, enabled: true } : c)),
        policy: { ...POLICY, ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] },
      })
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))

      await waitFor(() =>
        expect(updateSecurityPolicyMock).toHaveBeenCalledWith({ ipAllowlistEnabled: false }),
      )
    })

    it('reports the enabled state the server holds after a reload', async () => {
      getSecurityPostureMock.mockResolvedValue({
        controls: CONTROLS.map((c) => (c.id === 'ip-allowlist' ? { ...c, enabled: true } : c)),
        policy: { ...POLICY, ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] },
      })
      renderTab('security')

      const control = await screen.findByRole('switch', { name: /ip allowlist/i })
      expect(control.getAttribute('data-state')).toBe('checked')
    })
  })

  it('reports a policy the server refuses', async () => {
    // An invalid entry, say — the API names which one, and that is what shows.
    getSecurityPostureMock.mockResolvedValue({
      controls: CONTROLS,
      policy: { ...POLICY, ipAllowlist: ['203.0.113.0/24'] },
    })
    updateSecurityPolicyMock.mockRejectedValue(new Error('not-an-ip is not a valid address or range.'))
    const user = userEvent.setup()
    renderTab('security')

    await user.click(await screen.findByRole('switch', { name: /ip allowlist/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/not a valid address or range/i)).toBeDefined()
  })
})
