import { cn } from '@/lib/utils';
/** Identity channel for charts — a colored key beside a text-token label.
 *  Always render for two or more series (never rely on color-matching alone). */
export function ChartLegend({ items, className, }) {
    return (<ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (<li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: item.color }}/>
          {item.label}
        </li>))}
    </ul>);
}
