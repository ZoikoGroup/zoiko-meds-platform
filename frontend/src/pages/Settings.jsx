import { useEffect, useState } from 'react'
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
  listUsers,
} from '@/services/admin-api'
import { apiKeys, auditLogs, roleMatrix } from '@/services/ops-data'
import { useFlash } from '@/components/shared/flash'
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
 * What the platform actually enforces about sign-in (MSA-42).
 *
 * This was three switches — enforce MFA, SSO (SAML 2.0), IP allowlist — bound to
 * useState and nothing else, two of them on by default. None of the three exists
 * anywhere in this platform. Persisting them would have been the worse of the
 * two available fixes: a stored "MFA enforced" that no code reads is a control
 * an operator reports to an auditor and leans on during an incident.
 *
 * So there are no switches. The server reports the controls that are real, and
 * names the absent ones as absent rather than as switched off.
 */
function SecurityPanel() {
  const [controls, setControls] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getSecurityPosture()
      .then((rows) => alive && setControls(Array.isArray(rows) ? rows : []))
      .catch((err) => alive && setError(err.message || 'Could not load security settings.'))
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          Authentication and access controls for the workspace, as the server reports
          them. Each is set where it is decided — in configuration or in code — so
          none of them is switched on from this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {controls.map((c, i) => (
          <div key={c.id}>
            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Set by {c.configuredBy}
                </p>
              </div>
              <Badge variant={(TONE[c.state] ?? TONE['not-implemented']).variant} size="sm">
                {(TONE[c.state] ?? TONE['not-implemented']).label}
              </Badge>
            </div>
            {i < controls.length - 1 && <Separator />}
          </div>
        ))}
      </CardContent>
    </Card>
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
