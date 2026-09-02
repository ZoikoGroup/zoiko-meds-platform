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
  TriangleAlert,
  Users as UsersIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge, ServiceStatusBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import { CopyButton } from '@/components/shared/copy-button'
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
  getRoleMatrix,
  listAuditLogs,
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from '@/services/admin-api'
import { useFlash } from '@/components/shared/flash'
import { useAuth } from '@/providers/auth-provider'
import { initials, formatRelative } from '@/utils/format'


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

/**
 * Columns for the real audit rows.
 *
 * Not the fixture's shape: that had `resource` and `scope`, which the API does
 * not return, so reusing it rendered two blank columns over live data. The API
 * gives timestamp / action / actor / module / severity / ip / summary.
 */
const auditColumns = [
  {
    key: 'timestamp',
    header: 'When',
    sortable: true,
    cell: (r) => (
      <span className="tabular whitespace-nowrap text-muted-foreground">
        {formatRelative(r.timestamp) || '—'}
      </span>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    sortable: true,
    cell: (r) => <span className="font-medium">{r.actor}</span>,
  },
  { key: 'action', header: 'Action' },
  {
    key: 'summary',
    header: 'Summary',
    // The server writes this from the action and its metadata, so the row reads
    // as a sentence rather than as an event name and a JSON blob.
    cell: (r) => <span className="text-muted-foreground">{r.summary || '—'}</span>,
  },
  {
    key: 'module',
    header: 'Module',
    cell: (r) => <Badge variant="outline" size="sm">{r.module}</Badge>,
  },
]


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
 * The sign-in controls this page shows (MSA-42).
 *
 * They were switches bound to useState and nothing else, two of them on by
 * default, so all three read as active security while none of them did anything.
 * What changed is that a switch is live only where the platform really enforces
 * the control, and the rest say so instead of sitting there inviting a click.
 *
 * IP allowlist has been withdrawn. It was the one live switch here, and it did
 * exactly what it said: an operator saved a subnet mask as though it were a
 * range, switched it on, and every request from outside that list was refused —
 * including the console session of the only account that could switch it back
 * off. Recovering it took a write to the database. Restriction by network now
 * belongs at the load balancer, where locking yourself out does not also remove
 * the means to undo it.
 *
 * SAML is not built at all. Single sign-on here is OAuth against Google, which
 * is a different protocol — an Okta IdP that only speaks SAML cannot be
 * connected, so this switch would have configured nothing.
 *
 * MFA is built and enforced at login, but the enable path does not yet check
 * that the admin turning it on has finished enrolling. Switching it on while
 * unenrolled refuses every password sign-in, including theirs — which is exactly
 * what happened in production. It stays disabled until that guard exists.
 */

/** The rows, in the order the page has always listed them. */
const SECURITY_ROWS = [
  {
    id: 'mfa',
    title: 'Enforce multi-factor authentication',
    detail: 'Require MFA for all members on every sign-in.',
    // Enforced at login, but enabling it can still lock out an unenrolled admin.
    comingSoon: true,
  },
  {
    id: 'saml',
    title: 'SSO (SAML 2.0)',
    detail: 'Single sign-on via your identity provider (Okta).',
    // No SAML service provider exists; Google OAuth is not the same protocol.
    comingSoon: true,
  },
]

function SecurityPanel() {
  const [controls, setControls] = useState(null)
  // `error` is only for a failed load, which leaves the page with nothing to
  // show. A refused save is transient: it belongs to the click that caused it,
  // rather than sitting there afterwards reading as a standing complaint.
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState(null)
  const [flashMsg, flash] = useFlash()
  const [saveError, flashError] = useFlash(5200)
  /**
   * The switches for controls that are not built yet.
   *
   * Held here rather than bound to the server policy, which is why they move at
   * all: reading them off the policy pinned them off, so a click appeared to do
   * nothing and the control read as broken rather than as unfinished. This state
   * is the switch's appearance and nothing else — it is never sent, never
   * stored, and gone on the next mount, because the feature really is off.
   */
  const [uiOnly, setUiOnly] = useState({})

  /** Take a { policy, controls } payload from either a read or a save. */
  const apply = useCallback((next) => {
    setControls(Array.isArray(next?.controls) ? next.controls : [])
  }, [])

  useEffect(() => {
    let alive = true
    getSecurityPosture()
      .then((next) => alive && apply(next))
      .catch((err) => alive && setError(err.message || 'Could not load security settings.'))
    return () => { alive = false }
  }, [apply])

  /** Is this control on, according to the server rather than to this component? */
  const isOn = (id) => Boolean(controls?.find((c) => c.id === id)?.enabled)

  /** Move an unbuilt control's switch, and say why it will not do anything. */
  const setUiOnlySwitch = (id, next) => setUiOnly((prev) => ({ ...prev, [id]: next }))

  const save = async (key, body, message) => {
    setSavingKey(key)
    setError('')
    try {
      apply(await updateSecurityPolicy(body))
      flash(message)
    } catch (err) {
      flashError(err?.message || 'Could not save the security policy.')
      // Re-read, so a refused save does not leave the switch showing a state the
      // server never accepted.
      try { apply(await getSecurityPosture()) } catch { /* keep the message above */ }
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Authentication and access controls for the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {flashMsg && <p className="pb-2 text-xs font-medium text-success">{flashMsg}</p>}
        {saveError && (
          <p role="alert" className="flex items-start gap-2 pb-2 text-xs font-medium text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {saveError}
          </p>
        )}
        {SECURITY_ROWS.map((row, i) => (
          <div key={row.id}>
            <div className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
              </div>
              {/* Badge then switch, as the patient Accessibility rows do, and
                  only while the switch is on — the answer belongs to the moment
                  somebody asks for the feature, not to the row at rest. */}
              <div className="flex shrink-0 items-center gap-3">
                {row.comingSoon && uiOnly[row.id] && (
                  <span
                    role="status"
                    className="rounded-full border border-teal/20 bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400"
                  >
                    Coming soon
                  </span>
                )}
                <Switch
                  // An unbuilt control's switch is local appearance; a real one
                  // reports what the server holds.
                  checked={row.comingSoon ? Boolean(uiOnly[row.id]) : isOn(row.id)}
                  disabled={savingKey === row.setting}
                  aria-label={row.title}
                  onCheckedChange={(next) =>
                    row.comingSoon
                      ? setUiOnlySwitch(row.id, next)
                      : save(row.setting, { [row.setting]: next }, 'Security policy saved')
                  }
                />
              </div>
            </div>
            {i < SECURITY_ROWS.length - 1 && <Separator />}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * The capability matrix, read from the guards that enforce it (MSA-41).
 *
 * This was a hand-written table in a frontend fixture. A matrix is what someone
 * reads to answer "can a pharmacist see this?", and a hand-written one answers
 * from whenever it was last edited. The API derives it by walking the
 * controllers and reading the same @Roles metadata RolesGuard reads.
 */
function RolesPanel() {
  const [matrix, setMatrix] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getRoleMatrix()
      .then((data) => alive && setMatrix(data))
      .catch((err) => alive && setError(err.message || 'Could not load the role matrix.'))
    return () => { alive = false }
  }, [])

  if (error) return <PanelError message={error} />
  if (!matrix) return <PanelLoading label="Loading roles…" />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles &amp; permissions</CardTitle>
        <CardDescription>
          Which roles can reach which parts of the platform, derived from the checks the
          API actually enforces. It cannot claim access a route refuses.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Capability</TableHead>
                {matrix.roles.map((role) => (
                  <TableHead key={role.id} className="text-center whitespace-nowrap">
                    {role.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.capabilities.map((capability) => (
                <TableRow key={capability.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-col">
                      {capability.label}
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {capability.routes} {capability.routes === 1 ? 'route' : 'routes'}
                        {/* "Every role can reach this" and "this needs no account
                            at all" look identical in a row of ticks. */}
                        {capability.hasPublicRoutes && ' · some need no account'}
                      </span>
                    </span>
                  </TableCell>
                  {matrix.roles.map((role) => (
                    <TableCell key={role.id} className="text-center">
                      {capability.roles.includes(role.id) ? (
                        <Check className="mx-auto size-4 text-success" aria-label="allowed" />
                      ) : (
                        <Minus
                          className="mx-auto size-4 text-muted-foreground/50"
                          aria-label="not allowed"
                        />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** The real audit trail, which the console already serves at /admin/audit-logs. */
function AuditPanel() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    // pageSize, not limit: /admin/audit-logs paginates on page/pageSize, and the
    // query DTO is whitelisted with forbidNonWhitelisted — so `limit` was not
    // ignored, it was rejected, and the tab rendered "property limit should not
    // exist" instead of the log. 50 is also the server's own default.
    listAuditLogs({ pageSize: 50 })
      .then((data) => {
        if (!alive) return
        // The endpoint is paginated, so the rows may arrive wrapped.
        setRows(Array.isArray(data) ? data : (data?.items ?? data?.data ?? []))
      })
      .catch((err) => alive && setError(err.message || 'Could not load the audit log.'))
    return () => { alive = false }
  }, [])

  if (error) return <PanelError message={error} />
  if (!rows) return <PanelLoading label="Loading audit log…" />

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            The most recent governed actions on this platform.
          </CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/audit-logs">Open the full log</Link>
        </Button>
      </CardHeader>
      <CardContent className="py-2">
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing recorded yet"
            description="Governed actions appear here as they happen."
          />
        ) : (
          <DataTable
            columns={auditColumns}
            data={rows}
            getRowId={(r) => r.id}
            searchAccessor={(r) =>
              `${r.actor ?? ''} ${r.action ?? ''} ${r.module ?? ''} ${r.summary ?? ''}`
            }
            searchPlaceholder="Search audit log…"
            pageSize={8}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Scoped keys for ZoikoAvail (MSA-41).
 *
 * There is no Reveal, and there cannot be: only the hash is stored, so a key
 * exists in the open exactly once. The fixture this replaces offered Reveal,
 * Rotate and Revoke, none of which had a handler.
 */
function ApiKeysPanel() {
  const [keys, setKeys] = useState(null)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState(null)
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState('availability')
  const [busy, setBusy] = useState(false)
  const [flashMsg, flash] = useFlash()

  const load = useCallback(async () => {
    try {
      setKeys(await listApiKeys())
    } catch (err) {
      setError(err?.message || 'Could not load API keys.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { apiKey } = await createApiKey({ label, scope })
      setIssued(apiKey)
      setLabel('')
      await load()
      flash('Key issued — copy it now, it is not shown again')
    } catch (err) {
      setError(err?.message || 'Could not issue a key.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id, name) => {
    if (!window.confirm(`Revoke "${name}"? Anything using it stops working immediately.`)) return
    setBusy(true)
    setError('')
    try {
      await revokeApiKey(id)
      await load()
      flash(`Revoked ${name}`)
    } catch (err) {
      setError(err?.message || 'Could not revoke the key.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !keys) return <PanelError message={error} />
  if (!keys) return <PanelLoading label="Loading API keys…" />

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Issue a key</CardTitle>
          <CardDescription>
            Scoped keys for ZoikoAvail™. Only a hash is stored, so a key is shown in full
            exactly once — there is no way to look one up later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flashMsg && <p className="pb-3 text-xs font-medium text-success">{flashMsg}</p>}
          {error && (
            <p role="alert" className="flex items-start gap-2 pb-3 text-xs font-medium text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor="key-label">Label</Label>
              <Input
                id="key-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Partner availability feed"
              />
            </div>
            <div className="flex min-w-40 flex-col gap-1.5">
              <Label htmlFor="key-scope">Scope</Label>
              <select
                id="key-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="availability">Availability</option>
                <option value="medibase">MediBase</option>
                <option value="signal">ZoikoSignal</option>
              </select>
            </div>
            <Button type="submit" size="sm" disabled={busy || label.trim().length < 2}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              <Plus className="size-4" />
              Create key
            </Button>
          </form>

          {issued && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/5 p-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TriangleAlert className="size-4 text-warning" aria-hidden />
                Copy this key now — it is not shown again
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {issued}
                </code>
                <CopyButton value={issued} label="Copy key" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issued keys</CardTitle>
          <CardDescription>Live keys first. Revoking one stops it immediately.</CardDescription>
        </CardHeader>
        <CardContent className="py-2">
          {keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No keys issued"
              description="Issue one above to let a partner system read availability."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{key.scope}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {key.prefix}…
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {/* An issued-and-forgotten key reads differently from one
                          carrying traffic, so the two are not both blank. */}
                      {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Never used'}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.status === 'revoked' ? (
                        <Badge variant="outline" size="sm">Revoked</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:bg-danger/5"
                          disabled={busy}
                          onClick={() => revoke(key.id, key.label)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Shared shells, so each panel says "loading" and "failed" the same way. */
function PanelLoading({ label }) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  )
}

function PanelError({ message }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
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
          <RolesPanel />
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <SecurityPanel />
        </TabsContent>

        {/* Audit log */}
        <TabsContent value="audit">
          <AuditPanel />
        </TabsContent>

        {/* API keys */}
        <TabsContent value="api-keys">
          <ApiKeysPanel />
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
