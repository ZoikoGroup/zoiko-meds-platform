import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Activity, AlertTriangle, CheckCircle2, Clock, ShieldAlert, Check } from 'lucide-react'
import { Sidebar } from '@/layouts/sidebar'
import { Topbar } from '@/layouts/topbar'
import { CommandPalette } from '@/layouts/command-palette'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useTheme } from '@/providers/theme-provider'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'zoiko-sidebar-collapsed'
const RIGHT_OPEN_KEY = 'zoiko-right-sidebar-open'

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
          {/* Section: Live System Status */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Live Telemetry</h3>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success animate-pulse" />
                  Availability Engine
                </span>
                <span className="font-semibold text-success">Healthy</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success animate-pulse" />
                  Normalization Sync
                </span>
                <span className="font-semibold text-success">Active</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success animate-pulse" />
                  SSO Gateways
                </span>
                <span className="font-semibold text-success">100% Uptime</span>
              </div>
            </div>
          </div>

          {/* Section: Critical Alerts */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldAlert className="size-4 text-danger" />
              Critical Alerts
            </h3>
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs flex flex-col gap-1">
                <span className="font-semibold text-danger">Stock Shortage: APAC</span>
                <p className="text-muted-foreground leading-snug">Insulin supply chain latency detected in region.</p>
                <span className="text-[10px] text-muted-foreground/80 mt-1">10m ago</span>
              </div>
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs flex flex-col gap-1">
                <span className="font-semibold text-warning">Licensing Expiry Warning</span>
                <p className="text-muted-foreground leading-snug">Meridian Pharmacy Group license expires in 3 days.</p>
                <span className="text-[10px] text-muted-foreground/80 mt-1">1h ago</span>
              </div>
            </div>
          </div>

          {/* Section: Pending Approvals */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending Approvals</h3>
            <div className="flex flex-col gap-2">
              {[
                { name: 'City Meds Clinic', city: 'London', time: '2h ago' },
                { name: 'PharmaCare Ltd', city: 'Berlin', time: '5h ago' }
              ].map((p, idx) => (
                <Link
                  key={idx}
                  to="/admin/verification"
                  className="rounded-lg border border-border/80 p-3 text-xs flex items-center justify-between hover:bg-accent transition-colors"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.city}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80">{p.time}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Section: Recent Activity Timeline */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
            <div className="relative border-l border-border/80 pl-4 ml-1.5 flex flex-col gap-4">
              <div className="relative">
                <span className="absolute -left-[21px] top-0.5 flex size-2.5 items-center justify-center rounded-full bg-primary ring-4 ring-card" />
                <div className="text-xs">
                  <span className="font-semibold text-foreground">API Key Rotated</span>
                  <p className="text-muted-foreground leading-snug mt-0.5">Atlas BioSupply rotated key ID ending ...8f91.</p>
                  <span className="text-[10px] text-muted-foreground/80 block mt-1">3h ago</span>
                </div>
              </div>
              <div className="relative">
                <span className="absolute -left-[21px] top-0.5 flex size-2.5 items-center justify-center rounded-full bg-primary ring-4 ring-card" />
                <div className="text-xs">
                  <span className="font-semibold text-foreground">Backup Finished</span>
                  <p className="text-muted-foreground leading-snug mt-0.5">Database snapshot completed (Size: 4.8 GB).</p>
                  <span className="text-[10px] text-muted-foreground/80 block mt-1">6h ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  )
}
