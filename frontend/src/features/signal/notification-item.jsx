import { motion } from 'framer-motion'
import { Clock, Check, Archive, Trash2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOTIF_META } from '@/features/signal/signal-meta'
import { useLanguage } from '@/providers/language-provider'

// A single row in the smart-notifications feed.
export function NotificationItem({ notification: n, index = 0, onAction, onRead, onArchive, onDelete }) {
  const { t } = useLanguage()
  const meta = NOTIF_META[n.type] ?? NOTIF_META['running-low']
  const Icon = meta.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.26, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border p-3.5 transition-colors',
        n.read ? 'bg-card' : 'bg-primary/[0.035]',
      )}
    >
      <span className={cn('relative flex size-9 shrink-0 items-center justify-center rounded-xl', meta.chip)}>
        <Icon className="size-4.5" />
        {!n.read && (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" aria-hidden />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className={cn('text-[11px] font-semibold uppercase tracking-wide', meta.text)}>{meta.label}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            {n.time}
          </span>
        </div>
        <p className="text-sm font-semibold text-foreground">{n.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{n.description}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {n.action && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-primary hover:bg-primary/5" onClick={() => onAction?.(n)}>
              {n.action.label}
              <ArrowRight className="size-3" />
            </Button>
          )}
          {!n.read && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => onRead?.(n.id)}>
              <Check className="size-3" />
              Mark read
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => onArchive?.(n.id)}>
            <Archive className="size-3" />
            Archive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-danger"
            aria-label={t('deleteNotificationNamed', 'Delete notification: {title}', { title: n.title })}
            onClick={() => onDelete?.(n.id)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
