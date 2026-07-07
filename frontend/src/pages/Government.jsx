import { Download, Lock, MapPin, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { StatTile } from '@/components/shared/stat-tile'
import { ChartCard } from '@/components/shared/chart-card'
import { GovernanceBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { TrendChart } from '@/components/charts/trend-chart'
import { BarCompare } from '@/components/charts/bar-chart'
import { Heatmap } from '@/components/charts/heatmap'
import { RadialScore } from '@/components/charts/radial-score'
import {
  governanceIndicatorsGov,
  preparednessByRegion,
  privacyStatus,
  publicHealthMetrics,
} from '@/services/sector-data'
import { HEATMAP_COLS, jurisdictions, riskHeatmap, shortagePressure } from '@/services/data'
import { downloadCsv } from '@/utils/export'

const METRIC_ICONS = { coverage: Users, risk: ShieldAlert, prep: ShieldCheck, zones: MapPin }

const columns = [
  {
    key: 'jurisdiction',
    header: 'Jurisdiction',
    sortable: true,
    accessor: (r) => r.jurisdiction,
    cell: (r) => <span className="font-medium">{r.jurisdiction}</span>,
  },
  { key: 'coverage', header: 'Coverage', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.coverage}%</span> },
  { key: 'preparedness', header: 'Preparedness', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.preparedness}</span> },
  { key: 'freshnessHours', header: 'Freshness', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.freshnessHours}h</span> },
  { key: 'partners', header: 'Partners', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.partners}</span> },
  { key: 'status', header: 'Governance', cell: (r) => <GovernanceBadge state={r.status} size="sm" /> },
]

export default function Government() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Solutions"
        title="Government & Public Health"
        subtitle="Jurisdiction-aware access-risk monitoring, shortage-pressure signals, and preparedness intelligence — privacy-preserving by design."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'Government & Public Health' },
        ]}
        actions={
          <Button variant="outline" onClick={() => downloadCsv('jurisdiction-overview', jurisdictions)}>
            <Download />
            Export overview
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {publicHealthMetrics.map((m) => (
          <StatTile
            key={m.id}
            label={m.label}
            value={m.value}
            delta={m.delta}
            trend={m.trend}
            upIsGood={m.id === 'coverage' || m.id === 'prep'}
            severity={m.severity}
            icon={METRIC_ICONS[m.id]}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard
          className="lg:col-span-2"
          title="Regional Access Risk"
          description="Weighted access-risk intensity by region across recent periods."
          index={0}
        >
          <Heatmap rows={riskHeatmap} cols={HEATMAP_COLS} />
        </ChartCard>

        <ChartCard title="Preparedness Index" description="National preparedness score." index={1}>
          <div className="flex flex-col items-center justify-center gap-3 py-2">
            <RadialScore value={84} caption="of 100" severity="good" />
            <p className="text-center text-xs text-muted-foreground">
              Composite of coverage, freshness, and partner participation across
              governed jurisdictions.
            </p>
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ChartCard title="Shortage Pressure" description="Aggregate shortage-pressure index vs baseline." index={0}>
          <TrendChart
            data={shortagePressure}
            xKey="date"
            series={[
              { key: 'pressure', label: 'Pressure index', color: 'var(--chart-3)' },
              { key: 'baseline', label: 'Baseline', color: 'var(--chart-1)' },
            ]}
          />
        </ChartCard>
        <ChartCard title="Preparedness by Region" description="Preparedness index per macro-region." index={1}>
          <BarCompare
            data={[...preparednessByRegion].sort((a, b) => b.index - a.index)}
            categoryKey="region"
            valueKey="index"
            color="var(--chart-2)"
          />
        </ChartCard>
      </div>

      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Jurisdiction Overview"
          description="Coverage, preparedness, and governance status by jurisdiction."
        />
        <Card>
          <CardContent className="py-5">
            <DataTable
              columns={columns}
              data={jurisdictions}
              getRowId={(r) => r.id}
              searchAccessor={(r) => r.jurisdiction}
              searchPlaceholder="Search jurisdictions…"
              pageSize={8}
            />
          </CardContent>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ChartCard title="Privacy Status" description="Privacy and data-residency posture." index={0}>
          <ul className="flex flex-col gap-3">
            {privacyStatus.map((p) => (
              <li key={p.label} className="flex items-start gap-3">
                <Lock className="mt-0.5 size-4.5 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Governance Indicators" description="Policy and transparency posture." index={1}>
          <div className="flex flex-col gap-5">
            {governanceIndicatorsGov.map((g) => (
              <div key={g.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{g.label}</span>
                  <span className="text-sm font-semibold tabular">{g.value}%</span>
                </div>
                <Progress value={g.value} className="h-1.5" indicatorClassName="bg-teal" />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
