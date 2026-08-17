import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, ClipboardCheck, Loader2, Network } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { ChartCard } from '@/components/shared/chart-card'
import { GovernanceBadge } from '@/components/shared/status'
import { DataTable } from '@/components/shared/data-table'
import { Donut } from '@/components/charts/donut'
import { MedicineIdentityGraph } from '@/features/medibase/identity-graph'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  getCatalogOverview,
  governanceSeries,
  identifierSeries,
  identityGraphFor,
  listIdentities,
  normalizationSeries,
  qualitySeries,
} from '@/services/medibase-api'
import { cn } from '@/lib/utils'

const NORM_COLOR = {
  good: 'var(--chart-4)',
  warning: 'var(--chart-3)',
  serious: 'var(--chart-6)',
}

const QUALITY_VARIANT = { A: 'success', B: 'warning', C: 'danger' }

const PAGE_SIZE = 8
/** Long enough that typing a medicine name is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 300

const columns = [
  {
    key: 'generic',
    header: 'Generic identity',
    sortable: true,
    accessor: (r) => r.generic,
    cell: (r) => (
      <span className="flex items-center gap-2 font-medium">
        <Network className="size-4 text-muted-foreground" />
        {r.generic}
      </span>
    ),
  },
  { key: 'brands', header: 'Brands', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.brands}</span> },
  { key: 'strengths', header: 'Strengths', align: 'right', cell: (r) => <span className="tabular">{r.strengths}</span> },
  { key: 'dosageForms', header: 'Forms', align: 'right', cell: (r) => <span className="tabular">{r.dosageForms}</span> },
  { key: 'markets', header: 'Markets', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.markets}</span> },
  {
    key: 'normalization',
    header: 'Normalization',
    sortable: true,
    align: 'right',
    cell: (r) => (
      <span className="flex items-center justify-end gap-2">
        <Progress value={r.normalization} className="h-1.5 w-16" />
        <span className="w-9 text-right tabular">{r.normalization}%</span>
      </span>
    ),
  },
  {
    key: 'governance',
    header: 'Governance',
    cell: (r) => <GovernanceBadge state={r.governance} size="sm" />,
  },
  {
    key: 'quality',
    header: 'Quality',
    align: 'center',
    cell: (r) => (
      <Badge variant={QUALITY_VARIANT[r.quality]} size="sm" className="w-7 justify-center">
        {r.quality}
      </Badge>
    ),
  },
]

/** Placeholder that holds a panel's height while its data loads. */
function Loading({ label, className }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

/**
 * Settled state with nothing to show — a failed rollup or an empty catalog.
 * Deliberately not the Loading component: a spinner says "still working", and
 * a panel that has given up must not keep spinning.
 */
function Unavailable({ label, className }) {
  return (
    <div className={cn('flex items-center justify-center py-16 text-sm text-muted-foreground', className)}>
      {label}
    </div>
  )
}

export default function MediBase() {
  // Catalog-wide statistics: the graph, donut, mapping row, tiers and tiles.
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(true)

  // The identity table pages and searches independently of the statistics, so
  // typing in the search box does not re-request the whole catalog rollup.
  const [identities, setIdentities] = useState({ items: [], total: 0, page: 1, pageCount: 1 })
  const [tableLoading, setTableLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    try {
      setOverview(await getCatalogOverview())
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load MediBase catalog statistics')
      // Leave `overview` null. A stale or invented rollup on a governance
      // screen is indistinguishable from a live one.
      setOverview(null)
    } finally {
      setOverviewLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  // Debounce the search term so a keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let alive = true
    setTableLoading(true)
    listIdentities({ search: debouncedSearch, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!alive) return
        setIdentities(res)
        setError('')
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message || 'Failed to load medicine identities')
        setIdentities({ items: [], total: 0, page: 1, pageCount: 1 })
      })
      .finally(() => alive && setTableLoading(false))
    return () => {
      alive = false
    }
  }, [debouncedSearch, page])

  const graph = identityGraphFor(overview?.topIdentity)
  const normalization = normalizationSeries(overview)
  const identifiers = identifierSeries(overview)
  const tiers = qualitySeries(overview)
  const governance = governanceSeries(overview)
  // Read the centre figure off the series so it always equals the "Fully
  // normalized" line in the legend beside it.
  const normalizedPct = normalization[0]?.value ?? 0

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="MediBase™"
        subtitle="A normalized medicine identity graph — resolving brand, generic, strength, form, and market into governed identities."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'MediBase™' },
        ]}
        actions={
          <Button variant="outline">
            <ClipboardCheck />
            Review queue
            {/* Identities the catalog has not finished governing. */}
            <Badge variant="warning" size="sm" className="ml-1">
              {overview ? overview.governance.inReview : '—'}
            </Badge>
          </Button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard
          className="lg:col-span-2"
          title="Medicine Identity Graph"
          description="Identifier resolution across brand, strength, form, market, and governance."
          index={0}
        >
          {overviewLoading ? (
            <Loading label="Loading identity graph…" className="h-[340px] sm:h-[360px]" />
          ) : graph ? (
            <MedicineIdentityGraph graph={graph} />
          ) : (
            <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground sm:h-[360px]">
              No governed identities in the catalog yet.
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Normalization Status"
          description="Share of catalog by normalization state."
          index={1}
        >
          {overviewLoading ? (
            <Loading label="Loading…" />
          ) : overview ? (
            <Donut
              data={normalization.map((n) => ({
                label: n.label,
                value: n.value,
                color: NORM_COLOR[n.severity],
              }))}
              centerValue={`${normalizedPct}%`}
              centerLabel="Normalized"
            />
          ) : (
            <Unavailable label="Statistics unavailable." />
          )}
        </ChartCard>
      </div>

      {/* Identifier mapping flow */}
      <Card>
        <CardHeader>
          <CardTitle>Identifier Mapping</CardTitle>
        </CardHeader>
        <CardContent>
          {overviewLoading ? (
            <Loading label="Loading identifier mapping…" />
          ) : identifiers.length === 0 ? (
            <Unavailable label="Identifier mapping unavailable." />
          ) : (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
              {identifiers.map((layer, i) => (
                <div key={layer.layer} className="flex flex-1 items-center gap-3">
                  <div className="flex-1 rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {layer.layer}
                    </p>
                    <p className="mt-1 text-xl font-semibold tracking-tight tabular">
                      {layer.count}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {layer.description}
                    </p>
                  </div>
                  {i < identifiers.length - 1 && (
                    <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground lg:block" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard title="Quality Levels" description="Governed data-quality tiers." index={0}>
          {overviewLoading ? (
            <Loading label="Loading tiers…" />
          ) : tiers.length === 0 ? (
            <Unavailable label="Quality tiers unavailable." />
          ) : (
            <div className="flex flex-col gap-4">
              {tiers.map((q) => (
                <div key={q.level} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={QUALITY_VARIANT[q.level]} size="sm" className="w-7 justify-center">
                      {q.level}
                    </Badge>
                    <span className="text-sm font-medium">{q.label}</span>
                    <span className="ml-auto text-sm font-semibold tabular">{q.value}%</span>
                  </div>
                  <Progress
                    value={q.value}
                    className="h-1.5"
                    indicatorClassName={cn(
                      q.level === 'A' && 'bg-success',
                      q.level === 'B' && 'bg-warning',
                      q.level === 'C' && 'bg-danger'
                    )}
                  />
                  <p className="text-xs text-muted-foreground">{q.description}</p>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="Governance Status"
          description="Catalog governance distribution across identity states."
          index={1}
        >
          {overviewLoading ? (
            <Loading label="Loading governance status…" />
          ) : governance.length === 0 ? (
            <Unavailable label="Governance status unavailable." />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {governance.map((g) => (
                <div key={g.label} className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-2xl font-semibold tracking-tight tabular">{g.value}</p>
                  <p className="mt-1 text-xs font-medium">{g.label}</p>
                  <p className="text-[11px] text-muted-foreground">{g.hint}</p>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Medicine identities"
          description="Normalized identity records with mapping, governance, and quality tier."
        />
        <Card>
          <CardContent className="py-5">
            <DataTable
              columns={columns}
              data={identities.items}
              getRowId={(r) => r.id}
              searchPlaceholder="Search identities…"
              pageSize={PAGE_SIZE}
              emptyTitle={debouncedSearch ? 'No matching identities' : 'No medicine identities'}
              emptyDescription={
                debouncedSearch
                  ? 'No generic root or trade name matches that search.'
                  : 'The MediBase catalog has no medicine identities yet.'
              }
              // Search, paging and ordering all happen in PostgreSQL: the table
              // renders one page, never the catalog.
              server={{
                query: search,
                onQueryChange: setSearch,
                page: identities.page,
                pageCount: identities.pageCount,
                total: identities.total,
                onPageChange: setPage,
                loading: tableLoading,
              }}
            />
            {tableLoading && <Loading label="Loading medicine identities…" className="py-8" />}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
