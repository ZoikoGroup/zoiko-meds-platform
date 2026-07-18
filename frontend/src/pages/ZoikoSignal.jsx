import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle,
  Bell,
  Calendar,
  Layers,
  PackageCheck,
  Search,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { StatTile } from '@/components/shared/stat-tile'
import { ChartCard } from '@/components/shared/chart-card'
import { FilterBar } from '@/components/shared/filter-bar'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/shared/states'
import { Flash, useFlash } from '@/components/shared/flash'
import { TrendChart } from '@/components/charts/trend-chart'
import { BarCompare } from '@/components/charts/bar-chart'
import {
  getIntelligenceSummary,
  getIntelligenceCells,
  downloadIntelligenceExport,
} from '@/services/signal-intelligence-api'

// Functional filters (the backend supports a time window + bucket).
const dateRangeOptions = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'ytd', label: 'Year to date' },
]

const bucketOptions = [
  { value: 'DAY', label: 'Daily' },
  { value: 'WEEK', label: 'Weekly' },
]

// Resolve a range key → an ISO lower bound on periodStart.
function rangeToFrom(range) {
  const now = new Date()
  if (range === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range] ?? 30
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const compact = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? 0)

export default function ZoikoSignal() {
  const [range, setRange] = useState('90d')
  const [bucket, setBucket] = useState('DAY')
  const [summary, setSummary] = useState(null)
  const [cells, setCells] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [flashMsg, flash] = useFlash()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    const from = rangeToFrom(range)
    Promise.all([
      getIntelligenceSummary({ from, bucket }),
      getIntelligenceCells({ from, bucket, limit: 1000 }),
    ])
      .then(([s, c]) => {
        if (!alive) return
        setSummary(s)
        setCells(c?.items ?? [])
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [range, bucket])

  const handleExport = useCallback(
    async (format) => {
      setExporting(true)
      try {
        await downloadIntelligenceExport({ from: rangeToFrom(range), bucket }, format)
        flash(`Exported intelligence (${format.toUpperCase()})`)
      } catch {
        flash('Export failed — please try again')
      } finally {
        setExporting(false)
      }
    },
    [range, bucket, flash],
  )

  // Demand vs supply signal over time, aggregated across medicines per period.
  const demandMovement = useMemo(() => {
    const byPeriod = new Map()
    for (const c of cells) {
      const key = c.periodStart
      const acc = byPeriod.get(key) ?? { date: fmtDate(key), _ts: new Date(key).getTime(), demand: 0, supply: 0 }
      acc.demand += c.searchCount ?? 0
      acc.supply += (c.restockEvents ?? 0) + (c.confirmationCount ?? 0)
      byPeriod.set(key, acc)
    }
    return [...byPeriod.values()].sort((a, b) => a._ts - b._ts)
  }, [cells])

  const topDemand = useMemo(
    () =>
      (summary?.topDemand ?? [])
        .filter((d) => d.medicineName)
        .slice(0, 6)
        .map((d) => ({ medicine: d.medicineName, searches: d.searchCount })),
    [summary],
  )

  const shortagePressure = useMemo(
    () =>
      (summary?.topShortagePressure ?? [])
        .filter((s) => s.medicineName)
        .slice(0, 6)
        .map((s) => ({
          medicine: s.medicineName,
          pressure: Math.round((s.shortagePressure ?? 0) * 100),
        })),
    [summary],
  )

  const unmetDemand = summary?.topUnmetDemand ?? []
  const totals = summary?.totals ?? {
    searchCount: 0,
    zeroResultCount: 0,
    restockEvents: 0,
    confirmationCount: 0,
  }

  const overview = [
    {
      id: 'shortage',
      label: 'Shortage pressure zones',
      value: shortagePressure.length,
      unit: 'medicines under pressure',
      severity: shortagePressure.length > 0 ? 'warning' : 'good',
      icon: AlertTriangle,
    },
    {
      id: 'demand',
      label: 'Aggregate demand',
      value: compact(totals.searchCount),
      unit: 'searches in window',
      severity: 'good',
      icon: TrendingUp,
    },
    {
      id: 'unmet',
      label: 'Unmet demand',
      value: compact(totals.zeroResultCount),
      unit: 'zero-result searches',
      severity: totals.zeroResultCount > 0 ? 'serious' : 'good',
      icon: Search,
    },
    {
      id: 'restock',
      label: 'Restock signals',
      value: compact(totals.restockEvents),
      unit: 'confirmed in window',
      severity: 'good',
      icon: PackageCheck,
    },
  ]

  const hasData = !loading && !error && cells.length > 0

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="ZoikoSignal™"
        subtitle="Aggregate shortage intelligence, demand movement, and unmet-demand signals — governed, anonymized, and k-anonymity-safe."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'ZoikoSignal™' },
        ]}
        actions={
          summary?.kAnonymity != null ? (
            <Badge variant="outline" className="gap-1.5">
              <Bell className="size-3.5" />
              k-anonymity ≥ {summary.kAnonymity}
            </Badge>
          ) : null
        }
      />

      {flashMsg && <Flash message={flashMsg} />}

      <FilterBar onExport={() => handleExport('csv')}>
        <Combobox
          options={dateRangeOptions}
          value={range}
          onChange={setRange}
          icon={<Calendar className="size-4" />}
          aria-label="Date range"
        />
        <Combobox
          options={bucketOptions}
          value={bucket}
          onChange={setBucket}
          icon={<Layers className="size-4" />}
          aria-label="Time bucket"
        />
        {exporting && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </FilterBar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overview.map((item) => (
          <StatTile
            key={item.id}
            label={item.label}
            value={loading ? '—' : item.value}
            unit={item.unit}
            severity={item.severity}
            icon={item.icon}
          />
        ))}
      </div>

      {error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load intelligence"
          description="The ZoikoSignal intelligence service could not be reached. Please try again."
        />
      ) : loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={TrendingUp}
          title="No intelligence for this window"
          description="No aggregate signals were recorded in the selected time range. Try a wider window."
        />
      ) : (
        <section className="flex flex-col gap-5">
          <SectionHeading
            title="Signal intelligence"
            description="Demand movement, shortage pressure, and unmet demand across the network."
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
            <ChartCard
              className="lg:col-span-2"
              title="Demand Movement"
              description="Aggregate search demand vs confirmed supply signals over time."
              index={0}
            >
              {demandMovement.length > 0 ? (
                <TrendChart
                  data={demandMovement}
                  xKey="date"
                  series={[
                    { key: 'demand', label: 'Demand (searches)' },
                    { key: 'supply', label: 'Supply signals' },
                  ]}
                />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No time-series data for this window.
                </p>
              )}
            </ChartCard>

            <ChartCard
              title="Unmet Demand"
              description="Top zero-result search terms (k-anonymity applied)."
              index={1}
            >
              {unmetDemand.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border">
                  {unmetDemand.map((u) => (
                    <li key={u.term} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="truncate text-sm font-medium capitalize">{u.term}</span>
                      <Badge variant="warning" size="sm" className="tabular">
                        {u.count} searches
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No unmet-demand terms above the k-anonymity threshold.
                </p>
              )}
            </ChartCard>

            <ChartCard
              title="Top Demand"
              description="Most-searched governed medicines in the window."
              index={2}
            >
              {topDemand.length > 0 ? (
                <BarCompare
                  data={topDemand}
                  categoryKey="medicine"
                  valueKey="searches"
                  color="var(--chart-1)"
                />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">No demand data.</p>
              )}
            </ChartCard>

            <ChartCard
              className="lg:col-span-2"
              title="Shortage Pressure"
              description="Zero-result rate per medicine — higher means more unmet demand."
              index={3}
            >
              {shortagePressure.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {shortagePressure.map((s) => (
                    <div key={s.medicine} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm font-medium">{s.medicine}</span>
                      <Progress value={s.pressure} className="h-1.5 flex-1" />
                      <span className="w-10 text-right text-xs font-medium tabular">{s.pressure}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No medicines above the shortage-pressure threshold.
                </p>
              )}
            </ChartCard>
          </div>
        </section>
      )}
    </div>
  )
}
