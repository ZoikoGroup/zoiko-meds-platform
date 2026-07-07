import { cn } from '@/lib/utils';
export function Skeleton({ className, ...props }) {
    return (<div data-slot="skeleton" className={cn('rounded-md bg-gradient-to-r from-muted via-accent to-muted bg-[length:200%_100%] animate-shimmer', className)} {...props}/>);
}
