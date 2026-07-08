import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Blocks,
  Building2,
  CreditCard,
  KeyRound,
  MoreHorizontal,
  Plus,
  ScrollText,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
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
import { Check, Minus } from 'lucide-react'
import { apiKeys, auditLogs, billingSummary, integrations, roleMatrix, users } from '@/services/ops-data'
import { useAuth } from '@/providers/auth-provider'
import { initials } from '@/utils/format'

const ROLE_VARIANT = {
  Owner: 'default',
  Admin: 'teal',
  Analyst: 'secondary',
  Viewer: 'outline',
  Auditor: 'info',
}
const USER_STATUS = {
  active: { tone: 'good', label: 'Active' },
  invited: { tone: 'serious', label: 'Invited' },
  suspended: { tone: 'critical', label: 'Suspended' },
}
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

const userColumns = [
  {
    key: 'name',
    header: 'Member',
    sortable: true,
    accessor: (r) => r.name,
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <Avatar className="size-8">
          <AvatarFallback>{initials(r.name)}</AvatarFallback>
        </Avatar>
        <span className="flex flex-col">
          <span className="font-medium">{r.name}</span>
          <span className="text-xs text-muted-foreground">{r.email}</span>
        </span>
      </span>
    ),
  },
  { key: 'role', header: 'Role', sortable: true, cell: (r) => <Badge variant={ROLE_VARIANT[r.role]} size="sm">{r.role}</Badge> },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    accessor: (r) => r.status,
    cell: (r) => <StatusBadge tone={USER_STATUS[r.status].tone} size="sm">{USER_STATUS[r.status].label}</StatusBadge>,
  },
  { key: 'lastActive', header: 'Last active', cell: (r) => <span className="text-muted-foreground">{r.lastActive}</span> },
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

export default function Settings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'organization'
  const setTab = (v) =>
    setSearchParams(v === 'organization' ? {} : { tab: v }, { replace: true })

  const [mfa, setMfa] = useState(true)
  const [sso, setSso] = useState(true)
  const [ipAllow, setIpAllow] = useState(false)

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
                <Input id="org-name" defaultValue="Meridian Health Network" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-id">Workspace ID</Label>
                <Input id="org-id" defaultValue="org-meridian" disabled />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-region">Data residency region</Label>
                <Input id="org-region" defaultValue="North America (us-east)" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-type">Organization type</Label>
                <Input id="org-type" defaultValue="Health System" />
              </div>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button variant="ghost">Cancel</Button>
              <Button>Save changes</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Members</CardTitle>
                <CardDescription>People with access to this workspace.</CardDescription>
              </div>
              <Button size="sm">
                <Plus />
                Invite member
              </Button>
            </CardHeader>
            <CardContent className="py-2">
              <DataTable
                columns={userColumns}
                data={users}
                getRowId={(r) => r.id}
                searchAccessor={(r) => `${r.name} ${r.email} ${r.role}`}
                searchPlaceholder="Search members…"
                pageSize={8}
                rowActions={() =>
                  actionsMenu([
                    { label: 'Edit role' },
                    { label: 'Resend invite' },
                    '---',
                    { label: 'Remove member', danger: true },
                  ])
                }
              />
            </CardContent>
          </Card>
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
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>
                Authentication and access controls for the workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {[
                { label: 'Enforce multi-factor authentication', desc: 'Require MFA for all members on every sign-in.', checked: mfa, set: setMfa },
                { label: 'SSO (SAML 2.0)', desc: 'Single sign-on via your identity provider (Okta).', checked: sso, set: setSso },
                { label: 'IP allowlist', desc: 'Restrict access to approved network ranges.', checked: ipAllow, set: setIpAllow },
              ].map((s, i, arr) => (
                <div key={s.label}>
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                    </div>
                    <Switch checked={s.checked} onCheckedChange={s.set} aria-label={s.label} />
                  </div>
                  {i < arr.length - 1 && <Separator />}
                </div>
              ))}
            </CardContent>
          </Card>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {integrations.map((it) => (
              <Card key={it.id} className="gap-3 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-xs font-semibold">
                      {initials(it.name)}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{it.name}</p>
                      <p className="text-xs text-muted-foreground">{it.category}</p>
                    </div>
                  </div>
                  <ServiceStatusBadge status={it.status} size="sm" />
                </div>
                <div className="flex items-center justify-between border-t border-border/70 pt-3">
                  <span className="text-xs text-muted-foreground">
                    Synced {it.lastSync}
                  </span>
                  <Button variant="outline" size="sm">
                    Manage
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Plan</CardTitle>
                <CardDescription>Current subscription.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-semibold tracking-tight">
                    {billingSummary.plan}
                  </span>
                  <Badge variant="default" size="sm">
                    Active
                  </Badge>
                </div>
                <dl className="flex flex-col gap-2 text-sm">
                  {[
                    ['Seats', billingSummary.seats],
                    ['API tier', billingSummary.apiTier],
                    ['Renews', billingSummary.renewal],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">API usage this cycle</span>
                    <span className="font-medium tabular">{billingSummary.usageThisCycle}%</span>
                  </div>
                  <Progress value={billingSummary.usageThisCycle} className="h-1.5" />
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button className="flex-1">Manage plan</Button>
              </CardFooter>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
                <CardDescription>Billing history.</CardDescription>
              </CardHeader>
              <CardContent className="py-2">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Invoice</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingSummary.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.id}</TableCell>
                        <TableCell>{inv.period}</TableCell>
                        <TableCell className="text-right tabular">{inv.amount}</TableCell>
                        <TableCell className="text-right">
                          <StatusBadge tone="good" size="sm">
                            {inv.status}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
