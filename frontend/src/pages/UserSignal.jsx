import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Heart, Bell, TrendingDown, PackageCheck, Radar, Search, CheckCheck, Inbox,
  AlertCircle, ChevronLeft, ChevronRight,
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
  archiveNotification, setMedicinePriority, NOTIFICATIONS_PAGE_SIZE,
} from '@/services/signal-api'

const PRIORITY_ORDER = ['high', 'medium', 'low']

/**
 * An empty page, and what the chips say about a set that has nothing in it.
 *
 * The counts still come from the server here, so a failed or not-yet-finished
 * load reads as zeros rather than as stale numbers from the last filter.
 */
const EMPTY_PAGE = {
  items: [],
  page: 1,
  pageCount: 1,
  total: 0,
  counts: { all: 0, unread: 0, 'running-low': 0, 'back-in-stock': 0, safety: 0 },
}

/**
 * Read a response as a page.
 *
 * An API build that predates pagination answers with a bare array. Spreading
 * that into the page object would produce an empty list and a silent, blank
 * section, so it is read as the single page it is — which is what it means, and
 * what keeps a rolling deploy from showing nobody their notifications.
 */
function asPage(res) {
  if (Array.isArray(res)) {
    return {
      ...EMPTY_PAGE,
      items: res,
      total: res.length,
      counts: {
        all: res.length,
        unread: res.filter((n) => !n.read).length,
        'running-low': res.filter((n) => n.type === 'running-low').length,
        'back-in-stock': res.filter((n) => n.type === 'back-in-stock').length,
        safety: res.filter((n) => ['recall', 'safety'].includes(n.type)).length,
      },
    }
  }
  return { ...EMPTY_PAGE, ...res }
}

/**
 * What an empty list means, per chip.
 *
 * "No notifications match this filter" was the same sentence under every chip,
 * which reads as a search that failed rather than as the good news it usually
 * is — nothing has been recalled, nothing has run low. Each chip says its own
 * thing instead.
 */
const EMPTY_BY_FILTER = {
  all: ['noNotificationsYet', 'No notifications yet', 'noNotificationsYetDesc',
    'When a saved medicine changes availability, it shows up here.'],
  // Its own key and its own words: the active-alerts section above already
  // says "You're all caught up" under `allCaughtUp`, and two identical panels
  // on one screen read as a rendering fault rather than as good news.
  unread: ['noUnreadNotifications', 'No unread notifications', 'noUnreadNotificationsDesc',
    'Everything here has been read.'],
  'running-low': ['noRunningLowYet', 'No running-low notifications yet', 'noRunningLowYetDesc',
    'Nothing you follow is running low across the verified network.'],
  'back-in-stock': ['noBackInStockYet', 'No back-in-stock notifications yet', 'noBackInStockYetDesc',
    'When something you follow is stocked again, it shows up here.'],
  safety: ['noSafetyAlertsYet', 'No safety alerts yet', 'noSafetyAlertsYetDesc',
    'No recalls or safety advisories affect the medicines you follow.'],
}

export default function UserSignal() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [flashMsg, flash] = useFlash()

  const [saved, setSaved] = useState([])
  const [alerts, setAlerts] = useState([])
  const [settings, setSettings] = useState({})
  const [sectionFailures, setSectionFailures] = useState([])
  const [settingsUnavailable, setSettingsUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [savedQuery, setSavedQuery] = useState('')

  /**
   * One page of notifications, from the server.
   *
   * This section used to hold every notification the account had and slice it
   * in React: a hundred-odd cards rendered in one column, and reaching an older
   * one meant scrolling past every newer one. The server pages it now, and
   * `counts` comes back with the page because the chips above the list describe
   * the whole set — counting what arrived would put 10 on every chip.
   */
  const [notifPage, setNotifPage] = useState(EMPTY_PAGE)
  const [page, setPage] = useState(1)
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifFailed, setNotifFailed] = useState(false)
  // Bumped by an action, to pull the page again: archiving the fourth of ten
  // cards should leave ten on screen, not nine.
  const [reloadToken, setReloadToken] = useState(0)
  const refreshNotifications = () => setReloadToken((n) => n + 1)

  /**
   * The top of the notifications section, and whether to scroll back to it.
   *
   * Turning a page kept the window where it was, so page 2 opened part-way
   * down its own list: the reader had clicked Next at the bottom of ten cards
   * and arrived at the bottom of ten different ones, with the first few above
   * the fold and no indication they were there.
   *
   * A request rather than a dependency. Deriving "should I scroll" from the
   * page number changing would also fire on the reload an archive triggers,
   * and on the server correcting a page past the end — neither of which the
   * reader asked for, and both of which would yank the list out from under a
   * click. So the two controls that mean "take me to another page" say so, and
   * the fetch that answers them consumes it.
   */
  const notificationsTopRef = useRef(null)
  const scrollUpNext = useRef(false)

  /** Go to a page, and take the reader with you. */
  const goToPage = (next) => {
    scrollUpNext.current = true
    setPage(next)
  }

  /** Choose a chip: back to the first page, and back to the top of the list. */
  const selectFilter = (key) => {
    scrollUpNext.current = true
    setFilter(key)
    setPage(1)
  }

  const { data: liveSavedStatus } = useSignalSavedStatus()

  useEffect(() => {
    if (liveSavedStatus) {
      setSaved(liveSavedStatus)
    }
  }, [liveSavedStatus])

  useEffect(() => {
    let alive = true

    // Settled, not all: with Promise.all a single failing endpoint discarded the
    // results of the two that worked, so one broken call emptied the whole page
    // and every section on it looked equally dead (MN-26). Notifications have
    // their own effect below, because they reload on a filter, a page and an
    // action rather than only on mount.
    Promise.allSettled([listSavedStatus(), listActiveAlerts()])
      .then(([savedResult, alertsResult]) => {
        if (!alive) return
        if (savedResult.status === 'fulfilled') setSaved(savedResult.value ?? [])
        if (alertsResult.status === 'fulfilled') setAlerts(alertsResult.value ?? [])

        // Named rather than counted: "your saved medicines could not be loaded"
        // is actionable, and an empty page with no explanation is not.
        const broken = [
          savedResult.status === 'rejected' && 'saved medicines',
          alertsResult.status === 'rejected' && 'active alerts',
        ].filter(Boolean)
        setSectionFailures(broken)
        if (broken.length > 0) {
          flash(`Could not load your ${broken.join(', ')}. Your settings below still work.`)
        }
      })
      // Backstop only: the handler above reads allSettled results, so this fires
      // if that handler itself throws rather than on a failed request.
      .catch(() => alive && flash(t('signalLoadFailed', 'Could not load your ZoikoSignal™ data')))
      .finally(() => alive && setLoading(false))

    getNotificationSettings()
      .then((x) => alive && setSettings(x))
      .catch(() => alive && setSettingsUnavailable(true))

    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One page at a time, re-read whenever the chip, the page or an action
  // changes what should be on screen.
  useEffect(() => {
    let alive = true
    setNotifLoading(true)

    listNotifications({ page, pageSize: NOTIFICATIONS_PAGE_SIZE, filter })
      .then((res) => {
        if (!alive) return
        setNotifPage(asPage(res))
        setNotifFailed(false)
        // The server clamps a page past the end to the last one — deleting the
        // only card on the final page lands here — so follow it rather than
        // holding a number that no longer exists. Guarded, so this settles.
        if (res?.page && res.page !== page) setPage(res.page)

        // After the page is in state, not before: the reader should land on the
        // list they asked for rather than on the one being replaced.
        if (scrollUpNext.current) {
          scrollUpNext.current = false
          notificationsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
      .catch(() => {
        if (!alive) return
        setNotifFailed(true)
        // Flashed only when there is nothing on screen to fall back on. A
        // failed refetch behind a list that is still readable does not need to
        // interrupt anybody; the notice below the page names it either way.
        if (notifPage.items.length === 0) {
          flash(t('signalNotificationsFailed', 'Could not load your notifications'))
        }
      })
      .finally(() => alive && setNotifLoading(false))

    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, reloadToken])

  /** Which sections could not be loaded, for the notice at the foot of the page. */
  const loadFailures = useMemo(
    () => [...sectionFailures, ...(notifFailed ? ['notifications'] : [])],
    [sectionFailures, notifFailed],
  )

  // Global, from the server: these describe every notification the account has,
  // not the ten on this page.
  const counts = notifPage.counts

  // Live-computed stats stay in sync as items are dismissed / archived.
  const stats = useMemo(() => ({
    savedMedicines: saved.length,
    activeAlerts: alerts.length,
    runningLow: saved.filter((m) => ['running-low', 'out-of-stock'].includes(m.status)).length,
    backInStockToday: counts['back-in-stock'],
  }), [saved, alerts, counts])

  const unreadCount = counts.unread

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

  // Each action shows its effect on the card immediately and then pulls the
  // page again. Both halves are needed now that the list is a slice: the
  // optimistic edit keeps the click feeling instant, and the reload is what
  // replaces a removed card with the next one and corrects the chip counts,
  // neither of which the client can work out on its own any more.
  const patchVisible = (fn) => setNotifPage((p) => ({ ...p, items: fn(p.items) }))

  const handleMarkAll = async () => {
    patchVisible((items) => items.map((x) => ({ ...x, read: true })))
    setAlerts([])
    try { await markAllRead() } catch { /* optimistic */ }
    refreshNotifications()
    flash(t('allMarkedRead', 'All notifications marked as read'))
  }

  const handleRead = async (id) => {
    patchVisible((items) => items.map((x) => (x.id === id ? { ...x, read: !x.read } : x)))
    try { await markRead(id) } catch { /* optimistic */ }
    refreshNotifications()
  }

  const handleToggleRead = handleRead

  const handleArchive = async (id) => {
    patchVisible((items) => items.filter((x) => x.id !== id))
    try { await archiveNotification(id) } catch { /* optimistic */ }
    refreshNotifications()
    flash(t('notificationArchived', 'Notification archived'))
  }

  const handleDismiss = async (id) => {
    patchVisible((items) => items.filter((x) => x.id !== id))
    setAlerts((a) => a.filter((x) => x.id !== id))
    try { await dismissNotification(id) } catch { /* optimistic */ }
    refreshNotifications()
    flash(t('notificationDeleted', 'Notification deleted'))
  }

  const handleDelete = handleDismiss

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

  const emptyCopy = EMPTY_BY_FILTER[filter] ?? EMPTY_BY_FILTER.all

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
          {/* `scroll-mt-20` because the top bar is sticky and 4rem tall: without
              it, scrolling this section to the top of the viewport parks its
              heading underneath the bar. */}
          <section ref={notificationsTopRef} className="flex scroll-mt-20 flex-col gap-4">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <Bell className="size-4 text-primary" />
              {t('smartNotifications', 'SMART NOTIFICATIONS')}
            </h3>

            {/* filter tabs */}
            <div className="flex flex-wrap gap-1.5">
              {translatedFilters.map((f) => {
                const count = counts[f.key] ?? 0
                const active = filter === f.key
                return (
                  <button
                    key={f.key}
                    // Back to the first page: page 4 of Safety Alerts is not a
                    // position in Back in Stock, and landing there shows an
                    // empty list for a chip whose own count says otherwise.
                    onClick={() => selectFilter(f.key)}
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

            {notifLoading && notifPage.items.length === 0 ? (
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
                ))}
              </div>
            ) : notifPage.items.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={t(emptyCopy[0], emptyCopy[1])}
                description={t(emptyCopy[2], emptyCopy[3])}
                className="py-10"
              />
            ) : (
              <>
                <motion.div layout className="flex flex-col gap-2.5">
                  <AnimatePresence mode="popLayout">
                    {notifPage.items.map((n, i) => (
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

                {/* Only when there is somewhere to go. One page of results has
                    no use for a pager, and hiding it says so. */}
                {notifPage.pageCount > 1 && (
                  <nav
                    aria-label={t('notificationPages', 'Notification pages')}
                    className="flex items-center justify-between gap-4 pt-1"
                  >
                    <span className="tabular text-xs text-muted-foreground">
                      {t('pageXofY', 'Page {page} of {pages}', {
                        page: notifPage.page,
                        pages: notifPage.pageCount,
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={notifPage.page <= 1 || notifLoading}
                        onClick={() => goToPage(Math.max(1, notifPage.page - 1))}
                      >
                        <ChevronLeft className="size-4" />
                        {t('previous', 'Previous')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={notifPage.page >= notifPage.pageCount || notifLoading}
                        onClick={() => goToPage(notifPage.page + 1)}
                      >
                        {t('next', 'Next')}
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </nav>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Notification settings */}
      <div className="flex max-w-2xl flex-col gap-3">
        {loadFailures.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold">
                {loadFailures.join(', ')} could not be loaded
              </span>
              <span className="text-xs leading-relaxed text-foreground/90">
                This is a problem on our side rather than an empty list. The
                preferences below are unaffected and still save.
              </span>
            </div>
          </div>
        )}
        {settingsUnavailable && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="text-xs leading-relaxed">
              Your notification preferences could not be loaded, so the switches below
              may not reflect what is stored. Reload before changing them.
            </span>
          </div>
        )}
        <NotificationSettings settings={settings} onToggle={handleToggleSetting} />
      </div>
    </div>
  )
}
