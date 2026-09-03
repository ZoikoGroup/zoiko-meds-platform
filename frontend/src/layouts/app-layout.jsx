import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Sidebar } from '@/layouts/sidebar'
import { Topbar } from '@/layouts/topbar'
import { CommandPalette } from '@/layouts/command-palette'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useTheme } from '@/providers/theme-provider'
import { cn } from '@/lib/utils'
import { getZoikoAvailTelemetry, listAuditLogs, listVerifications } from '@/services/admin-api'
import { relativeAge } from '@/services/dashboard-api'

const COLLAPSE_KEY = 'zoiko-sidebar-collapsed'
const RIGHT_OPEN_KEY = 'zoiko-right-sidebar-open'

/** Verification states that are still waiting on a reviewer. */
const OPEN_VERIFICATION = new Set(['PENDING', 'UNDER_REVIEW', 'ESCALATED'])

/** How many rows of each real feed the 20rem panel has room for. */
const APPROVALS_SHOWN = 3
const ACTIVITY_SHOWN = 4

const countFmt = new Intl.NumberFormat()

// GatewayTelemetryService reports one of these four; 'disabled' means the
// gateway log held nothing for the window, which the panel treats as no data
// rather than as a status worth colouring.
const HEALTH_LABEL = {
  operational: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  disabled: 'Idle',
}
const HEALTH_DOT = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-danger',
  disabled: 'bg-muted-foreground',
}
const HEALTH_TEXT = {
  operational: 'text-success',
  degraded: 'text-warning',
  down: 'text-danger',
  disabled: 'text-muted-foreground',
}

const EMPTY_PANEL = { loading: true, health: null, approvals: [], activity: [] }

/** `pharmacy.inventory.import` reads as "Pharmacy Inventory Import". */
function actionTitle(action) {
  if (!action) return 'Activity'
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** One measured value, or an em dash where the measurement has no denominator. */
function TelemetryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value ?? '—'}</span>
    </div>
  )
}

function PanelSkeleton({ rows }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/40" />
      ))}
    </div>
  )
}

function PanelEmpty({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
      {children}
    </p>
  )
}

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const { toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1'
  )
  const [rightOpen, setRightOpen] = useState(
    () => localStorage.getItem(RIGHT_OPEN_KEY) !== '0'
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const [panel, setPanel] = useState(EMPTY_PANEL)

  // The activity panel's three feeds. Fetched only while the panel is open —
  // and re-fetched on navigation, which is how it stays current without a
  // poll. allSettled, because one feed failing must not blank the other two:
  // each falls back to its own empty state, and none of them invents a value.
  useEffect(() => {
    if (!rightOpen) return undefined

    let alive = true
    setPanel((prev) => ({ ...prev, loading: true }))

    Promise.allSettled([getZoikoAvailTelemetry(), listVerifications(), listAuditLogs({ page: 1, pageSize: ACTIVITY_SHOWN })]).then(
      ([telemetry, verifications, audit]) => {
        if (!alive) return
        setPanel({
          loading: false,
          health: telemetry.status === 'fulfilled' ? (telemetry.value?.health ?? null) : null,
          approvals:
            verifications.status === 'fulfilled'
              ? (verifications.value ?? [])
                  .filter((r) => OPEN_VERIFICATION.has(r.status))
                  .slice(0, APPROVALS_SHOWN)
              : [],
          activity:
            audit.status === 'fulfilled'
              ? (audit.value?.items ?? []).slice(0, ACTIVITY_SHOWN)
              : [],
        })
      }
    )

    return () => {
      alive = false
    }
  }, [rightOpen, location.pathname])
  const toggleCollapse = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      return !c
    })

  const toggleRight = () =>
    setRightOpen((ro) => {
      localStorage.setItem(RIGHT_OPEN_KEY, ro ? '0' : '1')
      return !ro
    })

  // Global keyboard shortcuts: ⌘K command palette, ⌘⇧L theme.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTheme])

  // Scroll to top on navigation.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail */}
      <aside
        className={cn(
          // overflow-hidden keeps nav labels clipped to the rail mid-transition
          // instead of spilling past it and nudging the page sideways.
          'fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-sidebar-border transition-[width] duration-300 ease-in-out lg:block',
          collapsed ? 'lg:w-[4.5rem]' : 'lg:w-[17rem]'
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          showCollapseButton
        />
      </aside>

      {/* Mobile nav */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[17rem] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-300 ease-in-out',
          collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-[17rem]',
          rightOpen ? 'xl:pr-[20rem]' : 'xl:pr-0'
        )}
      >
        <Topbar
          onOpenCommand={() => setCommandOpen(true)}
          onOpenMobileNav={() => setMobileOpen(true)}
          onToggleRightSidebar={toggleRight}
          rightSidebarOpen={rightOpen}
        />
        <main className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
            >
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Right Sidebar Activity Panel */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-20 border-l border-border bg-card transition-all duration-300 ease-in-out hidden xl:flex flex-col w-[20rem] pt-16',
          rightOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
        )}
      >
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
          {/* Section: Live Telemetry — governed API health, from GatewayRequestLog */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Live Telemetry</h3>
            {panel.loading ? (
              <PanelSkeleton rows={3} />
            ) : panel.health && panel.health.requests24h > 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        HEALTH_DOT[panel.health.status] ?? 'bg-muted-foreground',
                        panel.health.status === 'operational' && 'animate-pulse'
                      )}
                    />
                    Governed API
                  </span>
                  <span className={cn('font-semibold', HEALTH_TEXT[panel.health.status] ?? 'text-muted-foreground')}>
                    {HEALTH_LABEL[panel.health.status] ?? 'Unknown'}
                  </span>
                </div>
                <TelemetryRow
                  label="Uptime · 30d"
                  value={panel.health.uptime != null ? `${panel.health.uptime}%` : null}
                />
                <TelemetryRow
                  label="Median latency"
                  value={panel.health.p50 != null ? `${panel.health.p50} ms` : null}
                />
                <TelemetryRow label="Requests · 24h" value={countFmt.format(panel.health.requests24h)} />
              </div>
            ) : (
              // The endpoint answers; the gateway log is simply empty. That is a
              // real reading, not a missing feature — so it says so rather than
              // showing a green tick nothing measured.
              <PanelEmpty>No data available</PanelEmpty>
            )}
          </div>

          {/* Section: Critical Alerts */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldAlert className="size-4 text-danger" />
              Critical Alerts
            </h3>
            {/*
              Not wired, because there is nothing to wire it to: the schema has
              no alert or incident record, and Pharmacy stores a licenceNumber
              with no expiry date, so neither the stock-shortage nor the
              licence-expiry alert this panel used to show can be computed at
              all. It showed two invented ones instead.
            */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col items-start gap-2">
              <span
                role="status"
                className="rounded-full border border-teal/20 bg-teal/10 px-2.5 py-1 text-[11px] font-semibold text-teal dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400"
              >
                Coming soon
              </span>
              <p className="text-xs leading-snug text-muted-foreground">
                Platform alerting is not yet available.
              </p>
            </div>
          </div>

          {/* Section: Pending Approvals — real verification queue */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending Approvals</h3>
            {panel.loading ? (
              <PanelSkeleton rows={2} />
            ) : panel.approvals.length > 0 ? (
              <div className="flex flex-col gap-2">
                {panel.approvals.map((request) => (
                  <Link
                    key={request.id}
                    to="/admin/verification"
                    className="rounded-lg border border-border/80 p-3 text-xs flex items-center justify-between gap-2 hover:bg-accent transition-colors"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">{request.pharmacy}</span>
                      {request.city && (
                        <span className="truncate text-[10px] text-muted-foreground">{request.city}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground/80">
                      {relativeAge(request.date) ?? ''}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <PanelEmpty>No pending approvals</PanelEmpty>
            )}
          </div>

          {/* Section: Recent Activity — real AuditLog */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
            {panel.loading ? (
              <PanelSkeleton rows={3} />
            ) : panel.activity.length > 0 ? (
              <div className="relative border-l border-border/80 pl-4 ml-1.5 flex flex-col gap-4">
                {panel.activity.map((entry) => (
                  <div key={entry.id} className="relative">
                    <span className="absolute -left-[21px] top-0.5 flex size-2.5 items-center justify-center rounded-full bg-primary ring-4 ring-card" />
                    <div className="text-xs">
                      <span className="font-semibold text-foreground">{actionTitle(entry.action)}</span>
                      {entry.summary && (
                        <p className="text-muted-foreground leading-snug mt-0.5">{entry.summary}</p>
                      )}
                      <span className="text-[10px] text-muted-foreground/80 block mt-1">
                        {[entry.actor, relativeAge(entry.timestamp)].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <PanelEmpty>No data available</PanelEmpty>
            )}
          </div>
        </div>
      </aside>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  )
}
