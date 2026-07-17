import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { getReports } from '@/services/pharmacy-api'
import { PieChart, TrendingUp, Flame, Activity, Loader2 } from 'lucide-react'

const STATUS_COLOR = { Available: 'bg-success', Limited: 'bg-warning', 'Out of stock': 'bg-danger' }

// Simple vertical bar series (avoids a chart dependency; series = [{label, value}]).
function BarSeries({ series, unit = '' }) {
  const max = Math.max(1, ...series.map((s) => s.value))
  return (
    <div className="flex items-end gap-2 pt-2" style={{ height: 140 }}>
      {series.map((s) => (
        <div key={s.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground tabular">{s.value}{unit}</span>
          <div className="w-full rounded-t-md bg-primary/80 transition-all" style={{ height: `${(s.value / max) * 100}%` }} />
          <span className="text-[10px] text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function PharmacyReports() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let alive = true
    getReports().then((d) => alive && setData(d)).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading reports…
      </div>
    )
  }

  const totalStatus = data.statusBreakdown.reduce((a, s) => a + s.value, 0) || 1
  const maxReq = Math.max(1, ...data.frequentlyRequested.map((m) => m.requests))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports &amp; analytics" subtitle="Inventory health, availability trends, and demand for your pharmacy." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Inventory status breakdown */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <PieChart className="size-4 text-primary" /> Inventory overview
          </h3>
          <div className="flex h-3 overflow-hidden rounded-full">
            {data.statusBreakdown.map((s) => (
              <div key={s.label} className={STATUS_COLOR[s.label] ?? 'bg-muted'} style={{ width: `${(s.value / totalStatus) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {data.statusBreakdown.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className={`size-2.5 rounded-full ${STATUS_COLOR[s.label] ?? 'bg-muted'}`} />
                  {s.label}
                </span>
                <span className="font-semibold text-foreground tabular">{s.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Availability trend */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-4 text-primary" /> Availability trend
          </h3>
          <BarSeries series={data.availabilityTrend} unit="%" />
        </Card>

        {/* Frequently requested */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Flame className="size-4 text-primary" /> Frequently requested
          </h3>
          <div className="flex flex-col gap-3">
            {data.frequentlyRequested.map((m) => (
              <div key={m.name} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-foreground tabular">{m.requests}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(m.requests / maxReq) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Update activity */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Activity className="size-4 text-primary" /> Update activity
          </h3>
          <BarSeries series={data.updateActivity} />
        </Card>
      </div>
    </div>
  )
}
