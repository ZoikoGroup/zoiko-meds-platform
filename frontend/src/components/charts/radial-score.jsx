import { cn } from '@/lib/utils';
const SEVERITY_COLOR = {
    good: 'var(--success)',
    warning: 'var(--warning)',
    serious: 'var(--info)',
    critical: 'var(--danger)',
    default: 'var(--primary)',
};
/** 270° ring gauge — a single headline score with a severity-tinted arc. */
export function RadialScore({ value, max = 100, label, caption, severity = 'default', size = 168, className, }) {
    const stroke = 12;
    const r = (size - stroke) / 2;
    const cx = size / 2;
    const circumference = 2 * Math.PI * r;
    const sweep = 0.75; // 270° of the circle
    const pct = Math.max(0, Math.min(1, value / max));
    const color = SEVERITY_COLOR[severity];
    return (<div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[135deg]">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--chart-grid)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${sweep * circumference} ${circumference}`}/>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${pct * sweep * circumference} ${circumference}`} style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)' }}/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight">
          {label ?? value}
        </span>
        {caption && (<span className="mt-0.5 text-xs text-muted-foreground">{caption}</span>)}
      </div>
    </div>);
}
