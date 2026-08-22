import { motion } from 'framer-motion'
import { Clock, X, MapPin, Navigation, ShieldAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOTIF_META } from '@/features/signal/signal-meta'

// A prominent, actionable alert card — status icon, title, description,
// timestamp, and a primary action (+ optional dismiss).
export function AlertCard({ alert, index = 0, onAction, onDismiss }) {
  const meta = NOTIF_META[alert.type] ?? NOTIF_META['running-low']
  const Icon = meta.icon
  const ActionIcon =
    alert.action?.kind === 'read' ? ShieldAlert : alert.action?.kind === 'locate' ? Navigation : MapPin

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.32, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="group relative overflow-hidden p-5 transition-shadow hover:shadow-card">
        {/* status accent rail */}
        <span className={cn('absolute inset-y-0 start-0 w-1', meta.dot)} aria-hidden />
        <div className="flex items-start gap-4 ps-1">
          <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', meta.chip)}>
            <Icon className="size-5.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', meta.text)}>
                <span className={cn('size-2 rounded-full', meta.dot)} aria-hidden />
                {meta.label}
              </span>
            </div>
            <h4 className="truncate text-base font-bold tracking-tight text-foreground">{alert.medicine}</h4>
            <p className="text-sm leading-relaxed text-muted-foreground">{alert.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {alert.action && (
                <Button size="sm" variant="teal" onClick={() => onAction?.(alert)}>
                  <ActionIcon className="size-3.5" />
                  {alert.action.label}
                </Button>
              )}
              {onDismiss && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => onDismiss(alert.id)}
                >
                  <X className="size-3.5" />
                  Dismiss
                </Button>
              )}
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {alert.time}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
