import { useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Calendar,
  Globe2,
  Layers,
  MapPin,
  PackageCheck,
  Pill,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { StatTile } from '@/components/shared/stat-tile'
import { ChartCard } from '@/components/shared/chart-card'
import { FilterBar } from '@/components/shared/filter-bar'
import { Combobox } from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TrendChart } from '@/components/charts/trend-chart'
import { BarCompare } from '@/components/charts/bar-chart'
import {
  categoryOptions,
  countryOptions,
  dateRangeOptions,
  demandMovement,
  medicineGroupOptions,
  regionOptions,
  restockSignals,
  shortageByCategory,
  signalOverview,
} from '@/services/signal-data'
import { regionRisk } from '@/services/data'
import { downloadJson } from '@/utils/export'

const OVERVIEW_ICONS = {
  shortage: AlertTriangle,
  demand: TrendingUp,
  risk: ShieldAlert,
  restock: PackageCheck,
}

const CONFIDENCE_VARIANT = { high: 'success', moderate: 'info', low: 'warning' }

export default function ZoikoSignal() {
  const [range, setRange] = useState('30d')
  const [group, setGroup] = useState('all')
  const [country, setCountry] = useState('all')
  const [region, setRegion] = useState('all')
  const [category, setCategory] = useState('all')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="ZoikoSignal™"
        subtitle="Aggregate shortage intelligence, demand movement, and regional access-risk signals — governed and privacy-preserving."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'ZoikoSignal™' },
        ]}
        actions={
          <Button variant="outline">
            <Bell />
            Configure alerts
          </Button>
        }
      />

      <FilterBar
        onExport={() =>
          downloadJson('zoikosignal-export', {
            filters: { range, group, country, region, category },
            overview: signalOverview,
            restockSignals,
          })
        }
      >
        <Combobox
          options={dateRangeOptions}
          value={range}
          onChange={setRange}
          icon={<Calendar className="size-4" />}
          aria-label="Date range"
        />
        <Combobox
          options={medicineGroupOptions}
          value={group}
          onChange={setGroup}
          icon={<Pill className="size-4" />}
          aria-label="Medicine group"
        />
        <Combobox
          options={countryOptions}
          value={country}
          onChange={setCountry}
          icon={<Globe2 className="size-4" />}
          aria-label="Country"
        />
        <Combobox
          options={regionOptions}
          value={region}
          onChange={setRegion}
          icon={<MapPin className="size-4" />}
          aria-label="Region"
        />
        <Combobox
          options={categoryOptions}
          value={category}
          onChange={setCategory}
          icon={<Layers className="size-4" />}
          aria-label="Category"
        />
      </FilterBar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {signalOverview.map((item) => (
          <StatTile
            key={item.id}
            label={item.label}
            value={item.value}
            unit={item.unit}
            delta={item.delta}
            trend={item.trend}
            upIsGood={item.upIsGood}
            severity={item.severity}
            icon={OVERVIEW_ICONS[item.id]}
          />
        ))}
      </div>

      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Signal intelligence"
          description="Demand movement, shortage pressure, and restock confidence across the network."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <ChartCard
            className="lg:col-span-2"
            title="Demand Movement"
            description="Aggregate demand vs supply signal, indexed to 100."
            index={0}
          >
            <TrendChart
              data={demandMovement}
              xKey="date"
              yDomain={[90, 130]}
              series={[
                { key: 'demand', label: 'Demand index' },
                { key: 'supply', label: 'Supply signal' },
              ]}
            />
          </ChartCard>

          <ChartCard
            title="Regional Access Risk"
            description="Weighted access-risk index by macro-region."
            index={1}
          >
            <BarCompare
              data={[...regionRisk].sort((a, b) => b.risk - a.risk)}
              categoryKey="region"
              valueKey="risk"
              color="var(--chart-6)"
            />
          </ChartCard>

          <ChartCard
            title="Shortage Pressure by Category"
            description="Therapeutic categories under the most pressure."
            index={2}
          >
            <BarCompare
              data={shortageByCategory}
              categoryKey="category"
              valueKey="pressure"
              color="var(--chart-3)"
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="Restock Signals"
            description="Confirmed restock confidence with expected windows."
            index={3}
          >
            <ul className="flex flex-col divide-y divide-border">
              {restockSignals.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.region}</span>
                      <Badge variant="outline" size="sm">
                        {s.category}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Expected window · {s.window}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:w-56">
                    <Progress value={s.strength} className="h-1.5 flex-1" />
                    <span className="w-9 text-right text-xs font-medium tabular">
                      {s.strength}
                    </span>
                    <Badge
                      variant={CONFIDENCE_VARIANT[s.confidence]}
                      size="sm"
                      className="w-20 justify-center"
                    >
                      {s.confidence}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
