import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { CHART_GRID, CHART_SERIES, axisProps } from '@/utils/chart';
import { ChartTooltip } from './chart-tooltip';
import { ChartLegend } from './chart-legend';
export function TrendChart({ data, xKey, series, type = 'area', height = 260, unit = '', valueFormatter, yDomain = ['auto', 'auto'], yWidth = 40, legend = true, }) {
    const gid = useId().replace(/:/g, '');
    const resolved = series.map((s, i) => ({
        ...s,
        color: s.color ?? CHART_SERIES[i % CHART_SERIES.length],
    }));
    const Chart = type === 'area' ? AreaChart : LineChart;
    return (<div className="flex flex-col gap-3">
      {legend && resolved.length >= 2 && (<ChartLegend className="justify-end" items={resolved.map((s) => ({ label: s.label, color: s.color }))}/>)}
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {resolved.map((s) => (<linearGradient key={s.key} id={`grad-${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.18}/>
                <stop offset="90%" stopColor={s.color} stopOpacity={0.02}/>
              </linearGradient>))}
          </defs>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1}/>
          <XAxis dataKey={xKey} {...axisProps} dy={8} minTickGap={16}/>
          <YAxis {...axisProps} width={yWidth} domain={yDomain} tickFormatter={(v) => valueFormatter ? valueFormatter(v) : `${v}${unit}`}/>
          <Tooltip cursor={{ stroke: CHART_GRID, strokeWidth: 1.5 }} content={<ChartTooltip valueFormatter={valueFormatter} unit={unit}/>}/>
          {resolved.map((s) => type === 'area' ? (<Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#grad-${gid}-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} animationDuration={800}/>) : (<Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} animationDuration={800}/>))}
        </Chart>
      </ResponsiveContainer>
    </div>);
}
