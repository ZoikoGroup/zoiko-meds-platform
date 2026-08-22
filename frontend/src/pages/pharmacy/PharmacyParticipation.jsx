import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/shared/states'
import { getParticipation } from '@/services/pharmacy-api'
import { ShieldCheck, Gauge, Repeat, BadgeCheck, Loader2 } from 'lucide-react'

// score → severity band for the meter colour
const band = (v) => (v >= 85 ? 'good' : v >= 60 ? 'warning' : 'critical')
const BAR = { good: 'bg-success', warning: 'bg-warning', critical: 'bg-danger' }

function Meter({ label, value, caption }) {
  // A share of nothing is not zero, and a full-width red bar reading 0% would be a
  // judgement on a pharmacy that has simply not listed anything yet.
  const unmeasured = value === null || value === undefined
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-sm font-bold tabular text-foreground">
          {unmeasured ? '—' : `${value}%`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {!unmeasured && (
          <div className={`h-full rounded-full ${BAR[band(value)]}`} style={{ width: `${value}%` }} />
        )}
      </div>
      {caption && <span className="text-[11px] leading-relaxed text-muted-foreground">{caption}</span>}
    </Card>
  )
}

export default function PharmacyParticipation() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getParticipation()
      .then((d) => alive && setData(d))
      // Reported rather than swallowed: an empty catch left the page spinning
      // forever with no way to tell a slow request from a failed one.
      .catch((err) => alive && setError(err.message || 'Could not load your participation metrics.'))
    return () => { alive = false }
  }, [])

  if (error) {
    return (
      <ErrorState
        title="Could not load participation"
        description={error}
        className="max-w-3xl"
      />
    )
  }

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
        <StatTile label="Medicines listed" value={data.medicinesListed} icon={Gauge} />
        <StatTile label="Updates (last 7 days)" value={data.updatesLast7Days} icon={Repeat} />
        <StatTile
          label="Signal freshness"
          value={data.freshnessHours ?? '—'}
          unit={data.freshnessHours === null ? '' : 'h avg'}
          icon={BadgeCheck}
        />
      </div>

      {data.medicinesListed === 0 ? (
        <Card className="flex items-start gap-3 p-5">
          <Gauge className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-foreground">
            You have no medicines listed yet, so there is nothing to measure. Add your
            inventory and these figures will describe your own contribution to the
            network — not a sample.
          </p>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Data quality metrics</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Meter label="Reliability" value={data.reliabilityScore} />
            <Meter
              label="Updated in last 7 days"
              value={data.upToDatePercent}
              caption={`${data.upToDateCount} of ${data.medicinesListed} medicines`}
            />
            <Meter
              label="Complete details"
              value={data.detailsCompletePercent}
              caption={`${data.detailsCompleteCount} of ${data.medicinesListed} have a generic name, strength and form`}
            />
          </div>
        </section>
      )}

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
