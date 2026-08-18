import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/pharmacy-api'
import { Boxes, BadgeCheck, UploadCloud, Server, Bell, Loader2, Check, AlertCircle } from 'lucide-react'

const TYPE_META = {
  inventory: { icon: Boxes, label: 'Inventory' },
  verification: { icon: BadgeCheck, label: 'Verification' },
  upload: { icon: UploadCloud, label: 'Uploads' },
  system: { icon: Server, label: 'System' },
}
const FILTERS = [{ value: 'all', label: 'All' }, ...Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label }))]

export default function PharmacyNotifications() {
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loadError, setLoadError] = useState('')

  const fetchItems = useCallback(async () => {
    try {
      const data = await getNotifications()
      setItems(data)
      setLoadError('')
    } catch (err) {
      // An empty list used to be shown for a failed request too, so an outage
      // read as "you're all caught up" — the most reassuring possible lie.
      setItems((current) => current ?? [])
      setLoadError(err.message || 'Could not load your notifications.')
    }
  }, [])

  useEffect(() => {
    fetchItems()

    const handleSync = () => fetchItems()
    window.addEventListener('broadcast-dispatched', handleSync)
    window.addEventListener('focus', handleSync)

    const interval = setInterval(handleSync, 10000)

    return () => {
      window.removeEventListener('broadcast-dispatched', handleSync)
      window.removeEventListener('focus', handleSync)
      clearInterval(interval)
    }
  }, [fetchItems])

  // Persisted, not just local: the refresh below re-reads the server every ten
  // seconds, so a local-only change came straight back as unread.
  const markRead = async (id) => {
    setItems((rows) => (rows || []).map((n) => (n.id === id ? { ...n, unread: false } : n)))
    try {
      await markNotificationRead(id)
    } catch {
      setItems((rows) => (rows || []).map((n) => (n.id === id ? { ...n, unread: true } : n)))
    }
  }

  const markAllRead = async () => {
    const previous = items
    setItems((rows) => (rows || []).map((n) => ({ ...n, unread: false })))
    try {
      await markAllNotificationsRead()
    } catch {
      setItems(previous)
    }
  }

  if (!items) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading notifications…
      </div>
    )
  }

  const visible = filter === 'all' ? items : items.filter((n) => n.type === filter)
  const unread = items.filter((n) => n.unread).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        subtitle="Inventory alerts, verification updates, upload results, and system messages."
        actions={
          unread > 0 && (
            <Button variant="outline" onClick={markAllRead}>
              <Check className="size-4" />
              Mark all read
            </Button>
          )
        }
      />

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={
              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
              (filter === f.value
                ? 'border-[#2563EB] bg-blue-50 text-[#2563EB] dark:bg-blue-950/50 dark:text-[#3B82F6]'
                : 'border-border bg-card text-muted-foreground hover:text-foreground')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Notifications could not be loaded</span>
            <span className="text-xs leading-relaxed text-foreground/90">{loadError}</span>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={filter === 'all' ? 'No notifications' : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} notifications`}
          description={
            loadError
              ? 'The list above could not be loaded, so this may not be everything.'
              : "You're all caught up."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.system
            const Icon = meta.icon
            return (
              <Card key={n.id} className={'flex items-start gap-3 p-4 ' + (n.unread ? 'border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20' : '')}>
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/50 text-[#2563EB] dark:text-[#3B82F6]">
                  <Icon className="size-4.5 text-[#2563EB] dark:text-[#3B82F6]" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{n.title}</span>
                    {n.unread && <span className="size-2 rounded-full bg-[#2563EB] dark:bg-[#3B82F6]" aria-label="Unread" />}
                  </div>
                  <span className="text-sm leading-relaxed text-muted-foreground">{n.message}</span>
                  <span className="mt-1 text-xs text-muted-foreground">{n.when}</span>
                </div>
                {n.unread && (
                  <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>Mark read</Button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
