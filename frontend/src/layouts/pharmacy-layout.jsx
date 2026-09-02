import { Suspense, useState, useEffect } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard, Boxes, Activity, Upload, PlugZap, Gauge, BarChart3,
  Bell, Building2, CreditCard, Settings, HelpCircle, Menu, LogOut, Sun, Moon, Loader2,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'
import { Brand } from '@/components/shared/brand'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const NAV_SECTIONS = [
  {
    items: [
      { label: 'Dashboard', to: '/pharmacy/dashboard', icon: LayoutDashboard },
      { label: 'Inventory', to: '/pharmacy/inventory', icon: Boxes },
      { label: 'Availability', to: '/pharmacy/availability', icon: Activity },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { label: 'CSV Upload', to: '/pharmacy/upload', icon: Upload },
      { label: 'Integration', to: '/pharmacy/integration', icon: PlugZap },
      { label: 'Participation', to: '/pharmacy/participation', icon: Gauge },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { label: 'Reports', to: '/pharmacy/reports', icon: BarChart3 },
      { label: 'Notifications', to: '/pharmacy/notifications', icon: Bell },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Pharmacy Profile', to: '/pharmacy/profile', icon: Building2 },
      { label: 'Billing', to: '/pharmacy/billing', icon: CreditCard },
      { label: 'Settings', to: '/pharmacy/settings', icon: Settings },
    ],
  },
]

const PAGE_TITLES = {
  '/pharmacy/dashboard': 'Dashboard',
  '/pharmacy/inventory': 'Inventory',
  '/pharmacy/availability': 'Availability',
  '/pharmacy/upload': 'CSV Upload',
  '/pharmacy/integration': 'Integration',
  '/pharmacy/participation': 'Participation',
  '/pharmacy/reports': 'Reports',
  '/pharmacy/notifications': 'Notifications',
  '/pharmacy/profile': 'Pharmacy Profile',
  '/pharmacy/settings': 'Settings',
}

export function PharmacyLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isDark = theme === 'dark'
  const currentTitle = PAGE_TITLES[location.pathname] ?? 'Pharmacy'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-border bg-sidebar p-4 text-sidebar-foreground">
      {/* Top logo header */}
      <div className="flex items-center px-2 py-1.5 shrink-0">
        <Link
          to="/pharmacy/dashboard"
          className="flex items-center"
          aria-label="ZoikoMeds pharmacy home"
        >
          <Brand size="large" />
        </Link>
      </div>

      {/* Scrollable middle navigation */}
      <nav className="my-6 flex-1 overflow-y-auto pr-1 shrink-0 lg:shrink" aria-label="Pharmacy portal">
        <div className="flex flex-col gap-5">
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
        </div>
      </nav>

      {/* Pinned bottom section */}
      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-border pt-4">
        <a
          href="mailto:partners@zoikomeds.com"
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HelpCircle className="size-5 shrink-0" />
          Partner Support
        </a>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-danger cursor-pointer transition-colors hover:bg-danger/5"
        >
          <LogOut className="size-5 shrink-0" />
          Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        {sidebarContent}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Pharmacy portal navigation</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen flex-col lg:pl-64">
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
              <span className="hidden sm:inline">Pharmacy Portal</span>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="Account menu"
                >
                  <Avatar className="size-8 border border-border">
                    <AvatarFallback>{user?.initials || 'PH'}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="flex items-center gap-3 px-2.5 py-2">
                  <Avatar className="size-10">
                    <AvatarFallback>{user?.initials || 'PH'}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{user?.name || 'Pharmacy User'}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email || 'pharmacy@example.com'}</span>
                  </div>
                </div>
                <div className="px-2.5 pb-2">
                  <Badge variant="info" size="sm" className="font-bold uppercase tracking-wide">
                    {user?.roleLabel || 'Pharmacy'}
                  </Badge>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/pharmacy/profile">
                    <Building2 />
                    Pharmacy profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/pharmacy/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenuItem>

              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

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
