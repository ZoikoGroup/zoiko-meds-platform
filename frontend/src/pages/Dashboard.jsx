import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getOverview } from '@/services/admin-api'
import {
  Activity,
  ArrowUpRight,
  Clock,
  Globe2,
  Layers3,
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
import { Heatmap } from '@/components/charts/heatmap'
import { AvailabilityMap } from '@/features/dashboard/availability-map'
import { GroupedBars } from '@/components/charts/bar-chart'
import {
  apiUsage,
  availabilityTrend,
  confidenceDistribution,
  HEATMAP_COLS,
  jurisdictionComparison,
  partnerParticipation,
  riskHeatmap,
  shortagePressure,
  signalFreshness,
  topCategories,
} from '@/services/data'

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

const superAdminKpis = [
  { id: 'total-pharmacies', label: 'Total Pharmacies', value: '1,284', delta: '+37', deltaLabel: 'vs last month', trend: 'up', upIsGood: true, status: { label: 'Active', severity: 'good' }, spark: [55, 60, 64, 72, 79, 84, 88, 92, 98, 102, 108, 114] },
  { id: 'verified-pharmacies', label: 'Verified Pharmacies', value: '1,212', delta: '+42', deltaLabel: 'certified', trend: 'up', upIsGood: true, status: { label: 'Compliant', severity: 'good' }, spark: [50, 54, 58, 66, 72, 76, 80, 84, 90, 94, 98, 102] },
  { id: 'pending-verifications', label: 'Pending Verifications', value: '72', delta: '−5', deltaLabel: 'review queue', trend: 'down', upIsGood: true, status: { label: 'Pending Action', severity: 'warning' }, spark: [15, 14, 13, 11, 10, 8, 9, 7, 8, 6, 5, 4] },
  { id: 'active-users', label: 'Active Users', value: '3,482', delta: '+182', deltaLabel: 'weekly active', trend: 'up', upIsGood: true, status: { label: 'High traffic', severity: 'good' }, spark: [20, 22, 24, 25, 27, 28, 30, 31, 32, 33, 34, 35] },
  { id: 'total-medicines', label: 'Total Medicines', value: '312.4K', delta: '+8.2K', deltaLabel: 'normalized', trend: 'up', upIsGood: true, status: { label: 'Expanding', severity: 'good' }, spark: [70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92] },
  { id: 'searches-today', label: 'Searches Today', value: '42.8K', delta: '+4.2%', deltaLabel: 'ZoikoSignal volume', trend: 'up', upIsGood: true, status: { label: 'Nominal', severity: 'good' }, spark: [30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52] },
  { id: 'confirmation-rate', label: 'Confirmation Rate', value: '98.6%', delta: '+1.4 pts', deltaLabel: 'median accuracy', trend: 'up', upIsGood: true, status: { label: 'SLA Standard', severity: 'good' }, spark: [92, 93, 94, 94, 95, 95, 96, 96, 97, 97, 98, 98] },
  { id: 'api-requests', label: 'API Requests Today', value: '244K', delta: '+18K', deltaLabel: 'governed endpoints', trend: 'up', upIsGood: true, status: { label: 'Operational', severity: 'good' }, spark: [12, 14, 15, 17, 19, 21, 22, 24, 25, 27, 28, 30] },
  { id: 'system-health', label: 'System Health', value: '99.99%', delta: '0.00 pts', deltaLabel: '30-day average uptime', trend: 'flat', upIsGood: true, status: { label: 'Healthy', severity: 'good' }, spark: [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99] },
  { id: 'active-integrations', label: 'Active Integrations', value: '48', delta: '+3', deltaLabel: 'ERP connections', trend: 'up', upIsGood: true, status: { label: 'Online', severity: 'good' }, spark: [8, 9, 10, 11, 12, 12, 13, 14, 14, 15, 16, 17] }
]

function formatNum(n) {
  return typeof n === 'number' ? n.toLocaleString() : n
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    getOverview()
      .then(setOverview)
      .catch(() => setOverview(null))
  }, [])

  // Overlay live counts from /admin/overview onto the KPI cards where we have
  // a real backend value; the rest keep their illustrative figures.
  const kpis = useMemo(() => {
    if (!overview) return superAdminKpis
    const live = {
      'total-pharmacies': overview.pharmacies?.total,
      'verified-pharmacies': overview.pharmacies?.verified,
      'pending-verifications': overview.verifications?.pending,
      'active-users': overview.users?.active,
      'total-medicines': overview.medicines?.total,
    }
    return superAdminKpis.map((k) =>
      live[k.id] != null ? { ...k, value: formatNum(live[k.id]) } : k
    )
  }, [overview])

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
              Updated 2m ago
            </Badge>
            <Badge variant="secondary" size="sm">
              <Globe2 className="size-3.5" />
              148 regions live
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

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((metric, i) => (
          <KpiCard
            key={metric.id}
            metric={metric}
            icon={SUPER_KPI_ICONS[metric.id] ?? Activity}
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
