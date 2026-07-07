import { useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileDown,
  FileText,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { StatusBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { reports } from '@/services/ops-data'
import { downloadCsv, downloadJson } from '@/utils/export'

const REPORT_STATUS = {
  ready: { tone: 'good', label: 'Ready' },
  scheduled: { tone: 'serious', label: 'Scheduled' },
  running: { tone: 'warning', label: 'Running' },
  failed: { tone: 'critical', label: 'Failed' },
}

const scheduled = reports.filter((r) => r.status === 'scheduled')
const ready = reports.filter((r) => r.status === 'ready')

const FORMAT_OPTIONS = [
  { value: 'pdf', label: 'PDF · Executive briefing' },
  { value: 'csv', label: 'CSV · Tabular export' },
  { value: 'xlsx', label: 'XLSX · Workbook' },
  { value: 'json', label: 'JSON · API payload' },
]
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All intelligence' },
  { value: 'signal', label: 'ZoikoSignal™' },
  { value: 'jurisdiction', label: 'Jurisdictions' },
  { value: 'network', label: 'Partner network' },
]

function rowActions(r) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Report actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => downloadJson(r.name.replace(/\s+/g, '-').toLowerCase(), r)}>
          <Download />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem>
          <FileText />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns = [
  {
    key: 'name',
    header: 'Report',
    sortable: true,
    accessor: (r) => r.name,
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </span>
        <span className="font-medium">{r.name}</span>
      </span>
    ),
  },
  { key: 'type', header: 'Type', sortable: true },
  { key: 'owner', header: 'Owner' },
  { key: 'updated', header: 'Updated', cell: (r) => <span className="text-muted-foreground">{r.updated}</span> },
  { key: 'format', header: 'Format', cell: (r) => <Badge variant="outline" size="sm">{r.format}</Badge> },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    accessor: (r) => r.status,
    cell: (r) => (
      <StatusBadge tone={REPORT_STATUS[r.status].tone} size="sm">
        {REPORT_STATUS[r.status].label}
      </StatusBadge>
    ),
  },
]

export default function Reports() {
  const [format, setFormat] = useState('pdf')
  const [scope, setScope] = useState('all')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workspace"
        title="Reports"
        subtitle="Saved and scheduled reports, downloads, and governed exports across your workspace."
        breadcrumbs={[{ label: 'ZoikoMeds', to: '/dashboard' }, { label: 'Reports' }]}
        actions={
          <Button>
            <Plus />
            New report
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Saved reports" value={String(reports.length)} icon={FileText} />
        <StatTile label="Scheduled" value={String(scheduled.length)} icon={CalendarClock} severity="serious" />
        <StatTile label="Ready to download" value={String(ready.length)} icon={CheckCircle2} severity="good" />
        <StatTile label="Exports this month" value="128" icon={FileDown} />
      </div>

      <Tabs defaultValue="all">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="all">All reports</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="export">Export center</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all">
          <Card>
            <CardContent className="py-5">
              <DataTable
                columns={columns}
                data={reports}
                getRowId={(r) => r.id}
                searchAccessor={(r) => `${r.name} ${r.type} ${r.owner}`}
                searchPlaceholder="Search reports…"
                rowActions={rowActions}
                pageSize={8}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduled">
          <Card>
            <CardContent className="py-5">
              <DataTable
                columns={columns}
                data={scheduled}
                getRowId={(r) => r.id}
                searchable={false}
                rowActions={rowActions}
                pageSize={8}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="downloads">
          <Card>
            <CardContent className="flex flex-col divide-y divide-border py-2">
              {ready.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.format} · updated {r.updated}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadJson(r.name.replace(/\s+/g, '-').toLowerCase(), r)}
                  >
                    <Download />
                    Download
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle>Export center</CardTitle>
              <CardDescription>
                Generate a governed, aggregate-only export. No PHI or exact stock is
                ever included.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Format</label>
                  <Combobox options={FORMAT_OPTIONS} value={format} onChange={setFormat} className="w-full" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Scope</label>
                  <Combobox options={SCOPE_OPTIONS} value={scope} onChange={setScope} className="w-full" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button onClick={() => downloadCsv('zoikomeds-export', reports)}>
                  <FileDown />
                  Generate export
                </Button>
                <p className="text-xs text-muted-foreground">
                  Exports are audit-logged and scoped to your role and jurisdiction.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
