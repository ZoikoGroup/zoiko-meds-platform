import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/shared/states'
import { getReports } from '@/services/pharmacy-api'
import { PieChart, TrendingUp, Flame, Activity, Loader2, AlertCircle } from 'lucide-react'

const STATUS_COLOR = { Available: 'bg-success', Limited: 'bg-warning', 'Out of stock': 'bg-danger' }

// Vertical bar series (series = [{label, value}])
function BarSeries({ series, unit = '' }) {
  if (!series || series.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 text-xs text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-muted-foreground/70" />
        <span>No data available</span>
      </div>
    )
  }

  // A null value means nothing was reported that day. Drawing it as 0 would say
  // "nothing was in stock", which is a different and much worse claim.
  const measured = series.filter((s) => s.value !== null && s.value !== undefined)
  if (measured.length === 0) {
    return (
      <div className="flex h-[140px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/80 px-4 text-center text-xs text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-muted-foreground/70" />
        <span>Not enough history yet — this fills in as you report availability.</span>
      </div>
    )
  }

  const max = Math.max(1, ...measured.map((s) => s.value))
  return (
    <div className="flex items-end gap-2 pt-2" style={{ height: 140 }}>
      {series.map((s) => {
        const unmeasured = s.value === null || s.value === undefined
        return (
          <div key={s.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground tabular">
              {unmeasured ? '—' : `${s.value}${unit}`}
            </span>
            {unmeasured ? (
              <div className="w-full rounded-t-md border-b-2 border-dashed border-border" title="No reports this day" />
            ) : (
              <div
                className="w-full rounded-t-md bg-primary/80 transition-all duration-300"
                style={{ height: `${(s.value / max) * 100}%`, minHeight: s.value > 0 ? '4px' : '0px' }}
              />
            )}
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function PharmacyReports() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReports = useCallback(async () => {
    try {
      const res = await getReports()
      setData(res)
      setError('')
    } catch (err) {
      console.error('Failed to fetch pharmacy reports analytics', err)
      // Said out loud. This used to fall back to demo figures, which put a
      // plausible chart of somebody else's numbers on the operator's screen.
      setError(err.message || 'Could not load your reports.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReports()

    const handleSync = () => loadReports()
    window.addEventListener('pharmacy-status-updated', handleSync)
    window.addEventListener('pharmacy-inventory-updated', handleSync)
    window.addEventListener('focus', handleSync)
    return () => {
      window.removeEventListener('pharmacy-status-updated', handleSync)
      window.removeEventListener('pharmacy-inventory-updated', handleSync)
      window.removeEventListener('focus', handleSync)
    }
  }, [loadReports])

  if (error && !data) {
    return (
      <ErrorState
        title="Could not load reports"
        description={error}
        onRetry={loadReports}
        className="max-w-3xl"
      />
    )
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span>Loading live pharmacy analytics…</span>
      </div>
    )
  }

  const statusBreakdown = data?.statusBreakdown || []
  const totalStatus = statusBreakdown.reduce((a, s) => a + s.value, 0)
  const frequentlyRequested = data?.frequentlyRequested || []
  const maxReq = Math.max(1, ...frequentlyRequested.map((m) => m.requests))
  const availabilityTrend = data?.availabilityTrend || []
  const updateActivity = data?.updateActivity || []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports &amp; analytics" subtitle="Inventory health, availability trends, and demand for your pharmacy." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Inventory status breakdown */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <PieChart className="size-4 text-primary" /> Inventory overview
          </h3>
          {totalStatus > 0 ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {statusBreakdown.map((s) => (
                  <div
                    key={s.label}
                    className={STATUS_COLOR[s.label] ?? 'bg-muted'}
                    style={{ width: `${(s.value / totalStatus) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {statusBreakdown.map((s) => (
                  <div key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className={`size-2.5 rounded-full ${STATUS_COLOR[s.label] ?? 'bg-muted'}`} />
                      {s.label}
                    </span>
                    <span className="font-semibold text-foreground tabular">{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-[140px] items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 text-xs text-muted-foreground">
              <AlertCircle className="size-4 shrink-0 text-muted-foreground/70" />
              <span>No inventory signals found in database</span>
            </div>
          )}
        </Card>

        {/* Availability trend */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-4 text-primary" /> Availability trend
          </h3>
          <BarSeries series={availabilityTrend} unit="%" />
        </Card>

        {/* Frequently requested */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Flame className="size-4 text-primary" /> Frequently requested
          </h3>
          {frequentlyRequested.length > 0 ? (
            <div className="flex flex-col gap-3">
              {frequentlyRequested.map((m) => (
                <div key={m.name || m.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground truncate max-w-[260px]">{m.name}</span>
                    <span className="text-xs text-muted-foreground tabular">{m.requests} requests</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${maxReq > 0 ? (m.requests / maxReq) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-[140px] items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 text-xs text-muted-foreground">
              <AlertCircle className="size-4 shrink-0 text-muted-foreground/70" />
              <span>No medicine requests recorded</span>
            </div>
          )}
        </Card>

        {/* Update activity */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Activity className="size-4 text-primary" /> Update activity
          </h3>
          <BarSeries series={updateActivity} />
        </Card>
      </div>
    </div>
  )
}
