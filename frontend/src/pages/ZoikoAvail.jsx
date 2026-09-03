import { useState, useEffect } from 'react'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Gauge,
  Loader2,
  Timer,
  Waves,
  Webhook,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { PageHeader } from '@/components/shared/page-header'
import { SectionHeading } from '@/components/shared/section-heading'
import { StatTile } from '@/components/shared/stat-tile'
import { ChartCard } from '@/components/shared/chart-card'
import { ServiceStatusBadge } from '@/components/shared/status'
import { ErrorState } from '@/components/shared/states'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendChart } from '@/components/charts/trend-chart'
import { cn } from '@/lib/utils'
import { formatMs, formatNumber } from '@/utils/format'
import { apiBaseUrl } from '@/lib/api-client'
import { getZoikoAvailTelemetry } from '@/services/admin-api'
import { authSteps } from '@/services/api-data'

const METHOD_STYLE = {
  GET: 'bg-info/12 text-info',
  POST: 'bg-warning/15 text-warning',
}

function MethodTag({ method }) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        METHOD_STYLE[method]
      )}
    >
      {method}
    </span>
  )
}

const STATUS_SEVERITY = {
  operational: 'good',
  degraded: 'warning',
  down: 'critical',
  disabled: 'neutral',
}

export default function ZoikoAvail() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    getZoikoAvailTelemetry()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Couldn't load ZoikoAvail telemetry"
        description="The gateway telemetry service could not be reached. Please try again."
        onRetry={load}
      />
    )
  }

  const severity = STATUS_SEVERITY[data.health.status] ?? 'neutral'
  const HEALTH = [
    {
      label: 'Uptime (30d)',
      value: data.health.uptime != null ? `${data.health.uptime}%` : '—',
      icon: Activity,
    },
    { label: 'p50 latency', value: String(data.health.p50 ?? '—'), unit: 'ms', icon: Gauge },
    { label: 'p99 latency', value: String(data.health.p99 ?? '—'), unit: 'ms', icon: Timer },
    {
      label: 'Requests (24h)',
      value: formatNumber(data.health.requests24h, { compact: true }),
      icon: Webhook,
    },
    {
      label: 'Error rate',
      value: data.health.errorRate != null ? `${data.health.errorRate}%` : '—',
      icon: AlertTriangle,
    },
    { label: 'Rate ceiling', value: data.health.rateCeiling, icon: Waves },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="ZoikoAvail™"
        subtitle="A governed, aggregate-only API for availability confidence and access-risk intelligence."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'ZoikoAvail™' },
        ]}
        meta={<ServiceStatusBadge status={data.health.status} size="sm" />}
        actions={
          <Button
            variant="outline"
            onClick={() => window.open(`${apiBaseUrl()}/docs`, '_blank', 'noopener')}
          >
            <BookOpen />
            Documentation
          </Button>
        }
      />

      {/* Health strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {HEALTH.map((h) => (
          <StatTile
            key={h.label}
            label={h.label}
            value={h.value}
            unit={h.unit}
            icon={h.icon}
            severity={severity}
          />
        ))}
      </div>

      {/* Latency + throughput */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ChartCard
          title="Response Time"
          description="p50 and p99 latency across the last 24 hours (ms)."
          index={0}
        >
          {data.responseTime.length > 0 ? (
            <TrendChart
              data={data.responseTime}
              xKey="date"
              type="line"
              valueFormatter={formatMs}
              series={[
                { key: 'p50', label: 'p50' },
                { key: 'p99', label: 'p99', color: 'var(--chart-3)' },
              ]}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No requests recorded in the last 24 hours.
            </p>
          )}
        </ChartCard>
        <ChartCard
          title="Request Throughput"
          description="Governed API requests per hour, last 24 hours."
          index={1}
        >
          {data.throughput.length > 0 ? (
            <TrendChart
              data={data.throughput}
              xKey="date"
              series={[{ key: 'requests', label: 'Requests' }]}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No requests recorded in the last 24 hours.
            </p>
          )}
        </ChartCard>
      </div>

      {/* Endpoints */}
      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Endpoints"
          description="Governed REST endpoints with live status and latency."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.endpoints.map((e, i) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{
                duration: 0.35,
                delay: (i % 3) * 0.05,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <Card className="h-full gap-3 p-4 transition-shadow hover:shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MethodTag method={e.method} />
                    <code className="truncate font-mono text-[13px] font-medium">
                      {e.path}
                    </code>
                  </div>
                  <ServiceStatusBadge status={e.status} size="sm" />
                </div>
                <p className="text-xs text-muted-foreground">{e.description}</p>
                <div className="mt-auto flex items-center gap-4 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  <span>
                    p50{' '}
                    <span className="font-medium text-foreground tabular">
                      {e.p50 != null ? `${e.p50}ms` : '—'}
                    </span>
                  </span>
                  <span>
                    p99{' '}
                    <span className="font-medium text-foreground tabular">
                      {e.p99 != null ? `${e.p99}ms` : '—'}
                    </span>
                  </span>
                  <Badge variant="outline" size="sm" className="ml-auto">
                    {e.category}
                  </Badge>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Security posture + auth flow */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ChartCard title="Security Status" description="Gateway posture and controls, as they actually stand." index={0}>
          <ul className="flex flex-col gap-3">
            {data.security.map((s) => (
              <li key={s.label} className="flex items-start gap-3">
                {s.status === 'ok' ? (
                  <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-warning" />
                )}
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard
          title="Authentication Flow"
          description="OAuth 2.0 client credentials + mTLS (target design — see Security Status for what's enforced today)."
          index={1}
        >
          <ol className="relative flex flex-col gap-5 pl-2">
            {authSteps.map((step, i) => (
              <li key={step.step} className="relative flex gap-3">
                {i < authSteps.length - 1 && (
                  <span className="absolute left-[13px] top-7 h-full w-px bg-border" />
                )}
                <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {step.step}
                </span>
                <div className="pt-0.5">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </ChartCard>
      </div>
    </div>
  )
}
