import { motion } from 'framer-motion'
import { Heart, Clock, MapPin, Timer, Pill, Ambulance, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status'
import { cn } from '@/lib/utils'
import { STATUS_META, PRIORITY_META } from '@/features/signal/signal-meta'
import { formatDistanceKm } from '@/lib/user-location'
import { useLanguage } from '@/providers/language-provider'

export function SavedMedicineCard({ med, index = 0, onQuickAction, onCyclePriority }) {
  const { t } = useLanguage()
  const status = STATUS_META[med.status] ?? STATUS_META.available
  const prio = PRIORITY_META[med.priority] ?? PRIORITY_META.low
  const outOfStock = med.status === 'out-of-stock'
  const quickLabel = outOfStock ? 'Find alternatives' : 'Find pharmacy'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-card">
        {/* Title + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <Heart className="mt-0.5 size-4 shrink-0 fill-danger/80 text-danger" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold text-foreground">{med.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {med.generic} · {med.strength}
              </span>
            </div>
          </div>
          <StatusBadge tone={status.tone} size="sm">
            {status.label}
          </StatusBadge>
        </div>

        {/* Detail box */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs">
          {med.nearest ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="size-3.5 text-teal" />
                {med.nearest.name}
              </span>
              <span className="flex items-center gap-1.5">
                {med.nearest.is24x7 && (
                  <Badge variant="success" size="sm" className="gap-1">
                    <Ambulance className="size-3" />
                    24/7
                  </Badge>
                )}
                {/* Null whenever the patient has not shared a location — the
                    API names the pharmacy but will not measure to it. Printed
                    raw that rendered as a bare " km". */}
                <span className="font-semibold text-foreground tabular">
                  {formatDistanceKm(med.nearest.distance, med.nearest.approximate)}
                </span>
              </span>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5" />
              No pharmacy within your search radius has this medicine
            </span>
          )}

          {med.estDuration && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Timer className="size-3.5" />
                Estimated availability
              </span>
              <span className="font-semibold text-foreground">{med.estDuration}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="size-3" />
              Updated
            </span>
            <span className="font-medium text-foreground">{med.updated}</span>
          </div>
        </div>

        {/* Suggested alternatives when unavailable */}
        {outOfStock && med.alternatives?.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suggested alternatives
            </span>
            <div className="flex flex-wrap gap-1.5">
              {med.alternatives.map((alt) => (
                <button
                  key={alt}
                  onClick={() => onQuickAction?.(alt)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-teal/40 hover:text-teal"
                >
                  <Pill className="size-3 text-teal" />
                  {alt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer: priority + quick action */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <button
            onClick={() => onCyclePriority?.(med)}
            title={t('changePriority', 'Change priority')}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Badge variant={prio.variant} size="sm" className={cn('cursor-pointer', med.priority === 'high' && 'gap-1')}>
              {prio.label}
            </Badge>
          </button>
          <Button variant="outline" size="sm" onClick={() => onQuickAction?.(med.name)}>
            {quickLabel}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}
