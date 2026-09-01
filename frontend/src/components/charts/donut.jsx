import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_SERIES } from '@/utils/chart';
import { ChartTooltip } from './chart-tooltip';
export function Donut({ data, height = 180, unit = '%', centerValue, centerLabel, }) {
    const resolved = data.map((d, i) => ({
        ...d,
        name: d.label,
        color: d.color ?? CHART_SERIES[i % CHART_SERIES.length],
    }));
    // Sized against the card it sits in, not the viewport: this donut lives in one
    // column of a three-column grid, and that column narrows by ~150px the moment
    // the telemetry panel opens. A `sm:` breakpoint asks how wide the *window* is,
    // which says nothing about how much room the card actually has — so the row
    // layout used to stay on in a card far too narrow for it, and the legend ran
    // out past the card and under the panel.
    return (<div className="@container">
      <div className="flex flex-col items-center gap-4 @min-[20rem]:flex-row @min-[20rem]:gap-6">
      <div className="relative aspect-square w-full shrink-0" style={{ maxWidth: height }}>
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
      {/* min-w-0 throughout: a flex item's automatic minimum is its min-content
          width, so without it the longest label ("Fully normalized") sets a floor
          the legend cannot shrink past, and the overflow leaves the card. The
          swatch and the percentage keep their size — the label wraps instead. */}
      <ul className="flex w-full min-w-0 flex-col gap-2.5">
        {resolved.map((slice) => (<li key={slice.label} className="flex items-center gap-2.5 text-sm">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: slice.color }}/>
            <span className="min-w-0 text-muted-foreground">{slice.label}</span>
            <span className="ml-auto shrink-0 font-medium tabular">
              {slice.value}
              {unit}
            </span>
          </li>))}
      </ul>
      </div>
    </div>);
}
