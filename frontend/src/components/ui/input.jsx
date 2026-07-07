import { cn } from '@/lib/utils';
export function Input({ className, type, ...props }) {
    return (<input type={type} data-slot="input" className={cn('flex h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none', 'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground', 'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40', 'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50', 'file:border-0 file:bg-transparent file:text-sm file:font-medium', className)} {...props}/>);
}
