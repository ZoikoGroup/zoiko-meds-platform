import { useState, useMemo } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import { History, ShieldAlert, CheckCircle2, User, Key, Globe, Search } from 'lucide-react'

const initialLogs = [
  { id: '1', timestamp: '2025-07-09 11:32:01', action: 'API Key Rotated', actor: 'Atlas BioSupply Partner', module: 'Access Controls', severity: 'Info', ip: '198.51.100.22', details: 'Rotated key ID ending ...8f91' },
  { id: '2', timestamp: '2025-07-09 10:14:48', action: 'Verification Approved', actor: 'Dr. Amara Okafor', module: 'Compliance', severity: 'Info', ip: '203.0.113.88', details: 'Approved licensing docs for Tokyo Central Dispensary' },
  { id: '3', timestamp: '2025-07-09 09:42:15', action: 'Failed Admin Login', actor: 'unknown (attempted: admin@zoikomeds.io)', module: 'Authentication', severity: 'Security Alert', ip: '45.223.19.102', details: 'Repeated bad password attempts from unauthorized geolocation' },
  { id: '4', timestamp: '2025-07-09 08:21:55', action: 'Inventory Sync Fail', actor: 'Apex Meds Supply System', module: 'Inventory', severity: 'Warning', ip: '192.0.2.55', details: 'API payload format validation mismatch on strength field' },
  { id: '5', timestamp: '2025-07-08 17:05:12', action: 'User Suspended', actor: 'Naveen Kumar', module: 'Access Controls', severity: 'Warning', ip: '203.0.113.89', details: 'Suspended credentials for Clara Dupont (contract expired)' },
  { id: '6', timestamp: '2025-07-08 14:12:33', action: 'Database Snapshot', actor: 'Cron System Tasks', module: 'System Admin', severity: 'Info', ip: 'local-loopback', details: 'Successfully backed up primary cluster postgresql instance (Size: 4.8 GB)' }
]

export default function AuditLogs() {
  const [logs] = useState(initialLogs)
  const [severityFilter, setSeverityFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')

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
      cell: (row) => <span className="text-xs text-muted-foreground tabular">{row.timestamp}</span>
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
      )
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      cell: (row) => {
        const variant = row.severity === 'Security Alert' ? 'destructive' : row.severity === 'Warning' ? 'secondary' : 'default'
        return <Badge variant={variant}>{row.severity}</Badge>
      }
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <User className="size-3.5 shrink-0" />
          {row.actor}
        </span>
      )
    },
    {
      key: 'module',
      header: 'System Module',
      cell: (row) => <Badge variant="outline">{row.module}</Badge>
    },
    {
      key: 'ip',
      header: 'IP Address',
      cell: (row) => <code className="text-xs text-muted-foreground bg-muted px-1 rounded">{row.ip}</code>
    },
    {
      key: 'details',
      header: 'Log Summary Details',
      cell: (row) => <span className="text-muted-foreground leading-normal">{row.details}</span>
    }
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {/* Severity Filter */}
      <select
        value={severityFilter}
        onChange={(e) => setSeverityFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Severities</option>
        <option value="Info">Info Only</option>
        <option value="Warning">Warnings</option>
        <option value="Security Alert">Security Alerts</option>
      </select>

      {/* Module Filter */}
      <select
        value={moduleFilter}
        onChange={(e) => setModuleFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Modules</option>
        <option value="Authentication">Authentication</option>
        <option value="Compliance">Compliance</option>
        <option value="Access Controls">Access Controls</option>
        <option value="Inventory">Inventory</option>
        <option value="System Admin">System Admin</option>
      </select>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs & Platform Timeline"
        description="Inspect administrative database operations, permission revisions, and authentication events."
      />

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filteredLogs}
            getRowId={(row) => row.id}
            searchable
            searchPlaceholder="Search audit trails by action or details..."
            searchAccessor={(row) => `${row.action} ${row.details} ${row.actor}`}
            toolbar={toolbar}
          />
        </CardContent>
      </Card>
    </div>
  )
}
