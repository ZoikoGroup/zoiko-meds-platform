import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;
const sheetVariants = cva('fixed z-50 flex flex-col gap-4 bg-card shadow-elevated transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500', {
    variants: {
        side: {
            top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
            bottom: 'inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            // `h-[100dvh]`, not `h-full`. A fixed element's `height: 100%`
            // resolves against the initial containing block, which on a mobile
            // browser is the *large* viewport — the one that assumes the URL
            // bar is hidden. So a drawer taller than the visible area put its
            // last rows behind the browser chrome, unreachable, which is how
            // the pharmacy portal's Sign Out disappeared. dvh tracks what is
            // actually on screen and equals vh on a desktop, so nothing above
            // mobile changes. `inset-y-0` stays for the top edge: a fixed box
            // with top, bottom and a set height ignores bottom.
            left: 'inset-y-0 left-0 h-[100dvh] w-3/4 max-w-sm border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
            right: 'inset-y-0 right-0 h-[100dvh] w-3/4 max-w-sm border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        },
    },
    defaultVariants: { side: 'right' },
});
export function SheetContent({ className, children, side = 'right', showClose = true, ...props }) {
    return (<SheetPortal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"/>
      <SheetPrimitive.Content data-slot="sheet-content" className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {showClose && (<SheetPrimitive.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring outline-none">
            <X className="size-4"/>
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>)}
      </SheetPrimitive.Content>
    </SheetPortal>);
}
export function SheetHeader({ className, ...props }) {
    return (<div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-6 pb-2', className)} {...props}/>);
}
export function SheetFooter({ className, ...props }) {
    return (<div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-6', className)} {...props}/>);
}
export function SheetTitle({ className, ...props }) {
    return (<SheetPrimitive.Title data-slot="sheet-title" className={cn('text-base font-semibold tracking-tight', className)} {...props}/>);
}
export function SheetDescription({ className, ...props }) {
    return (<SheetPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', className)} {...props}/>);
}
