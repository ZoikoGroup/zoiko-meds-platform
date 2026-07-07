import { useNavigate } from 'react-router-dom';
import { FileDown, Layers, Moon, Sparkles, Sun, } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, } from '@/components/ui/command';
import { allNavLinks } from '@/routes/navigation';
import { useTheme } from '@/providers/theme-provider';
export function CommandPalette({ open, onOpenChange }) {
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
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
          <CommandItem value="request enterprise briefing" onSelect={() => run(() => navigate('/enterprise'))}>
            <Sparkles />
            Request enterprise briefing
          </CommandItem>
          <CommandItem value="explore intelligence stack" onSelect={() => run(() => navigate('/enterprise'))}>
            <Layers />
            Explore intelligence stack
          </CommandItem>
          <CommandItem value="export report download" onSelect={() => run(() => navigate('/reports'))}>
            <FileDown />
            Open export center
          </CommandItem>
          <CommandItem value="toggle theme appearance" onSelect={toggleTheme}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            Toggle {theme === 'dark' ? 'light' : 'dark'} mode
            <CommandShortcut>⌘⇧L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>);
}
