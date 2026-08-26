import { useNavigate } from 'react-router-dom';
import { FileDown, Moon, Sun, } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, } from '@/components/ui/command';
import { allNavLinks } from '@/routes/navigation';
import { useTheme } from '@/providers/theme-provider';
export function CommandPalette({ open, onOpenChange }) {
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    // Resolved from the nav rather than written out: routes/index.jsx rewrites
    // these at runtime to sit under /admin, and the two actions removed from
    // this group were hardcoded '/enterprise' and '/reports' -- one a route that
    // does not exist anywhere, the other missing that prefix. Both navigated
    // straight to the NotFound page (MSA-39, MSA-43).
    const exportCenter = allNavLinks.find((link) => link.to.endsWith('/reports'));
    const run = (fn) => {
        onOpenChange(false);
        fn();
    };
    return (<CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions, and intelligence…"/>
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {allNavLinks.map((link) => (<CommandItem key={link.to} value={link.label} onSelect={() => run(() => navigate(link.to))}>
              <link.icon />
              {link.label}
            </CommandItem>))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {exportCenter && (<CommandItem value="export report download" onSelect={() => run(() => navigate(exportCenter.to))}>
            <FileDown />
            Open export center
          </CommandItem>)}
          <CommandItem value="toggle theme appearance" onSelect={toggleTheme}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            Toggle {theme === 'dark' ? 'light' : 'dark'} mode
            <CommandShortcut>Cmd Shift L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>);
}
