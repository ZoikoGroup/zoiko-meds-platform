import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'
import {
  getPatientNotifications,
  markPatientNotificationRead,
  markAllPatientNotificationsRead,
} from '@/services/patient-notifications-api'
import {
  Bell,
  Megaphone,
  TrendingUp,
  ShieldAlert,
  Server,
  Loader2,
  Check,
  ArrowRight,
} from 'lucide-react'

const TYPE_META = {
  announcement: { icon: Megaphone, label: 'Announcements' },
  stock: { icon: TrendingUp, label: 'Stock Alerts' },
  safety: { icon: ShieldAlert, label: 'Safety & Recalls' },
  system: { icon: Server, label: 'System' },
}

const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label })),
]

export default function UserNotifications() {
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  const fetchItems = useCallback(async () => {
    try {
      const data = await getPatientNotifications()
      setItems(data)
    } catch {
      setItems([])
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

  const handleMarkRead = async (item) => {
    setItems((rows) => (rows || []).map((n) => (n.id === item.id ? { ...n, unread: false } : n)))
    await markPatientNotificationRead(item)
    window.dispatchEvent(new CustomEvent('broadcast-dispatched'))
  }

  const handleMarkAllRead = async () => {
    setItems((rows) => (rows || []).map((n) => ({ ...n, unread: false })))
    await markAllPatientNotificationsRead(items || [])
    window.dispatchEvent(new CustomEvent('broadcast-dispatched'))
  }

  const handleActionClick = (item) => {
    if (item.unread) {
      handleMarkRead(item)
    }
    if (item.action?.query) {
      navigate(`/search?q=${encodeURIComponent(item.action.query)}`)
    } else if (item.type === 'stock' || item.subType) {
      navigate('/signal')
    }
  }

  if (!items) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" /> Loading notifications…
      </div>
    )
  }

  const visible = filter === 'all' ? items : items.filter((n) => n.type === filter)
  const unread = items.filter((n) => n.unread).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        subtitle="Platform updates, medicine safety alerts, stock availability notifications, and system messages."
        actions={
          unread > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead}>
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
              'rounded-full border px-3.5 py-1 text-xs font-semibold cursor-pointer transition-colors ' +
              (filter === f.value
                ? 'border-[#2563EB] bg-blue-50 text-[#2563EB] dark:bg-blue-950/50 dark:text-[#3B82F6] shadow-xs'
                : 'border-border bg-card text-muted-foreground hover:text-foreground')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="You are all caught up." />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.system
            const Icon = meta.icon
            return (
              <Card
                key={n.id}
                className={
                  'flex items-start gap-4 p-4.5 transition-all duration-200 ' +
                  (n.unread ? 'border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 shadow-xs' : 'hover:border-border/80')
                }
              >
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/50 text-[#2563EB] dark:text-[#3B82F6]">
                  <Icon className="size-5 text-[#2563EB] dark:text-[#3B82F6]" style={{ color: '#2563EB' }} />
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{n.title}</span>
                    {n.unread && (
                      <span className="size-2 rounded-full bg-[#2563EB] dark:bg-[#3B82F6]" aria-label="Unread" />
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{n.message}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/80">
                    <span>{n.when}</span>
                    {n.medicine && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-foreground">{n.medicine}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {n.action && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleActionClick(n)}
                      className="gap-1.5 text-xs font-semibold"
                    >
                      {n.action.label || 'View'}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  )}
                  {n.unread && !n.action && (
                    <Button variant="ghost" size="sm" onClick={() => handleMarkRead(n)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
