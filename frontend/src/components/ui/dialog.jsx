import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export function DialogOverlay({ className, ...props }) {
    return (<DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)} {...props}/>);
}
export function DialogContent({ className, children, showClose = true, ...props }) {
    return (<DialogPortal>
      <DialogOverlay />
      {/* Centred on the viewport, so a dialog taller than the screen would otherwise
          be clipped at the top and the bottom at once with no way to reach either:
          the height is capped and the overflow scrolls. A dialog that wants a fixed
          header or footer overrides this with its own inner scroll region. */}
      <DialogPrimitive.Content data-slot="dialog-content" className={cn('fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 shadow-elevated', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95', className)} {...props}>
        {children}
        {showClose && (<DialogPrimitive.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring outline-none">
            <X className="size-4"/>
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>)}
      </DialogPrimitive.Content>
    </DialogPortal>);
}
export function DialogHeader({ className, ...props }) {
    return (<div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 text-left', className)} {...props}/>);
}
export function DialogFooter({ className, ...props }) {
    return (<div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props}/>);
}
export function DialogTitle({ className, ...props }) {
    return (<DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold tracking-tight', className)} {...props}/>);
}
export function DialogDescription({ className, ...props }) {
    return (<DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props}/>);
}
