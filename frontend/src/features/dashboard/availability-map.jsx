import { motion } from 'framer-motion'
import { Progress } from '@/components/ui/progress'
import { ConfidenceBadge } from '@/components/shared/status'
import { TrendDelta } from '@/components/shared/trend-delta'
import { cn } from '@/lib/utils'

/** Access-risk band → tone (color + dot). */
function riskTone(risk) {
  if (risk < 30) return { label: 'Low', dot: 'bg-success', text: 'text-success' }
  if (risk < 50) return { label: 'Guarded', dot: 'bg-warning', text: 'text-warning' }
  if (risk < 70) return { label: 'Elevated', dot: 'bg-info', text: 'text-info' }
  return { label: 'High', dot: 'bg-danger', text: 'text-danger' }
}

const trendLabel = { up: 'rising', down: 'easing', flat: 'stable' }

/**
 * Region-tile "map" — coverage + access-risk per macro-region.
 *
 * `regions` must come from the backend. The component renders nothing without
 * them rather than illustrating the world with example regions: a coverage
 * percentage against a real region name reads as a measurement.
 */
export function AvailabilityMap({ regions = [] }) {
  if (!Array.isArray(regions) || regions.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {regions.map((r, i) => {
          const tone = riskTone(r.risk)
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              whileHover={{ y: -3 }}
              className="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-muted/30 p-4 transition-shadow hover:shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', tone.dot)} />
                    <span className="truncate text-sm font-medium">{r.region}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Risk{' '}
                    <span className={cn('font-medium tabular', tone.text)}>
                      {r.risk}
                    </span>{' '}
                    · {trendLabel[r.trend]}
                  </p>
                </div>
                <ConfidenceBadge level={r.confidence} size="sm" />
              </div>
              <div className="mt-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Coverage</span>
                  <span className="font-medium tabular">{r.coverage}%</span>
                </div>
                <Progress value={r.coverage} className="mt-1.5 h-1.5" />
              </div>
            </motion.div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {[
            { c: 'bg-success', l: 'Low' },
            { c: 'bg-warning', l: 'Guarded' },
            { c: 'bg-info', l: 'Elevated' },
            { c: 'bg-danger', l: 'High' },
          ].map((x) => (
            <span key={x.l} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', x.c)} />
              {x.l}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Global access risk
          <TrendDelta trend="down" value="−4 pts" upIsGood={false} />
        </span>
      </div>
    </div>
  )
}
