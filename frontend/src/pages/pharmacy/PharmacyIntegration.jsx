import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { getIntegration, triggerSync } from '@/services/pharmacy-api'
import { PlugZap, RefreshCw, Loader2, Clock } from 'lucide-react'

const SYNC_TONE = { success: 'good', partial: 'warning', failed: 'critical' }

export default function PharmacyIntegration() {
  const [data, setData] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [flashMsg, flash] = useFlash()

  useEffect(() => {
    let alive = true
    getIntegration().then((d) => alive && setData(d)).catch(() => {})
    return () => { alive = false }
  }, [])

  const manualSync = async () => {
    setSyncing(true)
    try {
      const next = await triggerSync()
      setData(next)
      flash('Manual sync completed')
    } catch {
      flash('Sync failed — please try again')
    } finally {
      setSyncing(false)
    }
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading integration status…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integration"
        subtitle="Connect your POS / ERP so availability stays fresh automatically."
        actions={
          <Button onClick={manualSync} disabled={syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sync now
          </Button>
        }
      />
      {flashMsg && <Flash message={flashMsg} />}

      {/* Connection status */}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <PlugZap className="size-5" />
            </span>
            <div className="flex flex-col">
              <span className="text-base font-bold text-foreground">{data.provider}</span>
              <span className="text-xs text-muted-foreground">Automatic delta sync</span>
            </div>
          </div>
          <Badge variant={data.connected ? 'success' : 'secondary'} size="sm">
            {data.connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Last sync</span>
            <span className="font-semibold text-foreground">{data.lastSync}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Next sync</span>
            <span className="font-semibold text-foreground">{data.nextSync}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="font-semibold text-success">Healthy</span>
          </div>
        </div>
      </Card>

      {/* Sync history */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Clock className="size-4 text-primary" />
          Sync history
        </h3>
        <Card className="divide-y divide-border p-0">
          {data.history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">{h.note}</span>
                <span className="text-xs text-muted-foreground">{h.when} · {h.rows} rows</span>
              </div>
              <StatusBadge tone={SYNC_TONE[h.status] ?? 'neutral'} size="sm">
                {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
              </StatusBadge>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
