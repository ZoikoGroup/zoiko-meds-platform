import { cn } from '@/lib/utils';
export function Card({ className, ...props }) {
    return (<div data-slot="card" className={cn('flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-soft', className)} {...props}/>);
}
export function CardHeader({ className, ...props }) {
    return (<div data-slot="card-header" className={cn('flex flex-col gap-2.5 px-6 pt-5 pb-4 [&:has(+[data-slot=card-content])]:pb-0', className)} {...props}/>);
}
export function CardTitle({ className, ...props }) {
    return (<div data-slot="card-title" className={cn('text-base font-semibold tracking-tight', className)} {...props}/>);
}
export function CardDescription({ className, ...props }) {
    return (<div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props}/>);
}
export function CardAction({ className, ...props }) {
    return (<div data-slot="card-action" className={cn('absolute top-5 right-6', className)} {...props}/>);
}
export function CardContent({ className, ...props }) {
    return (<div data-slot="card-content" className={cn('px-6 py-4', className)} {...props}/>);
}
export function CardFooter({ className, ...props }) {
    return (<div data-slot="card-footer" className={cn('flex items-center px-6 pt-4 pb-5 border-t border-border/70', className)} {...props}/>);
}
