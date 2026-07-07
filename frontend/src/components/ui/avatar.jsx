import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';
export function Avatar({ className, ...props }) {
    return (<AvatarPrimitive.Root data-slot="avatar" className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full', className)} {...props}/>);
}
export function AvatarImage({ className, ...props }) {
    return (<AvatarPrimitive.Image data-slot="avatar-image" className={cn('aspect-square size-full object-cover', className)} {...props}/>);
}
export function AvatarFallback({ className, ...props }) {
    return (<AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn('flex size-full items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary', className)} {...props}/>);
}
