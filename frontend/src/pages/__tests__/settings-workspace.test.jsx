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

const mfaStatusMock = vi.fn()
const mfaSetupMock = vi.fn()
const mfaConfirmMock = vi.fn()
const mfaDisableMock = vi.fn()

vi.mock('@/services/auth-api', () => ({
  mfaStatusRequest: () => mfaStatusMock(),
  mfaSetupRequest: () => mfaSetupMock(),
  mfaConfirmRequest: (code) => mfaConfirmMock(code),
  mfaDisableRequest: (code) => mfaDisableMock(code),
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

const POLICY = {
  requireMfa: false,
  allowOauthSignIn: true,
}

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
    id: 'oauth-sign-in',
    label: 'Allow single sign-on',
    detail: 'Members may sign in with any identity provider configured below.',
    state: 'enforced',
    configuredBy: 'This page',
    setting: 'allowOauthSignIn',
    enabled: true,
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

// Six administrators with a password, two of them enrolled: four would lose
// their sign-in the moment the switch went on. Patients and pharmacies are not
// counted — the policy does not reach them.
const READINESS = { actorEnrolled: true, passwordMembers: 6, enrolledMembers: 2 }

const posture = (over = {}) => ({
  controls: CONTROLS.map((c) =>
    over.controls?.[c.id] ? { ...c, ...over.controls[c.id] } : c,
  ),
  policy: { ...POLICY, ...over.policy },
  mfa: { ...READINESS, ...over.mfa },
})

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
  getSecurityPostureMock.mockResolvedValue(posture())
  updateSecurityPolicyMock.mockResolvedValue(posture())
  // Enrolled by default. The switch that requires MFA of the workspace is held
  // until this administrator has a factor of their own, so a test about saving
  // needs an account that is allowed to save.
  mfaStatusMock.mockResolvedValue({
    enrolled: true,
    pending: false,
    enrolledAt: new Date().toISOString(),
    required: false,
  })
  mfaSetupMock.mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/ZoikoMeds:root@zoikomeds.test?secret=JBSWY3DPEHPK3PXP',
  })
  mfaConfirmMock.mockResolvedValue({ enrolled: true })
  mfaDisableMock.mockResolvedValue({ enrolled: false })
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
  // The switches were bound to useState and nothing else, then pinned off and
  // labelled "coming soon" — which stopped them lying, but left a workspace
  // with no way to require a second factor at all. Enforcement was built the
  // whole time. What was missing was somewhere to enrol, and anything stopping
  // an unenrolled administrator from requiring of everybody a factor they did
  // not have themselves: they were refused their own next sign-in by the rule
  // they had just written, and no other account could lift it.

  const notEnrolled = () =>
    mfaStatusMock.mockResolvedValue({
      enrolled: false,
      pending: false,
      enrolledAt: null,
      required: false,
    })

  const settled = () =>
    waitFor(() => expect(screen.getByText('Your authenticator app')).toBeDefined())

  const mfaSwitch = () =>
    screen.getByRole('switch', { name: 'Require two-factor authentication' })

  it('renders a switch for every control the server says it can set', async () => {
    renderTab('security')

    await settled()
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label'))).toEqual([
      'Require two-factor authentication',
      'Allow single sign-on',
    ])
  })

  it('reports what the server holds rather than a default of its own', async () => {
    // The bug in its first form: switches that opened on regardless, so the
    // page read as active security whatever the workspace had stored.
    getSecurityPostureMock.mockResolvedValue(
      posture({ controls: { mfa: { enabled: true } }, policy: { requireMfa: true } }),
    )
    renderTab('security')

    await settled()
    expect(mfaSwitch().getAttribute('data-state')).toBe('checked')
  })

  it('saves the change, which is the whole of the bug', async () => {
    const user = userEvent.setup()
    renderTab('security')

    await settled()
    await user.click(mfaSwitch())

    await waitFor(() =>
      expect(updateSecurityPolicyMock).toHaveBeenCalledWith({ requireMfa: true }),
    )
    expect(await screen.findByText(/security policy saved/i)).toBeDefined()
  })

  it('sends only the control that was touched', async () => {
    const user = userEvent.setup()
    renderTab('security')

    await settled()
    await user.click(screen.getByRole('switch', { name: 'Allow single sign-on' }))

    await waitFor(() =>
      expect(updateSecurityPolicyMock).toHaveBeenCalledWith({ allowOauthSignIn: false }),
    )
  })

  it('takes the switch back to what the server accepted when a save is refused', async () => {
    // A switch left sitting in a state the server rejected is the same lie the
    // useState version told, arrived at a different way.
    updateSecurityPolicyMock.mockRejectedValue(new Error('Could not save the security policy.'))
    const user = userEvent.setup()
    renderTab('security')

    await settled()
    await user.click(mfaSwitch())

    expect(await screen.findByRole('alert')).toBeDefined()
    await waitFor(() => expect(mfaSwitch().getAttribute('data-state')).toBe('unchecked'))
  })

  describe('not locking the workspace out of its own console', () => {
    it('holds the MFA switch while this administrator has no factor of their own', async () => {
      notEnrolled()
      renderTab('security')

      await settled()
      expect(mfaSwitch().disabled).toBe(true)
      expect(screen.getByText(/set up your own authenticator app first/i)).toBeDefined()
    })

    it('sends nothing at all from that held switch', async () => {
      const user = userEvent.setup()
      notEnrolled()
      renderTab('security')

      await settled()
      await user.click(mfaSwitch())

      expect(updateSecurityPolicyMock).not.toHaveBeenCalled()
    })

    it('never holds the switch that turns it back off', async () => {
      // The way out of a workspace requiring more than it can supply. An
      // unenrolled admin holding a session got there before the policy changed,
      // and lifting it must not need the factor being demanded.
      notEnrolled()
      getSecurityPostureMock.mockResolvedValue(
        posture({ controls: { mfa: { enabled: true } }, policy: { requireMfa: true } }),
      )
      renderTab('security')

      await settled()
      expect(mfaSwitch().disabled).toBe(false)
    })

    it('leaves the unrelated switch alone', async () => {
      notEnrolled()
      renderTab('security')

      await settled()
      expect(screen.getByRole('switch', { name: 'Allow single sign-on' }).disabled).toBe(false)
    })

    it('says how many administrators would lose their sign-in, before the switch is thrown', async () => {
      // Administrators, not members. The policy reaches SUPER_ADMIN alone —
      // patients and pharmacies use the opt-in emailed link, which this switch
      // neither requires nor affects. Counting them here would report a lockout
      // that cannot happen.
      renderTab('security')

      await settled()
      expect(screen.getByText(/4 administrators have no\s+authenticator app/i)).toBeDefined()
    })

    it('says nothing of the sort once everybody is enrolled', async () => {
      getSecurityPostureMock.mockResolvedValue(
        posture({ mfa: { passwordMembers: 3, enrolledMembers: 3 } }),
      )
      renderTab('security')

      await settled()
      expect(screen.queryByText(/no authenticator app/i)).toBeNull()
    })
  })

  describe('enrolling an authenticator', () => {
    it('offers setup to an administrator who has none', async () => {
      notEnrolled()
      renderTab('security')

      expect(await screen.findByText('Not enrolled')).toBeDefined()
      expect(screen.getByRole('button', { name: /set up/i })).toBeDefined()
    })

    it('shows the setup key to enter into the app', async () => {
      const user = userEvent.setup()
      notEnrolled()
      renderTab('security')

      await user.click(await screen.findByRole('button', { name: /set up/i }))

      // Grouped for reading, as every authenticator app displays it.
      expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeDefined()
    })

    it('turns the factor on only once a code has been proved against it', async () => {
      const user = userEvent.setup()
      notEnrolled()
      renderTab('security')

      await user.click(await screen.findByRole('button', { name: /set up/i }))
      await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
      mfaStatusMock.mockResolvedValue({
        enrolled: true,
        pending: false,
        enrolledAt: new Date().toISOString(),
        required: false,
      })
      await user.click(screen.getByRole('button', { name: /^confirm$/i }))

      await waitFor(() => expect(mfaConfirmMock).toHaveBeenCalledWith('123456'))
      expect(await screen.findByText('Enrolled')).toBeDefined()
    })

    it('re-reads the posture after enrolling, which is what frees the switch', async () => {
      const user = userEvent.setup()
      notEnrolled()
      renderTab('security')

      await settled()
      expect(mfaSwitch().disabled).toBe(true)

      await user.click(screen.getByRole('button', { name: /set up/i }))
      await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
      mfaStatusMock.mockResolvedValue({
        enrolled: true,
        pending: false,
        enrolledAt: new Date().toISOString(),
        required: false,
      })
      await user.click(screen.getByRole('button', { name: /^confirm$/i }))

      await waitFor(() => expect(mfaSwitch().disabled).toBe(false))
    })

    it('keeps the setup key on screen when a code is mistyped', async () => {
      // A wrong code should cost a retry, not the whole enrolment and another
      // trip through the key.
      mfaConfirmMock.mockRejectedValue(new Error('That code is not right. Try the current one.'))
      const user = userEvent.setup()
      notEnrolled()
      renderTab('security')

      await user.click(await screen.findByRole('button', { name: /set up/i }))
      await user.type(await screen.findByLabelText(/6-digit code/i), '000000')
      await user.click(screen.getByRole('button', { name: /^confirm$/i }))

      expect(await screen.findByText(/not right/i)).toBeDefined()
      expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeDefined()
    })

    it('asks for a current code before turning the factor off', async () => {
      const user = userEvent.setup()
      renderTab('security')

      await user.click(await screen.findByRole('button', { name: /turn off/i }))
      await user.type(await screen.findByLabelText(/current code/i), '654321')
      await user.click(screen.getByRole('button', { name: /^turn off$/i }))

      await waitFor(() => expect(mfaDisableMock).toHaveBeenCalledWith('654321'))
    })

    it('will not offer to turn it off while the workspace requires it', async () => {
      mfaStatusMock.mockResolvedValue({
        enrolled: true,
        pending: false,
        enrolledAt: new Date().toISOString(),
        required: true,
      })
      renderTab('security')

      await settled()
      expect(screen.getByRole('button', { name: /turn off/i }).disabled).toBe(true)
    })
  })

  // The withdrawal, held as a test so the row cannot quietly come back. An
  // operator saved a subnet mask as a range, switched it on, and every request
  // from outside that list was refused — including the console session of the
  // only account that could switch it back off.
  it('offers no IP allowlist anywhere on the tab', async () => {
    renderTab('security')

    await settled()
    expect(screen.queryByText(/ip allowlist/i)).toBeNull()
    expect(screen.queryByRole('switch', { name: /ip allowlist/i })).toBeNull()
    expect(screen.queryByText(/approved network/i)).toBeNull()
    expect(screen.queryByLabelText(/approved networks/i)).toBeNull()
  })

  it('names SAML as absent rather than offering a switch for it', async () => {
    renderTab('security')

    await settled()
    expect(screen.getByText('SAML 2.0')).toBeDefined()
    expect(screen.queryByRole('switch', { name: /saml/i })).toBeNull()
    expect(screen.getByText('Not available')).toBeDefined()
  })

  it('reports a failure to load as a failure, not an empty tab', async () => {
    getSecurityPostureMock.mockRejectedValue(new Error('Could not load security settings.'))
    renderTab('security')

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/could not load security settings/i)).toBeDefined()
  })
})
