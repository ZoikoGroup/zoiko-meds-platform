import {
  BellRing,
  Building2,
  CheckCircle2,
  Compass,
  Link2,
  Route,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { StatTile } from '@/components/shared/stat-tile'
import { ChartCard } from '@/components/shared/chart-card'
import { ServiceStatusBadge } from '@/components/shared/status'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TrendChart } from '@/components/charts/trend-chart'
import {
  careNavigation,
  careWorkflow,
  dischargeSupport,
  hospitalIntelligence,
  patientAccessTrends,
} from '@/services/sector-data'
import { integrations } from '@/services/ops-data'
import { cn } from '@/lib/utils'

const HOSPITAL_ICONS = [Building2, ShieldCheck, BellRing, Route]

const GUIDANCE = [
  'Confidence-banded availability context — never exact stock or dispensing.',
  'Governed alternative access routes when local pressure is elevated.',
  'Continuity monitoring across the full care episode.',
  'Aggregate, de-identified — no patient data leaves the boundary.',
]

export default function HealthSystems() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Solutions"
        title="Health Systems"
        subtitle="Availability intelligence embedded in care navigation, discharge planning, and continuity — governed and aggregate-only."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'Health Systems' },
        ]}
        actions={
          <Button variant="outline">
            <Link2 />
            Connect facility
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hospitalIntelligence.map((m, i) => (
          <StatTile
            key={m.label}
            label={m.label}
            value={m.value}
            delta={m.delta}
            trend={m.trend}
            icon={HOSPITAL_ICONS[i]}
          />
        ))}
      </div>

      {/* Care workflow stepper */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="size-4.5 text-primary" />
            Care Workflow Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {careWorkflow.map((step, i) => (
              <div key={step.id} className="relative">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                      step.status === 'attention'
                        ? 'bg-warning/15 text-warning'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{step.title}</span>
                </div>
                <p className="mt-2 pl-9 text-xs text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard
          className="lg:col-span-2"
          title="Patient Access Trends"
          description="Aggregate access-continuity and guidance-acceptance index (de-identified)."
          index={0}
        >
          <TrendChart
            data={patientAccessTrends}
            xKey="date"
            unit="%"
            yDomain={[60, 100]}
            series={[
              { key: 'access', label: 'Access continuity' },
              { key: 'guidance', label: 'Guidance acceptance' },
            ]}
          />
        </ChartCard>

        <ChartCard title="Discharge Support" description="Coverage of discharge workflows." index={1}>
          <div className="flex flex-col gap-5">
            {dischargeSupport.map((d) => (
              <div key={d.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{d.label}</span>
                  <span className="text-sm font-semibold tabular">{d.value}%</span>
                </div>
                <Progress value={d.value} className="h-1.5" />
                <span className="text-xs text-muted-foreground">{d.hint}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard title="Care Navigation" description="Guidance surfaced to navigation teams." index={0}>
          <ul className="flex flex-col gap-4">
            {careNavigation.map((c) => (
              <li key={c.title} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Compass className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Availability Guidance" description="Governed guidance principles." index={1}>
          <ul className="flex flex-col gap-3">
            {GUIDANCE.map((g) => (
              <li key={g} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-success" />
                <span className="text-muted-foreground">{g}</span>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Integration Status" description="Connected clinical and data systems." index={2}>
          <ul className="flex flex-col divide-y divide-border">
            {integrations.slice(0, 6).map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.name}</p>
                  <p className="text-xs text-muted-foreground">{it.category}</p>
                </div>
                <ServiceStatusBadge status={it.status} size="sm" />
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
    </div>
  )
}
