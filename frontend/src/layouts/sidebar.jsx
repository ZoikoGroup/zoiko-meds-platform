import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Keyboard, LifeBuoy, MessagesSquare, PanelLeft, } from 'lucide-react';
import { Brand } from '@/components/shared/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, } from '@/components/ui/dialog';
import { navSections } from '@/routes/navigation';
import { cn } from '@/lib/utils';
function useActiveMatcher() {
    const { pathname, search } = useLocation();
    const tab = new URLSearchParams(search).get('tab');
    return (link) => {
        const [linkPath, linkQuery] = link.to.split('?');
        const pathMatch = link.end
            ? pathname === linkPath
            : pathname === linkPath || pathname.startsWith(linkPath + '/');
        if (!pathMatch)
            return false;
        if (linkQuery)
            return tab === new URLSearchParams(linkQuery).get('tab');
        if (linkPath === '/settings')
            return tab !== 'integrations';
        return true;
    };
}
function NavItem({ link, collapsed, active, onNavigate, }) {
    const Icon = link.icon;
    const content = (<Link to={link.to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn('group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', active
            ? 'bg-sidebar-accent font-medium text-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground', collapsed && 'justify-center px-0')}>
      {active && (<span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"/>)}
      <Icon className={cn('size-4.5 shrink-0 transition-colors', active
            ? 'text-primary'
            : 'text-muted-foreground group-hover:text-foreground')}/>
      {!collapsed && <span className="truncate">{link.label}</span>}
      {!collapsed && link.badge && (<Badge size="sm" variant="secondary" className="ml-auto">
          {link.badge}
        </Badge>)}
    </Link>);
    if (collapsed) {
        return (<Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{link.label}</TooltipContent>
      </Tooltip>);
    }
    return content;
}
function HelpCenter({ collapsed }) {
    const [open, setOpen] = useState(false);
    return (<Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className={cn('w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground', collapsed && 'justify-center px-0')}>
          <LifeBuoy className="size-4.5 shrink-0 text-muted-foreground"/>
          {!collapsed && <span>Help Center</span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Help & resources</DialogTitle>
          <DialogDescription>
            Documentation, onboarding, and support for the intelligence platform.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {[
            { icon: BookOpen, title: 'Documentation', desc: 'Guides, API reference, and governance model.' },
            { icon: Keyboard, title: 'Keyboard shortcuts', desc: 'Press ⌘K to open the command palette.' },
            { icon: MessagesSquare, title: 'Contact support', desc: 'Enterprise support with a 1h SLA.' },
        ].map((item) => (<button key={item.title} className="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon className="size-4.5"/>
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.desc}</span>
              </span>
            </button>))}
        </div>
      </DialogContent>
    </Dialog>);
}
/**
 * The collapse control.
 *
 * Lives in the sidebar header in BOTH states, vertically centred in the same
 * h-16 band, so toggling never moves it. It used to be rendered twice — in the
 * header when expanded and in the footer when collapsed — which sent it to the
 * bottom of a full-height fixed rail the moment you collapsed the sidebar, out
 * of reach without scrolling.
 */
function CollapseToggle({ collapsed, onToggle }) {
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    const button = (<Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={label} aria-expanded={!collapsed} className="shrink-0 text-muted-foreground">
      <PanelLeft className={cn('transition-transform duration-300 ease-in-out', collapsed && 'rotate-180')}/>
    </Button>);
    // Collapsed, the button carries no adjacent text, so name it on hover the
    // same way the collapsed nav items are named.
    if (collapsed) {
        return (<Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>);
    }
    return button;
}
export function Sidebar({ collapsed = false, onNavigate, onToggleCollapse, showCollapseButton = false, }) {
    const isActive = useActiveMatcher();
    // The rail is 4.5rem wide collapsed; the brand mark (34px) and the toggle
    // (32px) cannot sit side by side in it. The toggle wins that space, because
    // it is the only control in the rail and the full brand returns the instant
    // the sidebar expands.
    const showBrand = !(collapsed && showCollapseButton);
    return (<div className="flex h-full flex-col bg-sidebar">
      <div className={cn('flex h-16 shrink-0 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        {showBrand && (<Link to="/admin" onClick={onNavigate} aria-label="ZoikoMeds home">
            <Brand collapsed={collapsed}/>
          </Link>)}
        {showCollapseButton && (<CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse}/>)}
      </div>

      <ScrollArea className="flex-1" viewportClassName="px-3 py-4">
        <nav className="flex flex-col gap-6">
          {navSections.map((section, i) => (<div key={section.heading ?? i} className="flex flex-col gap-1">
              {section.heading && !collapsed && (<p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {section.heading}
                </p>)}
              {section.heading && collapsed && i > 0 && (<div className="mx-2 mb-1 h-px bg-sidebar-border"/>)}
              {section.items.map((link) => (<NavItem key={link.label} link={link} collapsed={collapsed} active={isActive(link)} onNavigate={onNavigate}/>))}
            </div>))}
        </nav>
      </ScrollArea>

      <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-border p-3">
        <HelpCenter collapsed={collapsed}/>
        {!collapsed && (<div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-card/50 px-3 py-2.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60"/>
              <span className="relative inline-flex size-2 rounded-full bg-success"/>
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-medium">All systems operational</span>
              <span className="text-[11px] text-muted-foreground">
                99.98% uptime · 30d
              </span>
            </div>
          </div>)}
      </div>
    </div>);
}
