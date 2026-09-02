import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/sparkline';
import { StatusBadge } from '@/components/shared/status';
import { TrendDelta, deltaSentiment } from '@/components/shared/trend-delta';
import { cn } from '@/lib/utils';
const SPARK_COLOR = {
    positive: 'var(--success)',
    negative: 'var(--danger)',
    neutral: 'var(--chart-1)',
};
export function KpiCard({ metric, icon: Icon, index = 0, className }) {
    const sentiment = deltaSentiment(metric.trend, metric.upIsGood);
    return (<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -3 }}>
      <Card className={cn('group relative overflow-hidden p-5 transition-shadow duration-300 hover:shadow-card', className)}>
        {/* hover glow */}
        <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/5 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"/>

        {/*
          Wraps rather than overflows. A Badge is `whitespace-nowrap shrink-0`,
          so it cannot give up a pixel; without `flex-wrap` a long label
          ("Pending Action") pushed past the card edge and was clipped by
          `overflow-hidden`, and the icon — lacking `shrink-0` — squashed out of
          square trying to absorb it. Now the badge drops to its own line when
          the card is too narrow, and the icon keeps its shape either way.
        */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4.5" aria-hidden/>
          </span>
          <StatusBadge tone={metric.status.severity} size="sm">
            {metric.status.label}
          </StatusBadge>
        </div>

        <div className="mt-4">
          <p className="text-sm text-muted-foreground">{metric.label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight">
              {metric.value}
            </span>
            {/* No delta means no baseline to compare against — showing a bare
                arrow would imply a movement that was never measured. */}
            {metric.delta != null && metric.delta !== '' && (<TrendDelta trend={metric.trend} value={metric.delta} upIsGood={metric.upIsGood}/>)}
          </div>
        </div>

        <div className="mt-3 -mx-1">
          <Sparkline data={metric.spark} color={SPARK_COLOR[sentiment]}/>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{metric.deltaLabel}</p>
      </Card>
    </motion.div>);
}
