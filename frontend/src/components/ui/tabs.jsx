import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
export function Tabs({ className, ...props }) {
    return (<TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props}/>);
}
export function TabsList({ className, ...props }) {
    return (<TabsPrimitive.List data-slot="tabs-list" className={cn('inline-flex h-9 w-fit items-center justify-center gap-1 rounded-xl border border-border bg-muted/60 p-1 text-muted-foreground', className)} {...props}/>);
}
export function TabsTrigger({ className, ...props }) {
    return (<TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", 'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs', 'hover:text-foreground', className)} {...props}/>);
}
export function TabsContent({ className, ...props }) {
    return (<TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props}/>);
}
