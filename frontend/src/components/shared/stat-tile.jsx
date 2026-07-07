import { Card } from '@/components/ui/card';
import { TrendDelta } from '@/components/shared/trend-delta';
import { cn } from '@/lib/utils';
const ACCENT = {
    good: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/12',
    serious: 'text-info bg-info/10',
    critical: 'text-danger bg-danger/10',
};
export function StatTile({ label, value, unit, delta, trend, upIsGood = true, icon: Icon, severity, className, }) {
    return (<Card className={cn('gap-3 p-5', className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && (<span className={cn('flex size-8 items-center justify-center rounded-lg', severity ? ACCENT[severity] : 'bg-primary/10 text-primary')}>
            <Icon className="size-4" aria-hidden/>
          </span>)}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tracking-tight">{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
        {delta && trend && (<TrendDelta trend={trend} value={delta} upIsGood={upIsGood}/>)}
      </div>
    </Card>);
}
