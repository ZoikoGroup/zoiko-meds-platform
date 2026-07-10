import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Bell, Plus, Trash, Loader2, AlertTriangle } from 'lucide-react'
import * as admin from '@/services/admin-api'

const TYPE_LABEL = {
  PLATFORM_UPDATE: 'Platform Update',
  MAINTENANCE: 'Maintenance',
  EMERGENCY_ALERT: 'Emergency Alert',
  SYSTEM_ANNOUNCEMENT: 'System Announcement',
}
const TYPE_VARIANT = {
  EMERGENCY_ALERT: 'destructive',
  MAINTENANCE: 'secondary',
  PLATFORM_UPDATE: 'default',
  SYSTEM_ANNOUNCEMENT: 'default',
}
const TARGET_LABEL = {
  ALL_USERS: 'All Users',
  PHARMACY_MANAGERS: 'Pharmacy Managers',
  ENTERPRISE_ADMINS: 'Enterprise Admins',
  GOVERNMENT_PARTNERS: 'Government Partners',
}

export default function Notifications() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    message: '',
    type: 'PLATFORM_UPDATE',
    target: 'ALL_USERS',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setNotifications(await admin.listNotifications())
    } catch (err) {
      setError(err.message || 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleBroadcast = async (e) => {
    e.preventDefault()
    if (!form.title || !form.message) return
    try {
      await admin.createNotification(form)
      setIsAddOpen(false)
      setForm({ title: '', message: '', type: 'PLATFORM_UPDATE', target: 'ALL_USERS' })
      await load()
    } catch (err) {
      setError(err.message || 'Failed to dispatch broadcast')
    }
  }

  const handleDelete = async (id) => {
    try {
      await admin.deleteNotification(id)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to delete broadcast')
    }
  }

  const columns = [
    {
      key: 'title',
      header: 'Announcement Title',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Bell className="size-4 text-muted-foreground shrink-0" />
          <span>{row.title}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Category',
      sortable: true,
      cell: (row) => (
        <Badge variant={TYPE_VARIANT[row.type] || 'default'}>
          {TYPE_LABEL[row.type] || row.type}
        </Badge>
      ),
    },
    {
      key: 'target',
      header: 'Target Audience',
      cell: (row) => (
        <span className="text-muted-foreground">{TARGET_LABEL[row.target] || row.target}</span>
      ),
    },
    {
      key: 'status',
      header: 'Dispatch Status',
      sortable: true,
      cell: (row) => (
        <Badge
          variant={row.status === 'DISPATCHED' ? 'default' : 'outline'}
          className={row.status === 'DISPATCHED' ? 'bg-success text-white' : ''}
        >
          {row.status === 'DISPATCHED' ? 'Dispatched' : 'Draft'}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: 'Broadcast Date',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.date).toLocaleDateString()}
        </span>
      ),
    },
  ]

  const toolbar = (
    <Button
      size="sm"
      onClick={() => setIsAddOpen(true)}
      className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center"
    >
      <Plus className="size-3.5" />
      Compose Broadcast
    </Button>
  )

  const rowActions = (row) => (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-danger"
      onClick={() => handleDelete(row.id)}
      title="Delete Broadcast"
    >
      <Trash className="size-4" />
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications & Announcements"
        description="Broadcast security policies, alert channels, maintenance schedules, and platform status changes."
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
              <Loader2 className="size-4 animate-spin" /> Loading broadcasts…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={notifications}
              getRowId={(row) => row.id}
              searchable
              searchPlaceholder="Search broadcasts by title..."
              searchAccessor={(row) => `${row.title} ${row.message}`}
              toolbar={toolbar}
              rowActions={rowActions}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Compose Broadcast Announcement</DialogTitle>
            <DialogDescription>
              Transmit a system broadcast across the platform client layers.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBroadcast} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Broadcast Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Critical SSO Maintenance Window"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Alert Channel Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Target Recipient Group</label>
                <select
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  {Object.entries(TARGET_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Broadcast Message Body</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Compose announcement detailed messaging text..."
                rows={4}
                className="w-full rounded-lg border border-border bg-card p-3 text-xs text-foreground outline-none focus:border-primary resize-none"
                required
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Dispatch Broadcast</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
