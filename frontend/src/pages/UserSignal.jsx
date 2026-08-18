import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Heart, Bell, TrendingDown, PackageCheck, Radar, Search, CheckCheck, Inbox,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatTile } from '@/components/shared/stat-tile'
import { EmptyState } from '@/components/shared/states'
import { Flash, useFlash } from '@/components/shared/flash'
import { cn } from '@/lib/utils'
import { AlertCard } from '@/features/signal/alert-card'
import { SavedMedicineCard } from '@/features/signal/saved-medicine-card'
import { NotificationItem } from '@/features/signal/notification-item'
import { NotificationSettings } from '@/features/signal/notification-settings'
import { SignalStatSkeleton, AlertCardSkeleton, SavedMedicineSkeleton } from '@/features/signal/skeletons'
import { NOTIF_FILTERS } from '@/features/signal/signal-meta'
import { useSignalSavedStatus } from '@/hooks/use-saved-medicines'
import { useLanguage } from '@/providers/language-provider'
import {
  listSavedStatus, listActiveAlerts, listNotifications, getNotificationSettings,
  updateNotificationSettings, markRead, markAllRead, dismissNotification,
  archiveNotification, setMedicinePriority, SAFETY_TYPES,
} from '@/services/signal-api'

const PRIORITY_ORDER = ['high', 'medium', 'low']

function matchesFilter(n, key) {
  if (key === 'all') return true
  if (key === 'unread') return !n.read
  if (key === 'safety') return SAFETY_TYPES.includes(n.type)
  return n.type === key
}

export default function UserSignal() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [flashMsg, flash] = useFlash()

  const [saved, setSaved] = useState([])
  const [alerts, setAlerts] = useState([])
  const [notifications, setNotifications] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [savedQuery, setSavedQuery] = useState('')

  const { data: liveSavedStatus } = useSignalSavedStatus()

  useEffect(() => {
    if (liveSavedStatus) {
      setSaved(liveSavedStatus)
    }
  }, [liveSavedStatus])

  useEffect(() => {
    let alive = true
    Promise.all([listSavedStatus(), listActiveAlerts(), listNotifications()])
      .then(([s, a, n]) => {
        if (!alive) return
        setSaved(s)
        setAlerts(a)
        setNotifications(n)
      })
      .catch(() => alive && flash(t('signalLoadFailed', 'Could not load your ZoikoSignal™ data')))
      .finally(() => alive && setLoading(false))
    getNotificationSettings().then((x) => alive && setSettings(x)).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-computed stats stay in sync as items are dismissed / archived.
  const stats = useMemo(() => ({
    savedMedicines: saved.length,
    activeAlerts: alerts.length,
    runningLow: saved.filter((m) => ['running-low', 'out-of-stock'].includes(m.status)).length,
    backInStockToday: notifications.filter((n) => n.type === 'back-in-stock').length,
  }), [saved, alerts, notifications])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  const filteredNotifications = useMemo(
    () => notifications.filter((n) => matchesFilter(n, filter)),
    [notifications, filter],
  )

  const savedFiltered = useMemo(() => {
    const q = savedQuery.trim().toLowerCase()
    if (!q) return saved
    return saved.filter((m) => m.name.toLowerCase().includes(q) || m.generic.toLowerCase().includes(q))
  }, [saved, savedQuery])

  // ---- actions ----
  const goSearch = (term) => navigate(`/search?q=${encodeURIComponent(term)}`)

  const handleAction = (item) => {
    if (item.action?.kind === 'read') {
      flash(t('openingAdvisory', 'Opening advisory…'))
      return
    }
    if (item.action?.query) {
      goSearch(item.action.query)
      return
    }
    goSearch(item.medicineName || '')
  }

  const handleMarkAll = async () => {
    setNotifications((n) => n.map((x) => ({ ...x, read: true })))
    setAlerts([])
    try { await markAllRead() } catch { /* optimistic */ }
    flash(t('allMarkedRead', 'All notifications marked as read'))
  }

  const handleRead = async (id) => {
    setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read: !x.read } : x)))
    try { await markRead(id) } catch { /* optimistic */ }
  }

  const handleToggleRead = handleRead

  const handleArchive = async (id) => {
    setNotifications((n) => n.filter((x) => x.id !== id))
    try { await archiveNotification(id) } catch { /* optimistic */ }
    flash(t('notificationArchived', 'Notification archived'))
  }

  const handleDismiss = async (id) => {
    setNotifications((n) => n.filter((x) => x.id !== id))
    setAlerts((a) => a.filter((x) => x.id !== id))
    try { await dismissNotification(id) } catch { /* optimistic */ }
    flash(t('notificationDeleted', 'Notification deleted'))
  }

  const handleDelete = async (id) => {
    setNotifications((n) => n.filter((x) => x.id !== id))
    setAlerts((a) => a.filter((x) => x.id !== id))
    try { await dismissNotification(id) } catch { /* optimistic */ }
    flash(t('notificationDeleted', 'Notification deleted'))
  }

  const handleCyclePriority = async (med) => {
    const next = PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(med.priority) + 1) % PRIORITY_ORDER.length]
    setSaved((s) => s.map((m) => (m.id === med.id ? { ...m, priority: next } : m)))
    try { await setMedicinePriority(med.id, next) } catch { /* optimistic */ }
    flash(t('prioritySetNamed', '{name} set to {priority} priority', { name: med.name, priority: next }))
  }

  const handleToggleSetting = async (key) => {
    const next = !settings[key]
    setSettings((s) => ({ ...s, [key]: next }))
    try {
      await updateNotificationSettings({ [key]: next })
    } catch {
      setSettings((s) => ({ ...s, [key]: !next }))
      flash(t('prefUpdateFailed', 'Could not update preference'))
    }
  }

  const isEmpty = !loading && saved.length === 0

  const STAT_TILES = [
    { label: t('savedMedicines', 'Saved Medicines'), value: stats.savedMedicines, icon: Heart },
    { label: t('activeAlerts', 'Active Alerts'), value: stats.activeAlerts, icon: Bell, severity: 'serious' },
    { label: t('runningLow', 'Medicines Running Low'), value: stats.runningLow, icon: TrendingDown, severity: 'critical' },
    { label: t('backInStockToday', 'Back in Stock Today'), value: stats.backInStockToday, icon: PackageCheck, severity: 'good' },
  ]

  const translatedFilters = [
    { key: 'all', label: t('all', 'All') },
    { key: 'unread', label: t('unread', 'Unread') },
    { key: 'running-low', label: t('runningLow', 'Running Low') },
    { key: 'back-in-stock', label: t('backInStock', 'Back in Stock') },
    { key: 'safety', label: t('safetyAlerts', 'Safety Alerts') },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('myMedicines', 'My Medicines')}
        title={t('zoikoSignal', 'ZoikoSignal™')}
        subtitle={t('zoikoSignalSubtitle', 'Personalized medicine availability notifications for your saved medicines.')}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
              <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
              {t('liveMonitoring', 'Live monitoring')}
            </span>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleMarkAll}>
                <CheckCheck className="size-4" />
                {t('markAllRead', 'Mark all read')}
              </Button>
            )}
          </>
        }
      />

      {flashMsg && <Flash message={flashMsg} />}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SignalStatSkeleton key={i} />)
          : STAT_TILES.map((tTile) => (
              <StatTile key={tTile.label} label={tTile.label} value={tTile.value} icon={tTile.icon} severity={tTile.severity} />
            ))}
      </div>

      {isEmpty ? (
        <EmptyState
          icon={Heart}
          title={t('noSavedMedicinesYet', 'No saved medicines yet')}
          description={t('noSavedMedicinesDesc', 'Save a medicine from search or details page to track its availability confidence here.')}
          action={
            <Button onClick={() => navigate('/search')}>
              <Search className="size-4" />
              {t('searchMedicines', 'Search medicines')}
            </Button>
          }
        />
      ) : (
        <>
          {/* Active alerts */}
          <section className="flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <Radar className="size-4 text-primary" />
              {t('activeAlerts', 'Active alerts')}
            </h3>
            {loading ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <AlertCardSkeleton />
                <AlertCardSkeleton />
              </div>
            ) : alerts.length === 0 ? (
              <EmptyState
                icon={CheckCheck}
                title={t('allCaughtUp', "You're all caught up")}
                description={t('noUrgentAlerts', 'No urgent availability alerts for your saved medicines right now.')}
                className="py-10"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {alerts.map((a, i) => (
                    <AlertCard
                      key={a.id}
                      alert={a}
                      index={i}
                      onAction={handleAction}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Saved medicine status */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Heart className="size-4 text-teal" />
                {t('mySavedMedicines', 'MY SAVED MEDICINES')}
              </h3>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={savedQuery}
                  onChange={(e) => setSavedQuery(e.target.value)}
                  placeholder={t('searchSavedPlaceholder', 'Search saved medicines...')}
                  aria-label={t('searchSavedMedicinesLabel', 'Search saved medicines')}
                  className="h-9 rounded-lg ps-9"
                />
              </div>
            </div>
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => <SavedMedicineSkeleton key={i} />)}
              </div>
            ) : savedFiltered.length === 0 ? (
              <EmptyState icon={Search} title={t('noMatches', 'No matches')} description={t('noSavedMatchSearch', 'No saved medicines match your search.')} className="py-10" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {savedFiltered.map((med, i) => (
                    <SavedMedicineCard
                      key={med.id}
                      med={med}
                      index={i}
                      onQuickAction={goSearch}
                      onCyclePriority={handleCyclePriority}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Smart notifications */}
          <section className="flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <Bell className="size-4 text-primary" />
              {t('smartNotifications', 'SMART NOTIFICATIONS')}
            </h3>

            {/* filter tabs */}
            <div className="flex flex-wrap gap-1.5">
              {translatedFilters.map((f) => {
                const count = notifications.filter((n) => matchesFilter(n, f.key)).length
                const active = filter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      active
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f.label}
                    <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-primary/15' : 'bg-muted')}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {loading ? (
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <EmptyState icon={Inbox} title={t('nothingHere', 'Nothing here')} description={t('noNotificationsMatchFilter', 'No notifications match this filter.')} className="py-10" />
            ) : (
              <motion.div layout className="flex flex-col gap-2.5">
                <AnimatePresence mode="popLayout">
                  {filteredNotifications.map((n, i) => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      index={i}
                      onAction={handleAction}
                      onRead={handleRead}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </section>
        </>
      )}

      {/* Notification settings */}
      <div className="max-w-2xl">
        <NotificationSettings settings={settings} onToggle={handleToggleSetting} />
      </div>
    </div>
  )
}
