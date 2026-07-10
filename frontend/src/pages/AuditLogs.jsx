import { useState, useMemo, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/data-table'
import { History, User, Loader2, AlertTriangle } from 'lucide-react'
import * as admin from '@/services/admin-api'

const SEVERITY_LABEL = {
  INFO: 'Info',
  WARNING: 'Warning',
  SECURITY_ALERT: 'Security Alert',
}
const SEVERITY_VARIANT = {
  INFO: 'default',
  WARNING: 'secondary',
  SECURITY_ALERT: 'destructive',
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [severityFilter, setSeverityFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await admin.listAuditLogs({ pageSize: 200 })
      setLogs(res.items)
    } catch (err) {
      setError(err.message || 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const modules = useMemo(
    () => Array.from(new Set(logs.map((l) => l.module).filter(Boolean))).sort(),
    [logs]
  )

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      const matchSeverity = severityFilter === 'All' || l.severity === severityFilter
      const matchModule = moduleFilter === 'All' || l.module === moduleFilter
      return matchSeverity && matchModule
    })
  }, [logs, severityFilter, moduleFilter])

  const columns = [
    {
      key: 'timestamp',
      header: 'Timestamp',
      sortable: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground tabular whitespace-nowrap">
          {new Date(row.timestamp).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Event Action',
      sortable: true,
      cell: (row) => (
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <History className="size-3.5 text-muted-foreground" />
          {row.action}
        </span>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      cell: (row) => (
        <Badge variant={SEVERITY_VARIANT[row.severity] || 'default'}>
          {SEVERITY_LABEL[row.severity] || row.severity}
        </Badge>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <User className="size-3.5 shrink-0" />
          {row.actor}
        </span>
      ),
    },
    {
      key: 'module',
      header: 'System Module',
      cell: (row) => <Badge variant="outline">{row.module}</Badge>,
    },
    {
      key: 'ip',
      header: 'IP Address',
      cell: (row) => (
        <code className="text-xs text-muted-foreground bg-muted px-1 rounded">{row.ip}</code>
      ),
    },
    {
      key: 'details',
      header: 'Log Summary Details',
      cell: (row) => (
        <span className="text-muted-foreground leading-normal">{row.details}</span>
      ),
    },
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={severityFilter}
        onChange={(e) => setSeverityFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Severities</option>
        <option value="INFO">Info Only</option>
        <option value="WARNING">Warnings</option>
        <option value="SECURITY_ALERT">Security Alerts</option>
      </select>

      <select
        value={moduleFilter}
        onChange={(e) => setModuleFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Modules</option>
        {modules.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs & Platform Timeline"
        description="Inspect administrative database operations, permission revisions, and authentication events."
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading audit trail…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredLogs}
              getRowId={(row) => row.id}
              searchable
              searchPlaceholder="Search audit trails by action or details..."
              searchAccessor={(row) => `${row.action} ${row.details} ${row.actor}`}
              toolbar={toolbar}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
