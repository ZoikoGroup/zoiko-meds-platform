import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radar, ArrowRight, BellOff } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOTIF_META } from '@/features/signal/signal-meta'
import { getSignalDigest } from '@/services/signal-api'

// Compact ZoikoSignal summary for the patient home page.
export function SignalWidget() {
  const [digest, setDigest] = useState(null)

  useEffect(() => {
    let alive = true
    getSignalDigest().then((d) => alive && setDigest(d)).catch(() => {})
    return () => { alive = false }
  }, [])

  const alerts = digest?.alerts ?? []
  const unread = digest?.unread ?? 0

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <span className="relative flex size-4 items-center justify-center text-primary">
            <Radar className="size-4" />
            <span className="absolute -right-1 -top-1 size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
          </span>
          ZoikoSignal™
        </h3>
        {unread > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            {unread} new
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-4 text-center">
          <BellOff className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No new signals for your saved medicines.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {alerts.map((a) => {
            const meta = NOTIF_META[a.type] ?? NOTIF_META['running-low']
            return (
              <li key={a.id} className="flex items-center gap-2.5">
                <span className={cn('size-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  <span className="font-semibold">{a.medicine}</span>{' '}
                  <span className="text-muted-foreground">
                    {a.type === 'back-in-stock' ? 'is back in stock' : a.type === 'limited' ? 'has limited availability' : 'is running low'}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Button asChild variant="ghost" size="sm" className="w-fit px-2 text-primary hover:bg-primary/5">
        <Link to="/signal">
          View all
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </Card>
  )
}
