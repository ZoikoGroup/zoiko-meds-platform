import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { CHART_GRID, CHART_MUTED, CHART_SERIES, axisProps } from '@/utils/chart';
import { ChartTooltip } from './chart-tooltip';
import { ChartLegend } from './chart-legend';
export function BarCompare({ data, categoryKey, valueKey, color = CHART_SERIES[0], height = 280, unit = '', showValues = true, }) {
    return (<ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: showValues ? 40 : 12, bottom: 0, left: 8 }} barCategoryGap="26%">
        <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1}/>
        <XAxis type="number" hide domain={[0, 'dataMax']}/>
        <YAxis type="category" dataKey={categoryKey} {...axisProps} width={148} tick={{ fill: CHART_MUTED, fontSize: 12 }}/>
        <Tooltip cursor={{ fill: 'var(--accent)', opacity: 0.5 }} content={<ChartTooltip unit={unit}/>}/>
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={20}>
          {showValues && (<LabelList dataKey={valueKey} position="right" className="fill-foreground text-xs tabular" formatter={(v) => `${v}${unit}`}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>);
}
export function GroupedBars({ data, xKey, series, height = 280, unit = '', yDomain, }) {
    const resolved = series.map((s, i) => ({
        ...s,
        color: s.color ?? CHART_SERIES[i % CHART_SERIES.length],
    }));
    return (<div className="flex flex-col gap-3">
      <ChartLegend className="justify-end" items={resolved.map((s) => ({ label: s.label, color: s.color }))}/>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1}/>
          <XAxis dataKey={xKey} {...axisProps} dy={8} interval={0}/>
          <YAxis {...axisProps} width={40} domain={yDomain} tickFormatter={(v) => `${v}${unit}`}/>
          <Tooltip cursor={{ fill: 'var(--accent)', opacity: 0.5 }} content={<ChartTooltip unit={unit}/>}/>
          {resolved.map((s) => (<Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={700}/>))}
        </BarChart>
      </ResponsiveContainer>
    </div>);
}
