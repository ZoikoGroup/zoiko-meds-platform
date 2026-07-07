import { ChevronRight, ClipboardCheck, Network } from 'lucide-react'
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
  governanceIndicators,
  identifierMapping,
  medicineIdentities,
  normalizationStatus,
  qualityLevels,
} from '@/services/medibase-data'
import { cn } from '@/lib/utils'

const NORM_COLOR = {
  good: 'var(--chart-4)',
  warning: 'var(--chart-3)',
  serious: 'var(--chart-6)',
}

const QUALITY_VARIANT = { A: 'success', B: 'warning', C: 'danger' }

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
  { key: 'brandCount', header: 'Brands', sortable: true, align: 'right', cell: (r) => <span className="tabular">{r.brandCount}</span> },
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

export default function MediBase() {
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
            <Badge variant="warning" size="sm" className="ml-1">
              18
            </Badge>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard
          className="lg:col-span-2"
          title="Medicine Identity Graph"
          description="Identifier resolution across brand, strength, form, market, and governance."
          index={0}
        >
          <MedicineIdentityGraph />
        </ChartCard>

        <ChartCard
          title="Normalization Status"
          description="Share of catalog by normalization state."
          index={1}
        >
          <Donut
            data={normalizationStatus.map((n) => ({
              label: n.label,
              value: n.value,
              color: NORM_COLOR[n.severity],
            }))}
            centerValue="87%"
            centerLabel="Normalized"
          />
        </ChartCard>
      </div>

      {/* Identifier mapping flow */}
      <Card>
        <CardHeader>
          <CardTitle>Identifier Mapping</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {identifierMapping.map((layer, i) => (
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
                {i < identifierMapping.length - 1 && (
                  <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground lg:block" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard title="Quality Levels" description="Governed data-quality tiers." index={0}>
          <div className="flex flex-col gap-4">
            {qualityLevels.map((q) => (
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
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="Governance Status"
          description="Catalog governance distribution across identity states."
          index={1}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {governanceIndicators.map((g) => (
              <div key={g.label} className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-2xl font-semibold tracking-tight tabular">{g.value}</p>
                <p className="mt-1 text-xs font-medium">{g.label}</p>
                <p className="text-[11px] text-muted-foreground">{g.hint}</p>
              </div>
            ))}
          </div>
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
              data={medicineIdentities}
              getRowId={(r) => r.id}
              searchAccessor={(r) => r.generic}
              searchPlaceholder="Search identities…"
              pageSize={8}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
