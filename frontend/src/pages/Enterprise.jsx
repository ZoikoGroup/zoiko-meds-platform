import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  Check,
  Circle,
  Network,
  PhoneCall,
  Radar,
  ShieldCheck,
  Sparkles,
  Webhook,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { ChartCard } from '@/components/shared/chart-card'
import { ArchitectureDiagram } from '@/features/enterprise/architecture-diagram'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  implementationTimeline,
  intelligenceStack,
  procurementReadiness,
  securityOverview,
  useCases,
} from '@/services/sector-data'

const STACK_ICON = { signal: Radar, avail: Webhook, medibase: Network }
const STACK_ROUTE = { signal: '/zoikosignal', avail: '/zoikoavail', medibase: '/medibase' }

const SEVERITY_DOT = {
  good: 'bg-success',
  warning: 'bg-warning',
  serious: 'bg-info',
  critical: 'bg-danger',
}

export default function Enterprise() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        variant="hero"
        eyebrow="Enterprise Solutions"
        title="The ZoikoMeds intelligence stack"
        subtitle="Three governed products — signal, availability, and identity — composed into one procurement-ready enterprise platform."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'Enterprise Solutions' },
        ]}
        actions={
          <>
            <Button size="lg">
              <Sparkles />
              Request Enterprise Briefing
            </Button>
            <Button size="lg" variant="outline">
              <PhoneCall />
              Contact sales
            </Button>
          </>
        }
      />

      {/* Intelligence stack */}
      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Enterprise Intelligence Stack"
          description="Composable, governed products with a shared identity and governance layer."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-5">
          {intelligenceStack.map((p) => {
            const Icon = STACK_ICON[p.id]
            return (
              <Card key={p.id} className="group p-6 transition-shadow hover:shadow-card">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal text-white shadow-sm">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.tagline}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{p.description}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {p.metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-lg font-semibold tracking-tight tabular">{m.value}</p>
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                    </div>
                  ))}
                </div>
                <Button asChild variant="ghost" size="sm" className="mt-4 w-fit px-2">
                  <Link to={STACK_ROUTE[p.id]}>
                    Explore {p.name}
                    <ArrowRight />
                  </Link>
                </Button>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Architecture */}
      <Card>
        <CardHeader>
          <CardTitle>Architecture</CardTitle>
        </CardHeader>
        <CardContent>
          <ArchitectureDiagram />
        </CardContent>
      </Card>

      {/* Use cases */}
      <section className="flex flex-col gap-5">
        <SectionHeading title="Use Cases" description="How enterprises operationalize the stack." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map((u) => (
            <Card key={u.id} className="gap-3 p-5">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight text-primary">
                  {u.metric}
                </span>
                <span className="text-xs text-muted-foreground">{u.metricLabel}</span>
              </div>
              <p className="text-sm font-medium">{u.title}</p>
              <p className="text-xs text-muted-foreground">{u.description}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Procurement + security */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ChartCard
          title="Procurement Readiness"
          description="Evaluation and onboarding artifacts."
          index={0}
        >
          <ul className="flex flex-col gap-2.5">
            {procurementReadiness.map((item) => (
              <li key={item.label} className="flex items-center gap-3 text-sm">
                {item.done ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Circle className="size-2.5" />
                  </span>
                )}
                <span className={cn(!item.done && 'text-muted-foreground')}>
                  {item.label}
                </span>
                {!item.done && (
                  <Badge variant="secondary" size="sm" className="ml-auto">
                    In progress
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Security Overview" description="Certifications and controls." index={1}>
          <ul className="flex flex-col gap-3">
            {securityOverview.map((s) => (
              <li key={s.label} className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      {/* Implementation timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Implementation Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="relative flex flex-col gap-6">
            {implementationTimeline.map((phase, i) => (
              <li key={phase.id} className="relative flex gap-4 pl-1">
                {i < implementationTimeline.length - 1 && (
                  <span className="absolute left-[9px] top-5 h-full w-px bg-border" />
                )}
                <span
                  className={cn(
                    'z-10 mt-1 size-3.5 shrink-0 rounded-full ring-4 ring-card',
                    SEVERITY_DOT[phase.severity]
                  )}
                />
                <div className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{phase.title}</p>
                    <p className="text-xs text-muted-foreground">{phase.detail}</p>
                  </div>
                  <Badge variant="secondary" size="sm" className="w-fit">
                    {phase.time}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
