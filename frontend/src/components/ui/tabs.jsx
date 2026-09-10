import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
export function Tabs({ className, ...props }) {
    return (<TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props}/>);
}
/**
 * The tab strip, and a scroll container around it.
 *
 * The strip is `w-fit` with `whitespace-nowrap` triggers, so it is as wide as
 * its labels need — five of them on Super Admin → Commercial come to 552px.
 * Nothing above it clipped or scrolled, so on a 360px phone that 552 became the
 * width of the document: measured at 360px, `documentElement.scrollWidth` was
 * 568 against a 360 layout viewport. The whole page could then be dragged
 * sideways, which is why the test-mode banner and the Approved Prices card
 * looked clipped on the left and a blank strip sat on the right.
 *
 * The wrapper contains that. `min-w-0` matters as much as the overflow: a
 * scroll container that is itself a flex or grid item keeps `min-width: auto`
 * and is sized by its content, so it would grow to 552 and have nothing left
 * to scroll. `w-max` on the strip keeps its natural width inside the box
 * rather than letting it squash.
 *
 * Only the strip scrolls. A tab strip that fits — every desktop, and the
 * shorter strips on other pages — is untouched, because `overflow-x-auto`
 * shows nothing when there is nothing to scroll.
 */
export function TabsList({ className, ...props }) {
    return (<div data-slot="tabs-list-scroll" className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
      <TabsPrimitive.List data-slot="tabs-list" className={cn('inline-flex h-9 w-max items-center justify-center gap-1 rounded-xl border border-border bg-muted/60 p-1 text-muted-foreground', className)} {...props}/>
    </div>);
}
export function TabsTrigger({ className, ...props }) {
    return (<TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", 'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs', 'hover:text-foreground', className)} {...props}/>);
}
export function TabsContent({ className, ...props }) {
    return (<TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props}/>);
}
