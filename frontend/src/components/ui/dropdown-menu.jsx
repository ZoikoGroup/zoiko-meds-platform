import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }) {
    return (<DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={cn('z-50 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-elevated', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95', className)} {...props}/>
    </DropdownMenuPrimitive.Portal>);
}
export function DropdownMenuItem({ className, inset, variant = 'default', ...props }) {
    return (<DropdownMenuPrimitive.Item data-slot="dropdown-menu-item" className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors', 'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground', inset && 'pl-8', variant === 'danger' &&
            'text-danger focus:bg-danger/10 focus:text-danger [&_svg]:text-danger', className)} {...props}/>);
}
export function DropdownMenuCheckboxItem({ className, children, checked, ...props }) {
    return (<DropdownMenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" checked={checked} className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pr-2 pl-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4"/>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>);
}
export function DropdownMenuRadioItem({ className, children, ...props }) {
    return (<DropdownMenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pr-2 pl-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-current"/>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>);
}
export function DropdownMenuLabel({ className, inset, ...props }) {
    return (<DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn('px-2.5 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', className)} {...props}/>);
}
export function DropdownMenuSeparator({ className, ...props }) {
    return (<DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props}/>);
}
export function DropdownMenuShortcut({ className, ...props }) {
    return (<span className={cn('ml-auto text-xs tracking-widest text-muted-foreground tabular', className)} {...props}/>);
}
export function DropdownMenuSubTrigger({ className, inset, children, ...props }) {
    return (<DropdownMenuPrimitive.SubTrigger className={cn('flex cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent', inset && 'pl-8', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto size-4"/>
    </DropdownMenuPrimitive.SubTrigger>);
}
export function DropdownMenuSubContent({ className, ...props }) {
    return (<DropdownMenuPrimitive.SubContent className={cn('z-50 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-elevated', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)} {...props}/>);
}
