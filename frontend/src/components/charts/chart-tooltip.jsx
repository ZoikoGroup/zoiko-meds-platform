import { cn } from '@/lib/utils';
/** Shared tooltip: date/label header, then a colored key + name + value per
 *  series. Text stays in ink tokens; only the small dot wears the series color. */
export function ChartTooltip({ active, payload, label, valueFormatter, unit = '', className, labelPrefix, }) {
    if (!active || !payload || payload.length === 0)
        return null;
    return (<div className={cn('min-w-40 rounded-lg border border-border bg-popover/95 px-3 py-2 shadow-elevated backdrop-blur-sm', className)}>
      {label != null && (<div className="mb-1.5 text-xs font-medium text-foreground">
          {labelPrefix}
          {label}
        </div>)}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
            const value = typeof entry.value === 'number' && valueFormatter
                ? valueFormatter(entry.value)
                : `${entry.value}${unit}`;
            return (<div key={i} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: entry.color }}/>
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="ml-auto pl-4 font-medium text-foreground tabular">
                {value}
              </span>
            </div>);
        })}
      </div>
    </div>);
}
