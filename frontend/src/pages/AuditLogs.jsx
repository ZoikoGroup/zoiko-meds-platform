import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/data-table'
import { History, User, Loader2, AlertTriangle, Calendar } from 'lucide-react'
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

function formatLogDetails(row) {
  if (!row.details) return '—'

  let data = null
  if (typeof row.details === 'object') {
    data = row.details
  } else if (typeof row.details === 'string') {
    const trimmed = row.details.trim()
    if (!trimmed) return '—'
    try {
      data = JSON.parse(trimmed)
    } catch {
      return row.details
    }
  }

  if (!data || typeof data !== 'object') return String(row.details || '—')

  // Authentication actions
  if (row.action === 'auth.login' || data.action === 'Login') {
    const email = data.userEmail || data.attemptedEmail || 'User'
    const role = data.userRole ? ` (${data.userRole})` : ''
    const ua = data.userAgent ? ` • ${data.userAgent.slice(0, 40)}` : ''
    return `Logged in successfully: ${email}${role}${ua}`
  }

  if (row.action === 'auth.login_failed' || data.action === 'Failed Login') {
    const email = data.userEmail || data.attemptedEmail || 'Unknown user'
    const reason = data.reason ? ` (${data.reason})` : ''
    return `Failed login attempt for ${email}${reason}`
  }

  if (row.action === 'auth.logout' || data.action === 'Logout') {
    const email = data.userEmail || 'User'
    return `User logged out: ${email}`
  }

  if (row.action === 'auth.register' || data.action === 'Register') {
    const email = data.userEmail || 'User'
    return `New user account registered: ${email}`
  }

  if (row.action === 'auth.change_password' || data.action === 'Password Change') {
    const email = data.userEmail || 'User'
    return `Changed account password: ${email}`
  }

  if (row.action === 'auth.forgot_password' || data.action === 'Password Reset Request') {
    const email = data.userEmail || 'User'
    return `Password reset requested for ${email}`
  }

  if (row.action === 'auth.reset_password' || data.action === 'Password Reset Complete') {
    const email = data.userEmail || 'User'
    return `Password reset completed for ${email}`
  }

  // Inventory actions
  if (row.action === 'pharmacy.inventory.create' || data.action === 'Create') {
    const name = data.medicineName || 'Medicine'
    const str = data.strength ? ` (${data.strength})` : ''
    const pharm = data.pharmacyName ? ` at ${data.pharmacyName}` : ''
    const status = data.newValues?.status ? ` • Status: ${data.newValues.status}` : ''
    return `Added ${name}${str}${pharm}${status}`
  }

  if (row.action === 'pharmacy.inventory.update' || data.action === 'Update') {
    const name = data.medicineName || 'Inventory item'
    const prev = data.previousValues?.status ? ` [was: ${data.previousValues.status}]` : ''
    const newStatus = data.newValues?.status || data.status || ''
    const pharm = data.pharmacyName ? ` (${data.pharmacyName})` : ''
    return `Updated ${name}${pharm} status to ${newStatus}${prev}`
  }

  if (row.action === 'pharmacy.inventory.delete' || data.action === 'Delete') {
    const name = data.medicineName || 'Inventory item'
    const pharm = data.pharmacyName ? ` from ${data.pharmacyName}` : ''
    return `Deleted ${name}${pharm}`
  }

  if (row.action === 'pharmacy.inventory.import' || data.action === 'Import') {
    const imported = data.imported ?? 0
    const updated = data.updated ?? 0
    const pharm = data.pharmacyName ? ` for ${data.pharmacyName}` : ''
    return `Imported CSV${pharm}: ${imported} added, ${updated} updated`
  }

  // Role changes
  if (data.to && data.from) {
    return `Role changed from ${data.from} → ${data.to}`
  }
  if (data.to) {
    return `Role updated to ${data.to}`
  }

  // Bulk actions
  if (data.status && Array.isArray(data.ids)) {
    const count = data.ids.length
    return `Bulk action on ${count} ${count === 1 ? 'item' : 'items'} (Status: ${data.status})`
  }

  // Pharmacy / Entity status changes
  if (data.pharmacy && data.status) {
    return `${data.pharmacy} — Status set to ${data.status}`
  }

  // User creation / modification
  if (data.email && data.role) {
    return `Created user ${data.email} (${data.role})`
  }
  if (data.email) {
    return `Target email: ${data.email}`
  }

  // Generic fallback format
  const keys = Object.keys(data)
  if (keys.length === 0) return '—'

  return keys
    .map((k) => {
      const val = data[k]
      const label = k.replace(/([A-Z])/g, ' $1').toLowerCase()
      if (Array.isArray(val)) return `${label}: ${val.length} items`
      if (typeof val === 'object' && val !== null) return `${label}: ${JSON.stringify(val)}`
      return `${label}: ${val}`
    })
    .join(' · ')
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [severityFilter, setSeverityFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')
  const [actionFilter, setActionFilter] = useState('All')
  const [userFilter, setUserFilter] = useState('')
  const [pharmacyFilter, setPharmacyFilter] = useState('')
  const [debouncedUserFilter, setDebouncedUserFilter] = useState('')
  const [debouncedPharmacyFilter, setDebouncedPharmacyFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUserFilter(userFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [userFilter])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedPharmacyFilter(pharmacyFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [pharmacyFilter])

  const load = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoading(true)
    }
    setError('')
    try {
      const params = { pageSize: 200 }
      if (moduleFilter !== 'All') params.module = moduleFilter
      if (severityFilter !== 'All') params.severity = severityFilter
      if (actionFilter !== 'All') params.action = actionFilter
      if (debouncedUserFilter.trim()) params.user = debouncedUserFilter.trim()
      if (debouncedPharmacyFilter.trim()) params.pharmacy = debouncedPharmacyFilter.trim()
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate

      const res = await admin.listAuditLogs(params)
      setLogs(res.items || [])
    } catch (err) {
      setError(err.message || 'Failed to load audit logs')
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }, [severityFilter, moduleFilter, actionFilter, debouncedUserFilter, debouncedPharmacyFilter, startDate, endDate])

  const initialLoaded = useRef(false)
  useEffect(() => {
    if (!initialLoaded.current) {
      initialLoaded.current = true
      load(true)
    } else {
      load(false)
    }
  }, [load])

  const modules = useMemo(() => {
    const set = new Set(['Authentication', 'Inventory', 'Pharmacy', 'User', 'System Admin', 'ZoikoSignal', 'Medicine'])
    logs.forEach((l) => {
      if (l.module) set.add(l.module)
    })
    return Array.from(set).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      const matchSeverity = severityFilter === 'All' || l.severity === severityFilter
      const matchModule = moduleFilter === 'All' || l.module?.toLowerCase() === moduleFilter.toLowerCase()
      const matchAction =
        actionFilter === 'All' ||
        l.action?.toLowerCase().includes(actionFilter.toLowerCase()) ||
        l.details?.toLowerCase().includes(actionFilter.toLowerCase())

      const matchUser =
        !userFilter.trim() ||
        l.actor?.toLowerCase().includes(userFilter.toLowerCase()) ||
        l.details?.toLowerCase().includes(userFilter.toLowerCase())

      const matchPharmacy =
        !pharmacyFilter.trim() ||
        l.details?.toLowerCase().includes(pharmacyFilter.toLowerCase()) ||
        l.summary?.toLowerCase().includes(pharmacyFilter.toLowerCase())

      const logDate = new Date(l.timestamp).getTime()
      const matchStart = !startDate || logDate >= new Date(startDate).getTime()
      const matchEnd = !endDate || logDate <= new Date(`${endDate}T23:59:59`).getTime()

      return matchSeverity && matchModule && matchAction && matchUser && matchPharmacy && matchStart && matchEnd
    })
  }, [logs, severityFilter, moduleFilter, actionFilter, userFilter, pharmacyFilter, startDate, endDate])

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
        <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
          <History className="size-3.5 text-muted-foreground shrink-0" />
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
      header: 'Actor / User',
      cell: (row) => (
        <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
          <User className="size-3.5 shrink-0" />
          {row.actor}
        </span>
      ),
    },
    {
      key: 'module',
      header: 'System Module',
      cell: (row) => (
        <Badge variant={row.module === 'Inventory' ? 'secondary' : 'outline'}>
          {row.module}
        </Badge>
      ),
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
      cell: (row) => {
        const text = row.summary || formatLogDetails(row)
        return (
          <span className="text-xs font-medium text-foreground leading-normal" title={row.details || undefined}>
            {text}
          </span>
        )
      },
    },
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Module filter */}
      <div className="flex items-center gap-1">
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary font-medium"
        >
          <option value="All">All Modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Action filter */}
      <select
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary font-medium"
      >
        <option value="All">All Actions</option>
        <option value="Create">Create</option>
        <option value="Update">Update</option>
        <option value="Delete">Delete</option>
        <option value="Import">Import</option>
      </select>

      {/* Severity filter */}
      <select
        value={severityFilter}
        onChange={(e) => setSeverityFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary font-medium"
      >
        <option value="All">All Severities</option>
        <option value="INFO">Info Only</option>
        <option value="WARNING">Warnings</option>
        <option value="SECURITY_ALERT">Security Alerts</option>
      </select>

      {/* User filter input */}
      <input
        type="text"
        placeholder="Filter by user..."
        value={userFilter}
        onChange={(e) => setUserFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary w-32 md:w-40"
      />

      {/* Pharmacy filter input */}
      <input
        type="text"
        placeholder="Filter by pharmacy..."
        value={pharmacyFilter}
        onChange={(e) => setPharmacyFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary w-32 md:w-40"
      />

      {/* Date range filters */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="size-3.5 shrink-0" />
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          title="Start Date"
        />
        <span>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          title="End Date"
        />
      </div>

      {(moduleFilter !== 'All' ||
        actionFilter !== 'All' ||
        severityFilter !== 'All' ||
        userFilter ||
        pharmacyFilter ||
        startDate ||
        endDate) && (
        <button
          onClick={() => {
            setModuleFilter('All')
            setActionFilter('All')
            setSeverityFilter('All')
            setUserFilter('')
            setPharmacyFilter('')
            setStartDate('')
            setEndDate('')
          }}
          className="text-xs text-primary hover:underline font-medium px-1"
        >
          Reset filters
        </button>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs & Platform Timeline"
        description="Inspect administrative database operations, inventory modifications, permission revisions, and system events."
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
              searchPlaceholder="Search audit trails by action, user, pharmacy or details..."
              searchAccessor={(row) => `${row.action} ${row.details} ${row.actor} ${row.module} ${row.summary}`}
              toolbar={toolbar}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

