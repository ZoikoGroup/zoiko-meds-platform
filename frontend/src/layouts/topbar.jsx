import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Bell, Check, CheckCircle2, ChevronsUpDown, LogOut, Menu, Moon, Plus, RefreshCw, Search, Settings, Sun, UserCog, XCircle, Activity, CheckSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger, } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger, } from '@/components/ui/tooltip';
import { useTheme } from '@/providers/theme-provider';
import { useAuth } from '@/providers/auth-provider';
import { listAdminInbox, listNotifications } from '@/services/admin-api';
import { routeMeta } from '@/routes/navigation';
import { cn } from '@/lib/utils';
/* ------------------------------- search --------------------------------- */
function SearchTrigger({ onClick }) {
    return (<button type="button" onClick={onClick} className="group flex h-9 w-60 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground">
      <Search className="size-4"/>
      <span className="flex-1 text-left">Search…</span>
      <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>);
}
/* ----------------------------- theme toggle ----------------------------- */
function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';
    return (<Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`} className="text-muted-foreground">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ opacity: 0, rotate: -30, scale: 0.7 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: 30, scale: 0.7 }} transition={{ duration: 0.18 }} className="flex">
              {isDark ? <Sun className="size-4.5"/> : <Moon className="size-4.5"/>}
            </motion.span>
          </AnimatePresence>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
    </Tooltip>);
}
/* ---------------------------- quick actions ----------------------------- */
function QuickActions() {
    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="hidden sm:flex gap-1.5 items-center bg-primary text-white hover:bg-primary/95 shadow-xs">
          <Plus className="size-3.5"/>
          Quick Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Platform Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/verification" className="flex items-center gap-2">
            <CheckSquare className="size-4 text-muted-foreground"/>
            Review Verification Queue
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/notifications" className="flex items-center gap-2">
            <Send className="size-4 text-muted-foreground"/>
            Broadcast Update
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/settings" className="flex items-center gap-2">
            <Settings className="size-4 text-muted-foreground"/>
            Configure Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => alert('Platform availability cache reset initiated...')} className="flex items-center gap-2">
          <RefreshCw className="size-4 text-muted-foreground"/>
          Reset Cache
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
/* ---------------------------- notifications ----------------------------- */
const SEV = {
    good: { Icon: CheckCircle2, className: 'text-success' },
    warning: { Icon: AlertTriangle, className: 'text-warning' },
    serious: { Icon: AlertCircle, className: 'text-info' },
    critical: { Icon: XCircle, className: 'text-danger' },
};
function NotificationsMenu() {
    const [items, setItems] = useState([]);
    const [readIds, setReadIds] = useState(new Set());

    const loadLiveNotifications = useCallback(async () => {
        try {
            // Two sources: the broadcasts an admin composed, and the
            // verification submissions waiting on a reviewer. The bell used to
            // read only the first, so a pharmacy uploading its licence and
            // submitting for verification told nobody at all.
            //
            // allSettled, because one failing feed must not empty the bell:
            // whichever answered still shows.
            const [broadcasts, inbox] = await Promise.allSettled([
                listNotifications(),
                listAdminInbox(),
            ]);
            const raw = broadcasts.status === 'fulfilled' ? broadcasts.value : [];
            const reviews = inbox.status === 'fulfilled' ? (inbox.value || []) : [];
            const mapped = (raw || []).map((n) => {
                let severity = 'good';
                if (n.type === 'EMERGENCY_ALERT') severity = 'critical';
                else if (n.type === 'MAINTENANCE') severity = 'warning';
                else if (n.type === 'PLATFORM_UPDATE') severity = 'serious';

                let channel = 'System Announcement';
                if (n.target === 'ALL_USERS') channel = 'All Users';
                else if (n.target === 'PHARMACY_MANAGERS') channel = 'Pharmacy Managers';
                else if (n.target === 'ENTERPRISE_ADMINS') channel = 'Enterprise Admins';
                else if (n.target === 'GOVERNMENT_PARTNERS') channel = 'Government Partners';

                return {
                    id: n.id,
                    title: n.title,
                    description: n.message,
                    severity,
                    channel,
                    time: n.date ? new Date(n.date).toLocaleDateString() : 'Just now',
                    rawDate: n.date ? new Date(n.date) : new Date(),
                };
            });
            const reviewItems = reviews.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.message,
                severity: r.severity || 'serious',
                channel: 'Verification Center',
                to: `/admin/verification?request=${encodeURIComponent(r.requestId)}`,
                time: r.date ? new Date(r.date).toLocaleDateString() : 'Just now',
                rawDate: r.date ? new Date(r.date) : new Date(),
            }));

            const all = [...mapped, ...reviewItems];
            all.sort((a, b) => b.rawDate - a.rawDate);
            setItems(all);
        } catch {
            // Keep current items if network fails
        }
    }, []);

    useEffect(() => {
        loadLiveNotifications();

        const handleSync = () => loadLiveNotifications();
        window.addEventListener('broadcast-dispatched', handleSync);
        window.addEventListener('focus', handleSync);

        const interval = setInterval(handleSync, 10000);

        return () => {
            window.removeEventListener('broadcast-dispatched', handleSync);
            window.removeEventListener('focus', handleSync);
            clearInterval(interval);
        };
    }, [loadLiveNotifications]);

    const unread = items.filter((n) => !readIds.has(n.id)).length;

    const markAllRead = () => {
        setReadIds(new Set(items.map((n) => n.id)));
    };

    const markSingleRead = (id) => {
        setReadIds((prev) => new Set([...prev, id]));
    };

    return (<Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell className="size-4.5"/>
          {unread > 0 && (<span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-semibold text-white ring-2 ring-card">
              {unread}
            </span>)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (<Badge size="sm" variant="default">
                {unread} new
              </Badge>)}
          </div>
          <button onClick={markAllRead} className="text-xs font-medium text-primary hover:underline">
            Mark all read
          </button>
        </div>
        <Separator />
        <div className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No announcements yet.</p>
          ) : (
            items.map((n) => {
              const isRead = readIds.has(n.id);
              const { Icon, className } = SEV[n.severity] || SEV.good;
              // A review reminder is actionable, so it opens the request it is
              // about. A broadcast has nowhere to go and stays a plain row.
              const Row = n.to ? Link : 'div';
              const rowProps = n.to ? { to: n.to } : {};
              return (<Row key={n.id} {...rowProps} onClick={() => markSingleRead(n.id)} className={cn('flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-accent', !isRead && 'bg-primary/5')}>
                  <Icon className={cn('mt-0.5 size-4.5 shrink-0', className)}/>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium leading-tight">
                        {n.title}
                      </span>
                      {!isRead && <span className="size-1.5 rounded-full bg-primary"/>}
                    </div>
                    <p className="text-xs text-muted-foreground">{n.description}</p>
                    <span className="mt-0.5 text-[11px] text-muted-foreground">
                      {n.channel} · {n.time}
                    </span>
                  </div>
                </Row>);
            })
          )}
        </div>
        <Separator />
        <Link to="/admin/reports" className="flex items-center justify-center py-2.5 text-xs font-medium text-primary hover:underline">
          View all activity
        </Link>
      </PopoverContent>
    </Popover>);
}
/* ----------------------------- profile menu ----------------------------- */
function ProfileMenu() {
    const { user, logout } = useAuth();
    const initials = user?.initials || 'U';
    const name = user?.name || 'User';
    const email = user?.email || '';
    const role = user?.roleLabel || user?.role || 'Super Admin';

    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Account menu">
          <Avatar className="size-9 border border-border">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar className="size-10">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <div className="px-2.5 pb-2">
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/settings">
            <UserCog />
            Account & profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/settings">
            <Settings />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={logout}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
export function Topbar({ onOpenCommand, onOpenMobileNav, onToggleRightSidebar, rightSidebarOpen }) {
    const { pathname } = useLocation();
    const meta = routeMeta[pathname] || { title: 'Portal' };

    return (<header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/85 backdrop-blur-md px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
          <Menu className="size-5"/>
        </Button>

        {/* Breadcrumb Navigation */}
        <div className="hidden md:flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="text-muted-foreground/60">Platform</span>
          <span className="text-border/60">/</span>
          {meta.section && (<>
              <span className="text-muted-foreground/60">{meta.section}</span>
              <span className="text-border/60">/</span>
            </>)}
          <span className="text-foreground font-semibold">{meta.title}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <SearchTrigger onClick={onOpenCommand}/>
        <QuickActions />
        <Separator orientation="vertical" className="mx-1 hidden h-6 md:block"/>
        <ThemeToggle />
        <NotificationsMenu />
        <ProfileMenu />
        <Button variant="ghost" size="icon" onClick={onToggleRightSidebar} className={cn('text-muted-foreground', rightSidebarOpen && 'text-primary bg-accent')} aria-label="Toggle Activity Sidebar">
          <Activity className="size-4.5"/>
        </Button>
      </div>
    </header>);
}
