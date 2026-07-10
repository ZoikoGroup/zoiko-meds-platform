import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_SERIES } from '@/utils/chart';
import { ChartTooltip } from './chart-tooltip';
export function Donut({ data, height = 180, unit = '%', centerValue, centerLabel, }) {
    const resolved = data.map((d, i) => ({
        ...d,
        name: d.label,
        color: d.color ?? CHART_SERIES[i % CHART_SERIES.length],
    }));
    return (<div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
      <div className="relative shrink-0" style={{ width: height, height }}>
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
      <ul className="flex w-full flex-col gap-2.5 pr-2">
        {resolved.map((slice) => (<li key={slice.label} className="flex items-center gap-2.5 text-sm">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: slice.color }}/>
            <span className="text-muted-foreground">{slice.label}</span>
            <span className="ml-auto font-medium tabular">
              {slice.value}
              {unit}
            </span>
          </li>))}
      </ul>
    </div>);
}
