import { Suspense, useState, useEffect } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Home, Search, Heart, Bell, Settings, HelpCircle,
  Menu, LogOut, Sun, Moon, Loader2, User,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'
import { Brand } from '@/components/shared/brand'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const NAV_SECTIONS = [
  {
    items: [
      { label: 'Home', to: '/dashboard', icon: Home },
      { label: 'Search Medicines', to: '/search', icon: Search },
    ],
  },
  {
    heading: 'My Medicines',
    items: [
      { label: 'Saved Medicines', to: '/saved', icon: Heart },
      { label: 'Medicine Alerts', to: '/alerts', icon: Bell },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'My Profile', to: '/profile', icon: User },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
]

const PAGE_TITLES = {
  '/dashboard': 'Home',
  '/search': 'Search Medicines',
  '/saved': 'Saved Medicines',
  '/alerts': 'Medicine Alerts',
  '/profile': 'My Profile',
  '/settings': 'Settings',
}

export function UserLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isDark = theme === 'dark'
  const currentTitle = PAGE_TITLES[location.pathname] ?? 'Home'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Auto-close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between border-r border-border bg-sidebar p-4 text-sidebar-foreground">
      <div className="flex flex-col gap-6">
        {/* Branding header */}
        <Link
          to="/dashboard"
          className="flex items-center justify-between gap-2 px-2 py-1.5"
          aria-label="ZoikoMeds home"
        >
          <Brand />
          <Badge variant="teal" size="sm" className="font-bold uppercase tracking-wide">
            Patient
          </Badge>
        </Link>

        {/* Navigation — grouped into labeled sections */}
        <nav className="flex flex-col gap-5" aria-label="Patient portal">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading ?? 'primary'} className="flex flex-col gap-1">
              {section.heading && (
                <span className="px-3.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {section.heading}
                </span>
              )}
              {section.items.map((link) => {
                const Icon = link.icon
                const active = location.pathname === link.to
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                    <span>{link.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <a
          href="mailto:support@zoikomeds.com"
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HelpCircle className="size-5 shrink-0" />
          Help &amp; Support
        </a>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/5"
        >
          <LogOut className="size-5 shrink-0" />
          Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Patient portal navigation</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border px-4 glass lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </Button>
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <span className="hidden sm:inline">ZoikoMeds</span>
              <span className="hidden text-border sm:inline">/</span>
              <span className="font-semibold text-foreground">{currentTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              className="rounded-full text-muted-foreground hover:text-foreground"
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              {isDark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => navigate('/profile')}
              aria-label="Open profile"
            >
              <Avatar className="size-8">
                <AvatarFallback>{user?.initials || 'ZM'}</AvatarFallback>
              </Avatar>
            </Button>
          </div>
        </header>

        {/* Routed views */}
        <main className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8"
            >
              <Suspense
                fallback={
                  <div className="flex min-h-[60vh] items-center justify-center">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
