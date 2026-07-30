import { Suspense, useState, useEffect, useCallback } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Home, Search, Heart, Radar, Settings, HelpCircle,
  Menu, LogOut, Sun, Moon, Loader2, User, ShieldCheck, Bell,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'
import { useLanguage } from '@/providers/language-provider'
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
import { getSignalDigest } from '@/services/signal-api'
import { getPatientNotifications } from '@/services/patient-notifications-api'

export function UserLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signalUnread, setSignalUnread] = useState(0)
  const [notifUnread, setNotifUnread] = useState(0)

  const navSections = [
    {
      items: [
        { label: t('home', 'Home'), to: '/dashboard', icon: Home },
        { label: t('searchMedicines', 'Search Medicines'), to: '/search', icon: Search },
        { label: t('howAvailabilityWorks', 'How Availability Works'), to: '/availability', icon: ShieldCheck },
      ],
    },
    {
      heading: t('myMedicines', 'My Medicines'),
      items: [
        { label: t('savedMedicines', 'Saved Medicines'), to: '/saved', icon: Heart },
        { label: t('zoikoSignal', 'ZoikoSignal™'), to: '/signal', icon: Radar },
      ],
    },
    {
      heading: t('account', 'Account'),
      items: [
        { label: t('notifications', 'Notifications'), to: '/notifications', icon: Bell },
        { label: t('myProfile', 'My Profile'), to: '/profile', icon: User },
        { label: t('settings', 'Settings'), to: '/settings', icon: Settings },
      ],
    },
  ]

  const pageTitles = {
    '/dashboard': t('home', 'Home'),
    '/search': t('searchMedicines', 'Search Medicines'),
    '/availability': t('howAvailabilityWorks', 'How Availability Works'),
    '/saved': t('savedMedicines', 'Saved Medicines'),
    '/signal': t('zoikoSignal', 'ZoikoSignal™'),
    '/notifications': t('notifications', 'Notifications'),
    '/profile': t('myProfile', 'My Profile'),
    '/settings': t('settings', 'Settings'),
  }

  const refreshUnreadCounts = useCallback(() => {
    let alive = true
    getSignalDigest().then((d) => alive && setSignalUnread(d.unread)).catch(() => {})
    getPatientNotifications().then((list) => {
      if (alive) {
        setNotifUnread((list || []).filter((n) => n.unread).length)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    refreshUnreadCounts()
    const handleSync = () => refreshUnreadCounts()
    window.addEventListener('broadcast-dispatched', handleSync)
    window.addEventListener('focus', handleSync)
    return () => {
      window.removeEventListener('broadcast-dispatched', handleSync)
      window.removeEventListener('focus', handleSync)
    }
  }, [location.pathname, refreshUnreadCounts])

  const isDark = theme === 'dark'
  const currentTitle = pageTitles[location.pathname] ?? t('home', 'Home')

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Auto-close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between border-r border-border bg-sidebar px-5 py-6 text-sidebar-foreground">
      <div className="flex flex-col gap-8">
        {/* Branding header */}
        <div className="flex items-center px-2">
          <Link
            to="/dashboard"
            className="flex items-center"
            aria-label="ZoikoMeds home"
          >
            <Brand size="large" />
          </Link>
        </div>

        {/* Navigation — grouped into labeled sections */}
        <nav className="flex flex-col gap-7" aria-label="Patient portal">
          {navSections.map((section) => (
            <div key={section.heading ?? 'primary'} className="flex flex-col gap-1.5">
              {section.heading && (
                <span className="px-3 pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
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
                      'relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold cursor-pointer transition-all duration-200 ease-in-out',
                      active
                        ? 'bg-primary/10 text-primary shadow-sm font-bold before:absolute before:left-1 before:top-2.5 before:bottom-2.5 before:w-1 before:rounded-full before:bg-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:translate-x-1',
                    )}
                  >
                    <span className="flex w-5 justify-center shrink-0">
                      <Icon
                        className={cn(
                          'size-5 transition-colors duration-200',
                          link.to === '/notifications'
                            ? 'text-[#2563EB] dark:text-[#3B82F6]'
                            : active
                            ? 'text-primary'
                            : 'text-muted-foreground'
                        )}
                      />
                    </span>
                    <span>{link.label}</span>
                    {link.to === '/signal' && signalUnread > 0 && (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {signalUnread}
                      </span>
                    )}
                    {link.to === '/notifications' && notifUnread > 0 && (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {notifUnread}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-6">
        <span className="px-3 pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
          {t('support', 'Support')}
        </span>
        <a
          href="mailto:support@zoikomeds.com"
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-muted-foreground cursor-pointer transition-all duration-200 ease-in-out hover:bg-muted/50 hover:text-foreground hover:translate-x-1"
        >
          <span className="flex w-5 justify-center shrink-0">
            <HelpCircle className="size-5 transition-colors duration-200" />
          </span>
          <span>{t('helpSupport', 'Help & Support')}</span>
        </a>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-danger cursor-pointer transition-all duration-200 ease-in-out hover:bg-danger/5 hover:translate-x-1"
        >
          <span className="flex w-5 justify-center shrink-0">
            <LogOut className="size-5 transition-colors duration-200" />
          </span>
          <span>{t('signOut', 'Sign Out')}</span>
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
              asChild
              className="relative rounded-full text-muted-foreground hover:text-foreground"
              aria-label={`Notifications${notifUnread > 0 ? `, ${notifUnread} unread` : ''}`}
            >
              <Link to="/notifications">
                <Bell className="size-4.5 transition-colors text-[#2563EB] dark:text-[#3B82F6]" />
                {notifUnread > 0 && (
                  <span className="absolute top-1 right-1 flex size-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2563EB] dark:bg-[#3B82F6] opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-[#2563EB] dark:bg-[#3B82F6]" />
                  </span>
                )}
              </Link>
            </Button>
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
                  className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer"
                  aria-label="Account menu"
                >
                  <Avatar className="size-8 border border-border">
                    <AvatarFallback>{user?.initials || 'ZM'}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="flex items-center gap-3 px-2.5 py-2">
                  <Avatar className="size-10">
                    <AvatarFallback>{user?.initials || 'ZM'}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{user?.name || 'Patient User'}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email || 'patient@example.com'}</span>
                  </div>
                </div>
                <div className="px-2.5 pb-2">
                  <Badge variant="teal" size="sm" className="font-bold uppercase tracking-wide">
                    {user?.roleLabel || 'Patient'}
                  </Badge>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <User />
                    {t('myProfile', 'My Profile')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings />
                    {t('settings', 'Settings')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={handleLogout}>
                  <LogOut />
                  {t('signOut', 'Sign Out')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
