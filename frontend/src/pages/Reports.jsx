import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  FileDown,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { StatusBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import * as admin from '@/services/admin-api'
import { downloadJson } from '@/utils/export'

const STATUS_META = {
  READY: { tone: 'good', label: 'Ready' },
  SCHEDULED: { tone: 'serious', label: 'Scheduled' },
  RUNNING: { tone: 'warning', label: 'Running' },
  FAILED: { tone: 'critical', label: 'Failed' },
}
const TYPE_LABEL = {
  EXECUTIVE_BRIEFING: 'Executive briefing',
  REGIONAL_DIGEST: 'Regional digest',
  GOVERNANCE_EXPORT: 'Governance export',
  NETWORK_REPORT: 'Network report',
  OPERATIONS: 'Operations',
  DATA_QUALITY: 'Data quality',
  FORECAST: 'Forecast',
}
const SCOPE_LABEL = {
  ALL: 'All intelligence',
  SIGNAL: 'ZoikoSignal™',
  JURISDICTION: 'Jurisdictions',
  NETWORK: 'Partner network',
}

const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))
const FORMAT_OPTIONS = [
  { value: 'PDF', label: 'PDF · Executive briefing' },
  { value: 'CSV', label: 'CSV · Tabular export' },
  { value: 'XLSX', label: 'XLSX · Workbook' },
  { value: 'JSON', label: 'JSON · API payload' },
]
const SCOPE_OPTIONS = Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))

const EMPTY_FORM = { name: '', type: 'EXECUTIVE_BRIEFING', format: 'PDF', scope: 'ALL', schedule: '' }

/** Slugify a report name for the download filename. */
const slug = (name) => name.replace(/\s+/g, '-').toLowerCase()

/** Reports created in the current calendar month. */
function countThisMonth(rows) {
  const now = new Date()
  return rows.filter((r) => {
    const d = new Date(r.createdAt)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length
}

/** "Updated" cell: show the cadence for scheduled reports, else a timestamp. */
function updatedLabel(r) {
  if (r.status === 'SCHEDULED' && r.schedule) return r.schedule
  if (r.status === 'RUNNING') return 'Running…'
  return new Date(r.updatedAt).toLocaleString()
}

export default function Reports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [exportFormat, setExportFormat] = useState('PDF')
  const [exportScope, setExportScope] = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReports(await admin.listReports())
    } catch (err) {
      setError(err.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const scheduled = reports.filter((r) => r.status === 'SCHEDULED')
  const ready = reports.filter((r) => r.status === 'READY')

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    setError('')
    try {
      await admin.createReport({
        name: form.name.trim(),
        type: form.type,
        format: form.format,
        scope: form.scope,
        schedule: form.schedule.trim() || undefined,
      })
      setIsAddOpen(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to create report')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async (r) => {
    setError('')
    try {
      const payload = await admin.downloadReport(r.id)
      downloadJson(slug(r.name), payload)
    } catch (err) {
      setError(err.message || 'Failed to download report')
    }
  }

  const handleDuplicate = async (r) => {
    setError('')
    try {
      await admin.duplicateReport(r.id)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to duplicate report')
    }
  }

  const handleDelete = async (r) => {
    setError('')
    try {
      await admin.deleteReport(r.id)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to delete report')
    }
  }

  const handleGenerateExport = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await admin.createReport({
        name: `${SCOPE_LABEL[exportScope]} export · ${new Date().toLocaleDateString()}`,
        type: 'GOVERNANCE_EXPORT',
        format: exportFormat,
        scope: exportScope,
      })
      const payload = await admin.downloadReport(created.id)
      downloadJson(slug(created.name), payload)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to generate export')
    } finally {
      setBusy(false)
    }
  }

  const rowActions = (r) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Report actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleDownload(r)}>
          <Download />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleDuplicate(r)}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={() => handleDelete(r)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

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
    { key: 'type', header: 'Type', sortable: true, accessor: (r) => r.type, cell: (r) => TYPE_LABEL[r.type] || r.type },
    { key: 'owner', header: 'Owner' },
    { key: 'updated', header: 'Updated', cell: (r) => <span className="text-muted-foreground">{updatedLabel(r)}</span> },
    { key: 'format', header: 'Format', cell: (r) => <Badge variant="outline" size="sm">{r.format}</Badge> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      accessor: (r) => r.status,
      cell: (r) => {
        const meta = STATUS_META[r.status] || { tone: 'neutral', label: r.status }
        return (
          <StatusBadge tone={meta.tone} size="sm">
            {meta.label}
          </StatusBadge>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workspace"
        title="Reports"
        subtitle="Saved and scheduled reports, downloads, and governed exports across your workspace."
        breadcrumbs={[{ label: 'ZoikoMeds', to: '/admin/dashboard' }, { label: 'Reports' }]}
        actions={
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus />
            New report
          </Button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Saved reports" value={String(reports.length)} icon={FileText} />
        <StatTile label="Scheduled" value={String(scheduled.length)} icon={CalendarClock} severity="serious" />
        <StatTile label="Ready to download" value={String(ready.length)} icon={CheckCircle2} severity="good" />
        <StatTile label="Exports this month" value={String(countThisMonth(reports))} icon={FileDown} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading reports…
        </div>
      ) : (
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
                {ready.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No reports are ready to download yet.
                  </p>
                )}
                {ready.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.format} · updated {updatedLabel(r)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleDownload(r)}>
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
                    <Combobox options={FORMAT_OPTIONS} value={exportFormat} onChange={setExportFormat} className="w-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Scope</label>
                    <Combobox options={SCOPE_OPTIONS} value={exportScope} onChange={setExportScope} className="w-full" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <Button onClick={handleGenerateExport} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <FileDown />}
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
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>New report</DialogTitle>
            <DialogDescription>
              Generate a governed report. Add a schedule to run it on a recurring cadence.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Report name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Q3 Access-Resilience Briefing"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Format</label>
                <select
                  value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Scope</label>
                <select
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  {SCOPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  Schedule <span className="font-normal">(optional)</span>
                </label>
                <Input
                  value={form.schedule}
                  onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                  placeholder="e.g. Daily · 06:00"
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                Create report
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
