import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
/** Compact 12-point trend used inside KPI tiles — de-emphasized wash + line. */
export function Sparkline({ data, color = 'var(--chart-1)', height = 40, className, }) {
    const id = useId().replace(/:/g, '');
    // A metric with no series still has to hold its slot in the card, or the
    // tiles in a row stop lining up. Reserve the height, draw nothing.
    if (!Array.isArray(data) || data.length === 0) {
        return <div className={className} style={{ height }} aria-hidden/>;
    }
    const series = data.map((value, i) => ({ i, value }));
    const min = Math.min(...data);
    const max = Math.max(...data);
    return (<div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22}/>
              <stop offset="100%" stopColor={color} stopOpacity={0.01}/>
            </linearGradient>
          </defs>
          <YAxis hide domain={[min - (max - min) * 0.2, max + (max - min) * 0.1]}/>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#spark-${id})`} isAnimationActive={false} dot={false}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>);
}
