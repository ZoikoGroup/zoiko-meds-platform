import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  Blocks,
  Building2,
  Loader2,
  CreditCard,
  KeyRound,
  MoreHorizontal,
  Plus,
  ScrollText,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge, ServiceStatusBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check, FileText, Minus } from 'lucide-react'
import {
  listIntegrations,
  getOrganization,
  updateOrganization,
  getSecurityPosture,
  updateSecurityPolicy,
  listUsers,
} from '@/services/admin-api'
import { apiKeys, auditLogs, roleMatrix } from '@/services/ops-data'
import { useFlash } from '@/components/shared/flash'
import {
  getMfaStatus,
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
} from '@/services/auth-api'
import { useAuth } from '@/providers/auth-provider'
import { initials, formatRelative } from '@/utils/format'

const ROLE_KEYS = ['Owner', 'Admin', 'Analyst', 'Viewer', 'Auditor']

const TABS = [
  { value: 'organization', label: 'Organization', icon: Building2 },
  { value: 'members', label: 'Members', icon: UsersIcon },
  { value: 'roles', label: 'Roles', icon: ShieldCheck },
  { value: 'security', label: 'Security', icon: ShieldCheck },
  { value: 'audit', label: 'Audit log', icon: ScrollText },
  { value: 'api-keys', label: 'API keys', icon: KeyRound },
  { value: 'integrations', label: 'Integrations', icon: Blocks },
  { value: 'billing', label: 'Billing', icon: CreditCard },
]

/* --------------------------- table columns ----------------------------- */


/**
 * Columns for the real membership (MSA-41).
 *
 * Separate from userColumns above, which describes the ops-data fixture: that
 * shape has `name`, `status` and `lastActive`, and the API returns `fullName`,
 * `isActive` and `createdAt`. Reusing it silently rendered empty cells.
 */
const MEMBER_ROLE_VARIANT = {
  SUPER_ADMIN: 'default',
  ADMIN: 'teal',
  PHARMACY_ADMIN: 'info',
  PHARMACY_STAFF: 'secondary',
  ENTERPRISE: 'secondary',
  GOVERNMENT: 'secondary',
  PUBLIC: 'outline',
}

/** The roles as the API spells them, made readable without inventing new ones. */
const memberRoleLabel = (role) =>
  String(role ?? '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ') || 'Unknown'

const memberColumns = [
  {
    key: 'fullName',
    header: 'Member',
    sortable: true,
    accessor: (r) => r.fullName ?? r.email,
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <Avatar className="size-8">
          <AvatarFallback>{initials(r.fullName || r.email)}</AvatarFallback>
        </Avatar>
        <span className="flex flex-col">
          {/* An account created without a name still has an email, and showing
              the email twice beats showing a blank row. */}
          <span className="font-medium">{r.fullName || r.email}</span>
          <span className="text-xs text-muted-foreground">{r.email}</span>
        </span>
      </span>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    sortable: true,
    accessor: (r) => r.role,
    cell: (r) => (
      <Badge variant={MEMBER_ROLE_VARIANT[r.role] ?? 'outline'} size="sm">
        {memberRoleLabel(r.role)}
      </Badge>
    ),
  },
  {
    key: 'isActive',
    header: 'Status',
    sortable: true,
    accessor: (r) => (r.isActive ? 'active' : 'suspended'),
    cell: (r) => (
      <StatusBadge tone={r.isActive ? 'good' : 'critical'} size="sm">
        {r.isActive ? 'Active' : 'Deactivated'}
      </StatusBadge>
    ),
  },
  {
    key: 'createdAt',
    header: 'Joined',
    sortable: true,
    accessor: (r) => r.createdAt,
    // Not "last active": nothing records a last-seen time, and the fixture's
    // column implied one existed.
    cell: (r) => (
      <span className="text-muted-foreground">{formatRelative(r.createdAt) || '—'}</span>
    ),
  },
]

const apiKeyColumns = [
  { key: 'label', header: 'Key', sortable: true, cell: (r) => <span className="font-medium">{r.label}</span> },
  { key: 'prefix', header: 'Prefix', cell: (r) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.prefix}••••</code> },
  { key: 'scope', header: 'Scope', cell: (r) => <span className="text-muted-foreground">{r.scope}</span> },
  { key: 'lastUsed', header: 'Last used', cell: (r) => <span className="text-muted-foreground">{r.lastUsed}</span> },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <StatusBadge tone={r.status === 'active' ? 'good' : 'neutral'} size="sm">
        {r.status === 'active' ? 'Active' : 'Revoked'}
      </StatusBadge>
    ),
  },
]

const auditColumns = [
  { key: 'actor', header: 'Actor', sortable: true, cell: (r) => <span className="font-medium">{r.actor}</span> },
  { key: 'action', header: 'Action' },
  { key: 'resource', header: 'Resource', cell: (r) => <span className="text-muted-foreground">{r.resource}</span> },
  { key: 'scope', header: 'Scope', cell: (r) => <Badge variant="outline" size="sm">{r.scope}</Badge> },
  { key: 'timestamp', header: 'Timestamp', sortable: true, cell: (r) => <span className="tabular text-muted-foreground">{r.timestamp}</span> },
]

function actionsMenu(items) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it, i) =>
          it === '---' ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={i} variant={it.danger ? 'danger' : 'default'}>
              {it.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* -------------------------------- page ---------------------------------- */

/**
 * What this deployment is actually connected to (MSA-39).
 *
 * This tab used to render eight named enterprise systems from a fixture — Epic,
 * Cerner, Snowflake, Okta and others — with invented statuses and sync times. The
 * platform connects to none of them, and every Manage button opened nothing. The
 * server now reports its real dependencies, and Manage goes to the page that
 * governs each one, or is absent when the answer is a server credential.
 */
/**
 * The workspace's own profile (MSA-40).
 *
 * Every field here used to be a defaultValue — "Meridian Health Network",
 * "org-meridian", "North America (us-east)" — shown to every super admin of
 * every deployment, over a Save button with no handler. The residency line in
 * particular is the sort of thing an operator repeats to an auditor.
 */
function OrganizationPanel() {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [flashMsg, flash] = useFlash()

  useEffect(() => {
    let alive = true
    getOrganization()
      .then((row) => {
        if (!alive) return
        setSaved(row)
        setForm(row)
      })
      .catch((err) => alive && setError(err.message || 'Could not load the workspace profile.'))
    return () => { alive = false }
  }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Compared against what was loaded, so Save is live only when there is
  // something to save and Cancel has something to undo.
  const dirty =
    form && saved &&
    ['name', 'dataResidency', 'organizationType'].some(
      (k) => (form[k] ?? '') !== (saved[k] ?? ''),
    )

  const save = async (e) => {
    e.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const next = await updateOrganization({
        name: form.name,
        dataResidency: form.dataResidency ?? '',
        organizationType: form.organizationType ?? '',
      })
      setSaved(next)
      setForm(next)
      flash('Workspace profile saved')
    } catch (err) {
      setError(err.message || 'Could not save the workspace profile.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !form) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!form) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading workspace profile…
      </div>
    )
  }

  return (
    <form onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle>Organization profile</CardTitle>
          <CardDescription>
            Workspace details used across governed surfaces and exports.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Workspace name</Label>
            <Input id="org-name" value={form.name ?? ''} onChange={set('name')} required maxLength={120} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-id">Workspace ID</Label>
            {/* Not editable: it is the stable external handle, and renaming the
                workspace must not change what it is. */}
            <Input id="org-id" value={form.slug ?? ''} readOnly disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-region">Data residency region</Label>
            <Input
              id="org-region"
              value={form.dataResidency ?? ''}
              onChange={set('dataResidency')}
              placeholder="Not recorded"
              maxLength={120}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Recorded here for reference. Where data is held is decided by how this
              deployment is hosted; the application does not enforce it.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-type">Organization type</Label>
            <Input
              id="org-type"
              value={form.organizationType ?? ''}
              onChange={set('organizationType')}
              placeholder="Not recorded"
              maxLength={120}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs font-medium text-danger sm:col-span-2">{error}</p>
          )}
          {flashMsg && <p className="text-xs font-medium text-success sm:col-span-2">{flashMsg}</p>}
          {saved?.updatedAt && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Last saved {formatRelative(saved.updatedAt) || 'recently'}
              {saved.updatedByEmail ? ` by ${saved.updatedByEmail}` : ''}.
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setForm(saved)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!dirty || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

/**
 * The people who actually have access (MSA-41).
 *
 * The table was fed by a fixture in ops-data, so every deployment's super admin
 * was shown the same invented colleagues, and "Invite member" had no handler.
 * The row menu offered Edit role, Resend invite and Remove member, none of which
 * did anything.
 *
 * The console already has a full user-management page at /admin/users, built on
 * these same endpoints. Rather than grow a second, divergent way to create and
 * remove accounts, this shows the real membership and sends every action there.
 */
function MembersPanel() {
  const [members, setMembers] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    // A workspace roster, not a paginated directory: the full list lives on the
    // users page, and this asks for enough to be a fair summary of it.
    listUsers({ pageSize: 50 })
      .then((res) => alive && setMembers(res?.items ?? []))
      .catch((err) => alive && setError(err.message || 'Could not load members.'))
    return () => { alive = false }
  }, [])

  if (error) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!members) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading members…
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Members</CardTitle>
          <CardDescription>People with access to this workspace.</CardDescription>
        </div>
        {/* Opens the page that actually creates accounts, rather than a second
            form that would drift from it. */}
        <Button asChild size="sm">
          <Link to="/admin/users">
            <Plus />
            Invite member
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="py-2">
        {members.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No members yet"
            description="Accounts created for this workspace appear here."
          />
        ) : (
          <DataTable
            columns={memberColumns}
            data={members}
            getRowId={(r) => r.id}
            searchAccessor={(r) => `${r.fullName ?? ''} ${r.email} ${r.role}`}
            searchPlaceholder="Search members…"
            pageSize={8}
          />
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          {members.length} {members.length === 1 ? 'member' : 'members'} shown.
        </span>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/users">Manage roles and access</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

/**
 * Enrol this account in two-factor authentication (MSA-42).
 *
 * Two steps, because that is what the API does: setup mints a secret and hands
 * back the URI to scan, confirm proves a code against it. Nothing is required of
 * the account until a code has been confirmed, so opening this panel and closing
 * the tab changes nothing.
 */
function MfaCard() {
  const [status, setStatus] = useState(null)
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [flashMsg, flash] = useFlash()

  const load = useCallback(async () => {
    try {
      setStatus(await getMfaStatus())
    } catch (err) {
      setError(err?.message || 'Could not read two-factor status.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const begin = async () => {
    setBusy(true)
    setError('')
    try {
      setSetup(await beginMfaSetup())
    } catch (err) {
      setError(err?.message || 'Could not start setup.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await confirmMfaSetup(code)
      setSetup(null)
      setCode('')
      await load()
      flash('Two-factor authentication is on for your account')
    } catch (err) {
      setError(err?.message || 'That code was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await disableMfa(code)
      setCode('')
      await load()
      flash('Two-factor authentication is off for your account')
    } catch (err) {
      setError(err?.message || 'Could not turn it off.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your two-factor authentication</CardTitle>
        <CardDescription>
          A code from an authenticator app, asked for after your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {flashMsg && <p className="text-xs font-medium text-success">{flashMsg}</p>}
        {error && (
          <p role="alert" className="flex items-start gap-2 text-xs font-medium text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {status === null ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </span>
        ) : status.enrolled ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge tone="good" size="sm">On</StatusBadge>
              <span className="text-xs text-muted-foreground">
                Enrolled {formatRelative(status.enrolledAt) || 'recently'}
              </span>
            </div>
            {status.required ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                This workspace requires two-factor authentication, so it cannot be turned
                off here.
              </p>
            ) : (
              <form onSubmit={turnOff} className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                  <Label htmlFor="mfa-off-code">Enter a current code to turn it off</Label>
                  <Input
                    id="mfa-off-code"
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="font-mono tracking-widest"
                  />
                </div>
                <Button type="submit" variant="outline" size="sm" disabled={busy || !code}>
                  Turn off
                </Button>
              </form>
            )}
          </>
        ) : setup ? (
          <form onSubmit={confirm} className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Add this to your authenticator app, then enter the code it shows.
            </p>
            {/* The key in text as well as the URI: not every environment can
                scan, and the secret is the only way in without a camera. */}
            <code className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              {setup.secret}
            </code>
            <a
              href={setup.otpauthUri}
              className="w-fit text-xs font-medium text-primary underline underline-offset-2"
            >
              Open in your authenticator app
            </a>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor="mfa-code">Code from the app</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-widest"
                />
              </div>
              <Button type="submit" size="sm" disabled={busy || !code}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <StatusBadge tone={status.required ? 'critical' : 'serious'} size="sm">
                Off
              </StatusBadge>
              {status.required && (
                <span className="text-xs text-danger">
                  This workspace requires it. You will not be able to sign in again until
                  you set it up.
                </span>
              )}
            </div>
            <Button size="sm" onClick={begin} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Set up
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * What the platform enforces about sign-in, and the parts of it this page can
 * decide (MSA-42).
 *
 * This was three switches bound to useState and nothing else, two of them on by
 * default, naming controls the platform did not have. The controls that are real
 * now have switches that write a policy the auth path reads; the ones that are
 * still absent are reported as absent, rather than as switched off, because
 * "off" invites someone to turn it on.
 */
function SecurityPanel() {
  const [controls, setControls] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState(null)
  const [allowlistDraft, setAllowlistDraft] = useState('')
  const [flashMsg, flash] = useFlash()

  const apply = useCallback((rows, next) => {
    setControls(rows)
    if (next) {
      setPolicy(next)
      setAllowlistDraft((next.ipAllowlist ?? []).join('\n'))
    }
  }, [])

  useEffect(() => {
    let alive = true
    getSecurityPosture()
      .then((rows) => {
        if (!alive) return
        setControls(Array.isArray(rows) ? rows : [])
        const list = (Array.isArray(rows) ? rows : []).find((c) => c.id === 'ip-allowlist')
        // The list itself is not in the control rows; it is read back from the
        // first save. Until then the textarea starts from what the API returns
        // on the next PATCH, so it is left empty rather than guessed at.
        setPolicy({ ipAllowlistEnabled: Boolean(list?.enabled) })
      })
      .catch((err) => alive && setError(err.message || 'Could not load security settings.'))
    return () => { alive = false }
  }, [])

  const save = async (key, body) => {
    setSavingKey(key)
    setError('')
    try {
      const { controls: rows, policy: next } = await updateSecurityPolicy(body)
      apply(rows, next)
      flash('Security policy saved')
    } catch (err) {
      setError(err?.message || 'Could not save the security policy.')
      // Re-read, so a refused save does not leave the switch showing a state
      // the server never accepted.
      try { setControls(await getSecurityPosture()) } catch { /* keep the error above */ }
    } finally {
      setSavingKey(null)
    }
  }

  if (error && !controls) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!controls) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading security settings…
      </div>
    )
  }

  const TONE = {
    enforced: { label: 'Enforced', variant: 'default' },
    available: { label: 'Available', variant: 'secondary' },
    'not-implemented': { label: 'Not available', variant: 'outline' },
  }

  const allowlistEnabled = controls.find((c) => c.id === 'ip-allowlist')?.enabled

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Authentication and access controls for the workspace. A control with a switch
            is decided here; the rest are set in server configuration or in code, and are
            shown so the page cannot disagree with what the platform does.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {flashMsg && <p className="pb-2 text-xs font-medium text-success">{flashMsg}</p>}
          {error && (
            <p role="alert" className="flex items-start gap-2 pb-2 text-xs font-medium text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          {controls.map((c, i) => (
            <div key={c.id}>
              <div className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Set by {c.configuredBy}</p>
                </div>
                {c.setting ? (
                  <Switch
                    checked={Boolean(c.enabled)}
                    disabled={savingKey === c.setting}
                    aria-label={c.label}
                    onCheckedChange={(next) => save(c.setting, { [c.setting]: next })}
                  />
                ) : (
                  <Badge variant={(TONE[c.state] ?? TONE['not-implemented']).variant} size="sm">
                    {(TONE[c.state] ?? TONE['not-implemented']).label}
                  </Badge>
                )}
              </div>
              {i < controls.length - 1 && <Separator />}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approved networks</CardTitle>
          <CardDescription>
            One address or CIDR range per line. The allowlist above only takes effect once
            there is something here — switching it on with an empty list would lock every
            operator out, including whoever would switch it off again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <textarea
            aria-label="Approved networks"
            rows={5}
            value={allowlistDraft}
            onChange={(e) => setAllowlistDraft(e.target.value)}
            placeholder={'203.0.113.0/24\n2001:db8::/32'}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Health checks are always answered, whatever is listed here, so a wrong entry
            cannot pull this service out of its load balancer.
          </p>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            size="sm"
            disabled={savingKey === 'ipAllowlist'}
            onClick={() =>
              save('ipAllowlist', {
                ipAllowlist: allowlistDraft
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          >
            {savingKey === 'ipAllowlist' && <Loader2 className="size-4 animate-spin" />}
            Save networks
          </Button>
        </CardFooter>
      </Card>

      {allowlistEnabled && (policy?.ipAllowlist?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground">
          Save at least one network above for the allowlist to take effect.
        </p>
      )}

      <MfaCard />
    </div>
  )
}

function IntegrationsPanel() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listIntegrations()
      .then((rows) => alive && setItems(Array.isArray(rows) ? rows : []))
      .catch((err) => alive && setError(err.message || 'Could not load integration status.'))
    return () => { alive = false }
  }, [])

  if (error) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading integration status…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The external services this deployment depends on, read from the server's own
        configuration. Anything listed as not configured is switched off here, not
        broken.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Card key={it.id} className="gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-semibold">
                  {initials(it.name)}
                </span>
                <div>
                  <p className="text-sm font-medium">{it.name}</p>
                  <p className="text-xs text-muted-foreground">{it.category}</p>
                </div>
              </div>
              <ServiceStatusBadge status={it.status} size="sm" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{it.detail}</p>
            <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3">
              <span className="text-[11px] text-muted-foreground">
                {it.manage ? ' ' : `Set by ${it.configuredBy ?? 'server configuration'}`}
              </span>
              {it.manage ? (
                <Button asChild variant="outline" size="sm">
                  <Link to={it.manage}>Manage</Link>
                </Button>
              ) : (
                <span className="text-[11px] font-medium text-muted-foreground">
                  Not managed here
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'organization'
  const setTab = (v) =>
    setSearchParams(v === 'organization' ? {} : { tab: v }, { replace: true })


  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        subtitle="Manage your organization, members, security, API access, integrations, and billing."
        breadcrumbs={[{ label: 'ZoikoMeds', to: '/dashboard' }, { label: 'Settings' }]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                <t.icon />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Organization */}
        <TabsContent value="organization">
          <OrganizationPanel />
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <MembersPanel />
        </TabsContent>

        {/* Roles & permissions */}
        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>Roles & permissions</CardTitle>
              <CardDescription>
                Capability matrix across workspace roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-2">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Capability</TableHead>
                    {ROLE_KEYS.map((r) => (
                      <TableHead key={r} className="text-center">
                        {r}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roleMatrix.map((row) => (
                    <TableRow key={row.capability}>
                      <TableCell className="font-medium">{row.capability}</TableCell>
                      {ROLE_KEYS.map((r) => (
                        <TableCell key={r} className="text-center">
                          {row[r] ? (
                            <Check className="mx-auto size-4 text-success" />
                          ) : (
                            <Minus className="mx-auto size-4 text-muted-foreground/50" />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <SecurityPanel />
        </TabsContent>

        {/* Audit log */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>
                Immutable record of governed actions, retained for 24 months.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-2">
              <DataTable
                columns={auditColumns}
                data={auditLogs}
                getRowId={(r) => r.id}
                searchAccessor={(r) => `${r.actor} ${r.action} ${r.resource} ${r.scope}`}
                searchPlaceholder="Search audit log…"
                pageSize={8}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* API keys */}
        <TabsContent value="api-keys">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>API keys</CardTitle>
                <CardDescription>Scoped keys for ZoikoAvail™.</CardDescription>
              </div>
              <Button size="sm">
                <Plus />
                Create key
              </Button>
            </CardHeader>
            <CardContent className="py-2">
              <DataTable
                columns={apiKeyColumns}
                data={apiKeys}
                getRowId={(r) => r.id}
                searchAccessor={(r) => `${r.label} ${r.scope}`}
                searchPlaceholder="Search keys…"
                pageSize={8}
                rowActions={() =>
                  actionsMenu([
                    { label: 'Reveal key' },
                    { label: 'Rotate key' },
                    '---',
                    { label: 'Revoke key', danger: true },
                  ])
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Plan</CardTitle>
                <CardDescription>Commercial standing for this organization.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-semibold tracking-tight">Not billed</span>
                  <Badge variant="secondary" size="sm">No subscription</Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Live charging is not enabled on this platform yet. Nothing is being invoiced, so
                  there is no plan, renewal date or usage figure to show. Prices and commercial
                  policy are managed on the Commercial page.
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button asChild className="flex-1">
                  <Link to="/admin/commercial">Open Commercial</Link>
                </Button>
              </CardFooter>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
                <CardDescription>Billing history.</CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <EmptyState
                  icon={FileText}
                  title="No invoices"
                  description="Invoices appear here once billing is live. An invoice never shows patient names, medicine names or search queries."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* current-user footnote */}
      <p className="text-center text-xs text-muted-foreground">
        Signed in as {user?.name || 'User'} · {user?.role || 'Guest'}
      </p>
    </div>
  )
}
