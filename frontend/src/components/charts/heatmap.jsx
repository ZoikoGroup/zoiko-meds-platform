import { seqStep } from '@/utils/chart';
import { cn } from '@/lib/utils';
/** Sequential-ramp grid heatmap with per-cell hover + a magnitude legend. */
export function Heatmap({ rows, cols, max = 100, className }) {
    return (<div className={cn('flex flex-col gap-4', className)}>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {/* Column header */}
          <div className="grid items-center gap-1.5 pb-1.5" style={{ gridTemplateColumns: `140px repeat(${cols.length}, 1fr)` }}>
            <div />
            {cols.map((c) => (<div key={c} className="text-center text-[11px] font-medium text-muted-foreground">
                {c}
              </div>))}
          </div>
          {/* Rows */}
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (<div key={row.region} className="grid items-center gap-1.5" style={{
                gridTemplateColumns: `140px repeat(${cols.length}, 1fr)`,
            }}>
                <div className="truncate pr-2 text-xs font-medium text-foreground">
                  {row.region}
                </div>
                {row.cells.map((value, i) => {
                const intensity = value / max;
                return (<div key={i} title={`${row.region} · ${cols[i]}: ${value}`} className="group flex h-8 items-center justify-center rounded-md text-[11px] font-medium tabular transition-transform hover:scale-[1.08] hover:ring-2 hover:ring-ring/40" style={{
                        backgroundColor: seqStep(value, max),
                        color: intensity > 0.52 ? '#fff' : 'var(--foreground)',
                    }}>
                      {value}
                    </div>);
            })}
              </div>))}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 self-end text-xs text-muted-foreground">
        <span>Lower</span>
        <div className="flex h-2.5 w-28 overflow-hidden rounded-full">
          {Array.from({ length: 8 }, (_, i) => (<div key={i} className="flex-1" style={{ backgroundColor: seqStep((i / 7) * max, max) }}/>))}
        </div>
        <span>Higher access risk</span>
      </div>
    </div>);
}
