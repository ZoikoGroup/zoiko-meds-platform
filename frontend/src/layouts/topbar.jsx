import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Bell, Check, CheckCircle2, ChevronsUpDown, LogOut, Menu, Moon, Plus, Search, Settings, Sun, UserCog, XCircle, } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger, } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger, } from '@/components/ui/tooltip';
import { useTheme } from '@/providers/theme-provider';
import { currentUser, notifications, organizations } from '@/services/data';
import { cn } from '@/lib/utils';
/* ------------------------------- search --------------------------------- */
function SearchTrigger({ onClick }) {
    return (<button type="button" onClick={onClick} className="group flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground">
      <Search className="size-4"/>
      <span className="flex-1 text-left">Search intelligence…</span>
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
/* ---------------------------- org switcher ------------------------------ */
function OrgSwitcher() {
    const [active, setActive] = useState(organizations[0]);
    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="hidden h-10 gap-2 px-2 md:flex" aria-label="Switch organization">
          <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-teal text-[11px] font-semibold text-white">
            {active.initials}
          </span>
          <span className="flex max-w-40 flex-col items-start leading-tight">
            <span className="truncate text-sm font-medium">{active.name}</span>
            <span className="text-[11px] text-muted-foreground">{active.plan}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {organizations.map((org) => (<DropdownMenuItem key={org.id} onSelect={() => setActive(org)} className="gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold text-secondary-foreground">
              {org.initials}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium">{org.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {org.type} · {org.plan}
              </span>
            </span>
            {active.id === org.id && (<Check className="ml-auto size-4 text-primary"/>)}
          </DropdownMenuItem>))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2.5 text-muted-foreground">
          <Plus className="size-4"/>
          Create workspace
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
    const [items, setItems] = useState(notifications);
    const unread = items.filter((n) => !n.read).length;
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
          <button onClick={() => setItems((prev) => prev.map((n) => ({ ...n, read: true })))} className="text-xs font-medium text-primary hover:underline">
            Mark all read
          </button>
        </div>
        <Separator />
        <div className="max-h-80 overflow-y-auto py-1">
          {items.map((n) => {
            const { Icon, className } = SEV[n.severity];
            return (<div key={n.id} className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent">
                <Icon className={cn('mt-0.5 size-4.5 shrink-0', className)}/>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium leading-tight">
                      {n.title}
                    </span>
                    {!n.read && <span className="size-1.5 rounded-full bg-primary"/>}
                  </div>
                  <p className="text-xs text-muted-foreground">{n.description}</p>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">
                    {n.channel} · {n.time}
                  </span>
                </div>
              </div>);
        })}
        </div>
        <Separator />
        <Link to="/reports" className="flex items-center justify-center py-2.5 text-xs font-medium text-primary hover:underline">
          View all activity
        </Link>
      </PopoverContent>
    </Popover>);
}
/* ----------------------------- profile menu ----------------------------- */
function ProfileMenu() {
    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Account menu">
          <Avatar className="size-9 border border-border">
            <AvatarFallback>{currentUser.initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar className="size-10">
            <AvatarFallback>{currentUser.initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{currentUser.name}</span>
            <span className="text-xs text-muted-foreground">{currentUser.email}</span>
          </div>
        </div>
        <div className="px-2.5 pb-2">
          <Badge variant="secondary" size="sm">
            {currentUser.role}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <UserCog />
            Account & profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger">
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
export function Topbar({ onOpenCommand, onOpenMobileNav }) {
    return (<header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border glass px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu className="size-5"/>
      </Button>

      <SearchTrigger onClick={onOpenCommand}/>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <OrgSwitcher />
        <Separator orientation="vertical" className="mx-1 hidden h-6 md:block"/>
        <ThemeToggle />
        <NotificationsMenu />
        <ProfileMenu />
      </div>
    </header>);
}
