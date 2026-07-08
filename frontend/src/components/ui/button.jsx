import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,box-shadow,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0", {
    variants: {
        variant: {
            default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
            teal: 'bg-teal text-teal-foreground shadow-xs hover:bg-teal/90',
            destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
            outline: 'border border-border bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70',
            ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
            link: 'text-primary underline-offset-4 hover:underline',
        },
        size: {
            default: 'h-9 px-4 py-2 has-[>svg]:px-3',
            sm: 'h-8 rounded-md px-3 text-[13px] has-[>svg]:px-2.5',
            lg: 'h-11 rounded-xl px-6 has-[>svg]:px-4 text-[15px]',
            icon: 'size-9',
            'icon-sm': 'size-8 rounded-md',
        },
    },
    defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, ...props }) {
    const Comp = asChild ? Slot : 'button';
    return (<Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}/>);
}
export { buttonVariants };
