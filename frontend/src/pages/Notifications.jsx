import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Bell, Send, AlertTriangle, ShieldCheck, Mail, ShieldAlert, Sparkles, Plus, Trash } from 'lucide-react'

const initialNotifications = [
  { id: '1', title: 'System Maintenance Window', message: 'Platform will undergo standard database upgrades on Saturday from 02:00 to 04:00 UTC.', type: 'Maintenance', target: 'All Users', status: 'Dispatched', date: '2025-07-08' },
  { id: '2', title: 'Critical Stock Level: APAC', message: 'Upstream supply chains report a 22% latency on critical cardiovascular distributions.', type: 'Emergency Alert', target: 'Pharmacy Managers', status: 'Dispatched', date: '2025-07-07' },
  { id: '3', title: 'SSO Protocol Update', message: 'OAuth2 configuration sync required for all federated pharmacy identities by next week.', type: 'Platform Update', target: 'Enterprise Admins', status: 'Draft', date: '2025-07-06' },
  { id: '4', title: 'New Licensing Policy Enacted', message: 'National Health Directorate enforces strict digital document checks for wholesale verification.', type: 'System Announcement', target: 'All Users', status: 'Dispatched', date: '2025-07-04' }
]

export default function Notifications() {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', type: 'Platform Update', target: 'All Users' })

  const handleBroadcast = (e) => {
    e.preventDefault()
    if (!form.title || !form.message) return
    const newAlert = {
      id: String(notifications.length + 1),
      ...form,
      status: 'Dispatched',
      date: new Date().toISOString().split('T')[0]
    }
    setNotifications((prev) => [newAlert, ...prev])
    setIsAddOpen(false)
    setForm({ title: '', message: '', type: 'Platform Update', target: 'All Users' })
  }

  const handleDelete = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
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
      )
    },
    {
      key: 'type',
      header: 'Category',
      sortable: true,
      cell: (row) => {
        const severity = row.type === 'Emergency Alert' ? 'destructive' : row.type === 'Maintenance' ? 'secondary' : 'default'
        return <Badge variant={severity}>{row.type}</Badge>
      }
    },
    {
      key: 'target',
      header: 'Target Audience',
      cell: (row) => <span className="text-muted-foreground">{row.target}</span>
    },
    {
      key: 'status',
      header: 'Dispatch Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={row.status === 'Dispatched' ? 'default' : 'outline'} className={row.status === 'Dispatched' ? 'bg-success text-white' : ''}>
          {row.status}
        </Badge>
      )
    },
    {
      key: 'date',
      header: 'Broadcast Date',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.date}</span>
    }
  ]

  const toolbar = (
    <Button size="sm" onClick={() => setIsAddOpen(true)} className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center">
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

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
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
        </CardContent>
      </Card>

      {/* Broadcast Dialog */}
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
                  <option value="Platform Update">Platform Update</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Emergency Alert">Emergency Alert</option>
                  <option value="System Announcement">System Announcement</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Target Recipient Group</label>
                <select
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="All Users">All Users</option>
                  <option value="Pharmacy Managers">Pharmacy Managers</option>
                  <option value="Enterprise Admins">Enterprise Admins</option>
                  <option value="Government Partners">Government Partners</option>
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
