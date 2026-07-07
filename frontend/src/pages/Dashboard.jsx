import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  Clock,
  Gavel,
  Globe2,
  Layers,
  Layers3,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { KpiCard } from '@/components/shared/kpi-card'
import { KpiCardSkeleton } from '@/components/shared/skeletons'
import { ChartCard } from '@/components/shared/chart-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrendChart } from '@/components/charts/trend-chart'
import { BarCompare, GroupedBars } from '@/components/charts/bar-chart'
import { Donut } from '@/components/charts/donut'
import { Heatmap } from '@/components/charts/heatmap'
import { AvailabilityMap } from '@/features/dashboard/availability-map'
import { useMockQuery } from '@/services/queries'
import {
  apiUsage,
  availabilityTrend,
  confidenceDistribution,
  HEATMAP_COLS,
  jurisdictionComparison,
  kpis,
  partnerParticipation,
  riskHeatmap,
  shortagePressure,
  signalFreshness,
  topCategories,
} from '@/services/data'

const KPI_ICONS = {
  confidence: ShieldCheck,
  coverage: Layers,
  regions: Globe2,
  freshness: Timer,
  jurisdiction: Gavel,
  partners: Users,
  api: Activity,
  governance: ShieldCheck,
}

const DONUT_COLORS = {
  high: 'var(--chart-1)',
  moderate: 'var(--chart-2)',
  low: 'var(--chart-3)',
  unknown: 'var(--chart-axis)',
}

export default function Dashboard() {
  const { data: metrics, isLoading } = useMockQuery(['dashboard', 'kpis'], kpis)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        variant="hero"
        eyebrow="Medicine Availability Intelligence"
        title="Governed intelligence for medicine access at scale"
        subtitle="Governed enterprise intelligence across medicine availability, shortage pressure, and access risk — aggregate-only, jurisdiction-aware, and audit-ready."
        meta={
          <>
            <Badge variant="secondary" size="sm">
              <Clock className="size-3.5" />
              Updated 2m ago
            </Badge>
            <Badge variant="secondary" size="sm">
              <Globe2 className="size-3.5" />
              148 regions live
            </Badge>
            <Badge variant="success" size="sm">
              <ShieldCheck className="size-3.5" />
              Governed · aggregate-only
            </Badge>
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <Link to="/enterprise">
                <Sparkles />
                Request Enterprise Briefing
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/enterprise">
                <Layers3 />
                Explore Intelligence Stack
              </Link>
            </Button>
          </>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !metrics
          ? Array.from({ length: 8 }).map((_, i) => <KpiCardSkeleton key={i} />)
          : metrics.map((metric, i) => (
              <KpiCard
                key={metric.id}
                metric={metric}
                icon={KPI_ICONS[metric.id] ?? Activity}
                index={i}
              />
            ))}
      </div>

      {/* Visualizations */}
      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Operational intelligence"
          description="Live availability, access-risk, and network telemetry across the governed data plane."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/zoikosignal">
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
            <AvailabilityMap />
          </ChartCard>

          <ChartCard
            title="Confidence Distribution"
            description="Share of surfaces by availability-confidence band."
            index={1}
          >
            <Donut
              data={confidenceDistribution.map((d) => ({
                label: d.label,
                value: d.value,
                color: DONUT_COLORS[d.level],
              }))}
              centerValue="64%"
              centerLabel="High confidence"
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="Medicine Availability Trend"
            description="Confidence and coverage index, trailing 12 months."
            index={2}
          >
            <TrendChart
              data={availabilityTrend}
              xKey="date"
              unit="%"
              yDomain={[60, 100]}
              series={[
                { key: 'confidence', label: 'Availability confidence' },
                { key: 'coverage', label: 'Coverage index' },
              ]}
            />
          </ChartCard>

          <ChartCard
            title="Signal Freshness Timeline"
            description="Share of feeds within the 6-hour freshness SLA."
            index={3}
          >
            <TrendChart
              data={signalFreshness}
              xKey="date"
              unit="%"
              yDomain={[70, 100]}
              series={[
                { key: 'withinSla', label: 'Within SLA', color: 'var(--chart-2)' },
              ]}
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="Regional Access Risk Heatmap"
            description="Weighted access-risk intensity by region across recent periods."
            index={4}
          >
            <Heatmap rows={riskHeatmap} cols={HEATMAP_COLS} />
          </ChartCard>

          <ChartCard
            title="Top Medicine Categories"
            description="Coverage by therapeutic category."
            index={5}
          >
            <BarCompare
              data={topCategories}
              categoryKey="category"
              valueKey="coverage"
              unit="%"
            />
          </ChartCard>

          <ChartCard
            title="Shortage Pressure Timeline"
            description="Aggregate shortage-pressure index vs baseline."
            index={6}
          >
            <TrendChart
              data={shortagePressure}
              xKey="date"
              height={230}
              series={[
                { key: 'pressure', label: 'Pressure index', color: 'var(--chart-3)' },
                { key: 'baseline', label: 'Baseline', color: 'var(--chart-1)' },
              ]}
            />
          </ChartCard>

          <ChartCard
            title="Jurisdiction Comparison"
            description="Coverage vs preparedness by jurisdiction."
            index={7}
          >
            <GroupedBars
              data={jurisdictionComparison}
              xKey="jurisdiction"
              unit="%"
              yDomain={[0, 100]}
              height={230}
              series={[
                { key: 'coverage', label: 'Coverage' },
                { key: 'preparedness', label: 'Preparedness' },
              ]}
            />
          </ChartCard>

          <ChartCard
            title="API Usage"
            description="Governed vs sandbox request volume (thousands)."
            index={8}
          >
            <TrendChart
              data={apiUsage}
              xKey="date"
              unit="K"
              height={230}
              series={[
                { key: 'production', label: 'Production' },
                { key: 'sandbox', label: 'Sandbox' },
              ]}
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-3"
            title="Partner Participation"
            description="Contributing partner organizations by type, trailing 12 months."
            index={9}
          >
            <TrendChart
              data={partnerParticipation}
              xKey="date"
              type="line"
              height={240}
              series={[
                { key: 'health', label: 'Health systems' },
                { key: 'government', label: 'Government' },
                { key: 'enterprise', label: 'Enterprise' },
              ]}
            />
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
