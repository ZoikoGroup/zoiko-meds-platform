import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Globe2,
  Loader2,
  ShieldCheck,
  Users,
  Building2,
  AlertCircle,
  Network,
  Search,
  CheckCircle2,
  Webhook,
  Blocks,
  Settings,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { KpiCard } from '@/components/shared/kpi-card'
import { ChartCard } from '@/components/shared/chart-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrendChart } from '@/components/charts/trend-chart'
import { BarCompare } from '@/components/charts/bar-chart'
import { Donut } from '@/components/charts/donut'
import { AvailabilityMap } from '@/features/dashboard/availability-map'
import {
  categorySeries,
  confidenceSeries,
  getDashboardOverview,
  kpiCards,
  relativeAge,
  shortageSeries,
} from '@/services/dashboard-api'

const SUPER_KPI_ICONS = {
  'total-pharmacies': Building2,
  'verified-pharmacies': ShieldCheck,
  'pending-verifications': AlertCircle,
  'active-users': Users,
  'total-medicines': Network,
  'searches-today': Search,
  'confirmation-rate': CheckCircle2,
  'api-requests': Webhook,
  'system-health': Activity,
  'active-integrations': Blocks
}

const DONUT_COLORS = {
  high: 'var(--chart-1)',
  moderate: 'var(--chart-2)',
  low: 'var(--chart-3)',
  unknown: 'var(--chart-axis)',
}

/** Holds a panel's slot while its data loads. */
function Loading({ label = 'Loading…', height = 200 }) {
  return (
    <div
      className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
      style={{ minHeight: height }}
    >
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

/**
 * A panel the platform has no source for.
 *
 * The chart's container, title and dimensions stay exactly as they were; only
 * the series is replaced by the backend's stated reason. Showing the reason on
 * the dashboard — rather than an empty axis — is what stops the gap being read
 * as "zero".
 */
function Unavailable({ gap, height = 200 }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 px-6 text-center"
      style={{ minHeight: height }}
    >
      <span className="text-sm font-medium text-muted-foreground">Not available</span>
      {gap?.reason && (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/80">{gap.reason}</p>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOverview(await getDashboardOverview())
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data')
      // Left null on purpose: no seeded fallback. Every panel then renders its
      // own empty state rather than numbers nobody measured.
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const kpis = kpiCards(overview)
  const confidence = confidenceSeries(overview)
  const categories = categorySeries(overview)
  const shortage = shortageSeries(overview)
  const gaps = overview?.unavailable ?? {}
  const freshness = overview?.freshness
  const highConfidence = confidence.find((c) => c.level === 'high')?.value ?? 0

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        variant="hero"
        eyebrow="Medicine Availability Intelligence"
        title="Super Admin Portal Control Panel"
        subtitle="Govern license verifications, manage medicine mappings, monitor real-time shortages, and oversee active integrations."
        meta={
          <>
            <Badge variant="secondary" size="sm">
              <Clock className="size-3.5" />
              {overview ? `Updated ${relativeAge(overview.generatedAt)}` : 'Updating…'}
            </Badge>
            <Badge variant="secondary" size="sm">
              <Globe2 className="size-3.5" />
              {/* Jurisdiction records. Zero is the real count today. */}
              {overview ? `${overview.regionsLive} regions live` : 'Regions —'}
            </Badge>
            <Badge variant="success" size="sm">
              <ShieldCheck className="size-3.5" />
              Super Admin Level Access
            </Badge>
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <Link to="/admin/verification">
                <ShieldCheck />
                Review Verification Queue
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/admin/settings">
                <Settings />
                Configure Settings
              </Link>
            </Button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* KPI grid */}
      {/*
        Column count follows the grid's own width, not the viewport. The 20rem
        Live Telemetry panel takes its space out of this row without changing
        the breakpoint, so a viewport-keyed `lg:grid-cols-5` sat at five columns
        of ~112px with the panel open — narrower than the "Pending Action" badge
        the Pending Verifications card shows whenever the queue is non-empty.
        A container query measures what is actually available.
      */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @min-[25rem]:grid-cols-2 @min-[38rem]:grid-cols-3 @min-[64rem]:grid-cols-5">
          {loading
            ? Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="h-[168px] animate-pulse rounded-2xl border border-border bg-muted/30"
                />
              ))
            : kpis.map((metric, i) => (
                <KpiCard
                  key={metric.id}
                  metric={metric}
                  icon={SUPER_KPI_ICONS[metric.id] ?? Activity}
                  index={i}
                />
              ))}
        </div>
      </div>

      {/* Visualizations */}
      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Operational intelligence"
          description="Live availability, access-risk, and network telemetry across the governed data plane."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/zoikosignal">
                Open ZoikoSignal™
                <ArrowUpRight />
              </Link>
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <ChartCard
            className="lg:col-span-2"
            title="Interactive Availability Map"
            description="Coverage and access-risk by macro-region."
            index={0}
          >
            {loading ? (
              <Loading height={280} />
            ) : overview?.regions?.length ? (
              <AvailabilityMap regions={overview.regions} />
            ) : (
              <Unavailable gap={gaps.availabilityMap} height={280} />
            )}
          </ChartCard>

          <ChartCard
            title="Confidence Distribution"
            description="Share of surfaces by availability-confidence band."
            index={1}
          >
            {loading ? (
              <Loading height={180} />
            ) : confidence.length > 0 ? (
              <Donut
                data={confidence.map((d) => ({
                  label: d.label,
                  value: d.value,
                  color: DONUT_COLORS[d.level],
                }))}
                centerValue={`${highConfidence}%`}
                centerLabel="High confidence"
              />
            ) : (
              <Unavailable
                gap={{ reason: 'No availability signals have been recorded yet.' }}
                height={180}
              />
            )}
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="Medicine Availability Trend"
            description="Confidence and coverage index, trailing 12 months."
            index={2}
          >
            {loading ? <Loading height={240} /> : <Unavailable gap={gaps.availabilityTrend} height={240} />}
          </ChartCard>

          <ChartCard
            title="Signal Freshness Timeline"
            description="Share of feeds within the 6-hour freshness SLA."
            index={3}
          >
            {loading ? (
              <Loading height={240} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2" style={{ minHeight: 240 }}>
                {/* No history exists for a timeline, but the current share is
                    measurable — so report that rather than nothing at all. */}
                <span className="text-3xl font-semibold tracking-tight tabular">
                  {freshness ? `${freshness.pct}%` : '—'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {freshness
                    ? `${freshness.withinSla} of ${freshness.total} signals within ${freshness.slaHours}h, right now`
                    : 'No signals recorded'}
                </span>
                <p className="max-w-xs text-center text-[11px] leading-relaxed text-muted-foreground/80">
                  {gaps.signalFreshnessTimeline?.reason}
                </p>
              </div>
            )}
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="Regional Access Risk Heatmap"
            description="Weighted access-risk intensity by region across recent periods."
            index={4}
          >
            {loading ? <Loading height={280} /> : <Unavailable gap={gaps.regionalRisk} height={280} />}
          </ChartCard>

          <ChartCard
            title="Top Medicine Categories"
            description="Coverage by therapeutic category."
            index={5}
          >
            {loading ? (
              <Loading height={240} />
            ) : categories.length > 0 ? (
              <div className="flex flex-col gap-3">
                <BarCompare
                  data={categories}
                  categoryKey="category"
                  valueKey="coverage"
                  unit="%"
                />
                {/* How much of the catalog these shares actually describe. */}
                <p className="text-[11px] text-muted-foreground">
                  Share of the {overview.categories.classified} of {overview.categories.total}{' '}
                  medicines carrying an ATC code.
                </p>
              </div>
            ) : (
              <Unavailable
                gap={{ reason: 'No medicine carries an ATC code, so none can be classified.' }}
                height={240}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Shortage Pressure Timeline"
            description="Aggregate shortage-pressure index vs baseline."
            index={6}
          >
            {loading ? (
              <Loading height={230} />
            ) : shortage.length > 0 ? (
              <TrendChart
                data={shortage}
                xKey="date"
                unit="%"
                height={230}
                series={[
                  { key: 'unmet', label: 'Unmet demand', color: 'var(--chart-3)' },
                ]}
              />
            ) : (
              <Unavailable
                gap={{ reason: 'No search signal events have been recorded yet.' }}
                height={230}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Jurisdiction Comparison"
            description="Coverage vs preparedness by jurisdiction."
            index={7}
          >
            {loading ? (
              <Loading height={230} />
            ) : (
              <Unavailable gap={gaps.jurisdictionComparison} height={230} />
            )}
          </ChartCard>

          <ChartCard
            title="API Usage"
            description="Governed vs sandbox request volume (thousands)."
            index={8}
          >
            {loading ? <Loading height={230} /> : <Unavailable gap={gaps.apiUsage} height={230} />}
          </ChartCard>

          <ChartCard
            className="lg:col-span-3"
            title="Partner Participation"
            description="Contributing partner organizations by type, trailing 12 months."
            index={9}
          >
            {loading ? (
              <Loading height={240} />
            ) : (
              <Unavailable gap={gaps.partnerParticipation} height={240} />
            )}
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
