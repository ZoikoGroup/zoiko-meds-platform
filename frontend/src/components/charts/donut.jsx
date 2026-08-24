import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_SERIES } from '@/utils/chart';
import { ChartTooltip } from './chart-tooltip';
/**
 * Ring chart with a legend beside it.
 *
 * Sized against its own container, never the viewport (MSA-28). It used to go
 * side-by-side at the `sm:` breakpoint — 640px of *window* — while living in a
 * card that is a third of a grid column: on the Super Admin dashboard that card
 * is 146–338px wide depending on the activity panel, so the 180px fixed ring
 * plus a legend needed ~334px and spilled straight out over the card border and
 * the panel next to it. Card has no overflow-hidden, so it overlapped rather
 * than clipped.
 *
 * Two things keep that fixed: the layout switch is a container query, so it
 * only splits when this component actually has the width for two columns, and
 * the ring is width-driven with `height` as a ceiling rather than a fixed size,
 * so it can never be wider than what contains it.
 */
export function Donut({ data, height = 180, unit = '%', centerValue, centerLabel, }) {
    const resolved = data.map((d, i) => ({
        ...d,
        name: d.label,
        color: d.color ?? CHART_SERIES[i % CHART_SERIES.length],
    }));
    return (<div className="@container">
      <div className="flex flex-col items-center gap-4 @md:flex-row @md:gap-6">
        {/* aspect-square, so the height follows whatever width survives. */}
        <div className="relative aspect-square w-full shrink-0 @md:w-[45%]" style={{ maxWidth: height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={resolved} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="var(--card)" strokeWidth={2} animationDuration={700}>
                {resolved.map((slice) => (<Cell key={slice.label} fill={slice.color}/>))}
              </Pie>
              <Tooltip content={<ChartTooltip unit={unit}/>}/>
            </PieChart>
          </ResponsiveContainer>
          {centerValue && (<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tracking-tight">
                {centerValue}
              </span>
              {centerLabel && (<span className="text-[10px] text-muted-foreground text-center px-2">{centerLabel}</span>)}
            </div>)}
        </div>
        {/* min-w-0 is what lets a long label truncate instead of forcing the row
            wider than the card. w-full alone could not shrink past min-content. */}
        <ul className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          {resolved.map((slice) => (<li key={slice.label} className="flex items-center gap-2.5 text-sm">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: slice.color }}/>
              <span className="truncate text-muted-foreground" title={slice.label}>{slice.label}</span>
              <span className="ml-auto shrink-0 font-medium tabular">
                {slice.value}
                {unit}
              </span>
            </li>))}
        </ul>
      </div>
    </div>);
}
