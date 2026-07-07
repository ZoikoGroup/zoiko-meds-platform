import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Sidebar } from '@/layouts/sidebar'
import { Topbar } from '@/layouts/topbar'
import { CommandPalette } from '@/layouts/command-palette'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useTheme } from '@/providers/theme-provider'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'zoiko-sidebar-collapsed'

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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const toggleCollapse = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      return !c
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
          'fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border transition-[width] duration-300 ease-in-out lg:block',
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
          collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-[17rem]'
        )}
      >
        <Topbar
          onOpenCommand={() => setCommandOpen(true)}
          onOpenMobileNav={() => setMobileOpen(true)}
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

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  )
}
