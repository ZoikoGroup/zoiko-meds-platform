import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { Card } from '@/components/ui/card'
import { getParticipation } from '@/services/pharmacy-api'
import { ShieldCheck, Gauge, Repeat, BadgeCheck, Loader2 } from 'lucide-react'

// score → severity band for the meter colour
const band = (v) => (v >= 85 ? 'good' : v >= 60 ? 'warning' : 'critical')
const BAR = { good: 'bg-success', warning: 'bg-warning', critical: 'bg-danger' }

function Meter({ label, value }) {
  const b = band(value)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-sm font-bold tabular text-foreground">{value}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${BAR[b]}`} style={{ width: `${value}%` }} />
      </div>
    </Card>
  )
}

export default function PharmacyParticipation() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let alive = true
    getParticipation().then((d) => alive && setData(d)).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading participation…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Participation"
        subtitle="How your pharmacy contributes to the ZoikoAvail™ network. Fresher, more frequent updates raise your reliability."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Reliability score" value={`${data.reliabilityScore}%`} icon={ShieldCheck} severity="good" />
        <StatTile label="Participation score" value={`${data.participationScore}%`} icon={Gauge} severity="good" />
        <StatTile label="Updates / week" value={data.updateFrequencyPerWeek} icon={Repeat} />
        <StatTile label="Signal freshness" value={data.freshnessHours} unit="h avg" icon={BadgeCheck} severity="good" />
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Data quality metrics</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Meter label="Reliability" value={data.reliabilityScore} />
          <Meter label="Data quality" value={data.dataQuality} />
          <Meter label="Coverage" value={data.coverage} />
        </div>
      </section>

      <Card className="flex items-start gap-3 border-primary/20 bg-primary/5 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-foreground">
          Your reliability score weights how recent and consistent your availability signals are.
          Keeping inventory current — especially for high-demand medicines — directly raises the
          confidence patients see.
        </p>
      </Card>
    </div>
  )
}
