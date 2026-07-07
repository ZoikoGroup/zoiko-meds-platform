import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = 'center', sideOffset = 6, ...props }) {
    return (<PopoverPrimitive.Portal>
      <PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn('z-50 w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-elevated outline-none', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95', className)} {...props}/>
    </PopoverPrimitive.Portal>);
}
