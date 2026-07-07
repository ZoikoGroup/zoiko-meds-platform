import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const badgeVariants = cva('inline-flex items-center justify-center gap-1.5 rounded-full border font-medium whitespace-nowrap w-fit shrink-0 [&>svg]:size-3.5 transition-colors', {
    variants: {
        variant: {
            default: 'border-transparent bg-primary/10 text-primary',
            secondary: 'border-border bg-secondary text-secondary-foreground',
            outline: 'border-border text-muted-foreground',
            success: 'border-transparent bg-success/12 text-success dark:text-success',
            warning: 'border-transparent bg-warning/15 text-warning dark:text-warning',
            danger: 'border-transparent bg-danger/12 text-danger dark:text-danger',
            info: 'border-transparent bg-info/12 text-info dark:text-info',
            teal: 'border-transparent bg-teal/12 text-teal dark:text-teal',
        },
        size: {
            default: 'px-2.5 py-0.5 text-xs',
            sm: 'px-2 py-0.5 text-[11px]',
            lg: 'px-3 py-1 text-[13px]',
        },
    },
    defaultVariants: { variant: 'default', size: 'default' },
});
export function Badge({ className, variant, size, asChild = false, ...props }) {
    const Comp = asChild ? Slot : 'span';
    return (<Comp data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props}/>);
}
export { badgeVariants };
