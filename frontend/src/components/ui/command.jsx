import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
export function Command({ className, ...props }) {
    return (<CommandPrimitive data-slot="command" className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground', className)} {...props}/>);
}
export function CommandDialog({
  children,
  className,
  title = 'Command palette',
  description = 'Search pages, actions, and intelligence',
  ...props
}) {
    return (<Dialog {...props}>
      <DialogContent showClose={false} className={cn('overflow-hidden p-0 sm:max-w-xl', className)}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]_svg]:size-4.5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>);
}
export function CommandInput({ className, ...props }) {
    return (<div className="flex items-center gap-2.5 border-b border-border px-4" cmdk-input-wrapper="">
      <Search className="size-4.5 shrink-0 text-muted-foreground"/>
      <CommandPrimitive.Input data-slot="command-input" className={cn('flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', className)} {...props}/>
    </div>);
}
export function CommandList({ className, ...props }) {
    return (<CommandPrimitive.List data-slot="command-list" className={cn('max-h-[22rem] overflow-y-auto overflow-x-hidden p-1.5', className)} {...props}/>);
}
export function CommandEmpty(props) {
    return (<CommandPrimitive.Empty data-slot="command-empty" className="py-8 text-center text-sm text-muted-foreground" {...props}/>);
}
export function CommandGroup({ className, ...props }) {
    return (<CommandPrimitive.Group data-slot="command-group" className={cn('overflow-hidden p-1 text-foreground', className)} {...props}/>);
}
export function CommandSeparator({ className, ...props }) {
    return (<CommandPrimitive.Separator data-slot="command-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props}/>);
}
export function CommandItem({ className, ...props }) {
    return (<CommandPrimitive.Item data-slot="command-item" className={cn('relative flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none', 'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground', 'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50', '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground', className)} {...props}/>);
}
export function CommandShortcut({ className, ...props }) {
    return (<span className={cn('ml-auto text-xs tracking-widest text-muted-foreground tabular', className)} {...props}/>);
}
