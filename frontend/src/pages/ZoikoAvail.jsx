import { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Gauge,
  KeyRound,
  Terminal,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TrendChart } from '@/components/charts/trend-chart'
import { cn } from '@/lib/utils'
import { formatMs } from '@/utils/format'
import {
  apiHealth,
  authSteps,
  endpoints,
  exampleResponse,
  rateTiers,
  requestThroughput,
  responseTime,
  securityStatus,
} from '@/services/api-data'

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

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-[480px] overflow-auto p-4 text-xs leading-relaxed">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  )
}

const HEALTH = [
  { label: 'Uptime (30d)', value: apiHealth.uptime, icon: Activity, severity: 'good' },
  { label: 'p50 latency', value: apiHealth.p50, unit: 'ms', icon: Gauge, severity: 'good' },
  { label: 'p99 latency', value: apiHealth.p99, unit: 'ms', icon: Timer, severity: 'good' },
  { label: 'Requests (24h)', value: apiHealth.requests24h, icon: Webhook, severity: 'good' },
  { label: 'Error rate', value: apiHealth.errorRate, icon: AlertTriangle, severity: 'good' },
  { label: 'Rate ceiling', value: apiHealth.rateCeiling, icon: Waves, severity: 'good' },
]

export default function ZoikoAvail() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="ZoikoAvail™ API"
        subtitle="A governed, aggregate-only API for availability confidence and access-risk intelligence."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'ZoikoAvail™ API' },
        ]}
        meta={
          <Badge variant="success" size="sm">
            <CheckCircle2 className="size-3.5" />
            Sandbox {apiHealth.sandbox}
          </Badge>
        }
        actions={
          <>
            <Button variant="outline">
              <BookOpen />
              Documentation
            </Button>
            <Button>
              <Terminal />
              Open sandbox
            </Button>
          </>
        }
      />

      {/* Health strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {HEALTH.map((h) => (
          <StatTile
            key={h.label}
            label={h.label}
            value={String(h.value)}
            unit={h.unit}
            icon={h.icon}
            severity={h.severity}
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
          <TrendChart
            data={responseTime}
            xKey="date"
            type="line"
            valueFormatter={formatMs}
            series={[
              { key: 'p50', label: 'p50' },
              { key: 'p99', label: 'p99', color: 'var(--chart-3)' },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Request Throughput"
          description="Governed vs sandbox requests per hour (thousands)."
          index={1}
        >
          <TrendChart
            data={requestThroughput}
            xKey="date"
            unit="K"
            series={[
              { key: 'production', label: 'Production' },
              { key: 'sandbox', label: 'Sandbox' },
            ]}
          />
        </ChartCard>
      </div>

      {/* Endpoints */}
      <section className="flex flex-col gap-5">
        <SectionHeading
          title="Endpoints"
          description="Governed REST endpoints with live status and latency."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {endpoints.map((e, i) => (
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
                      {e.p50}ms
                    </span>
                  </span>
                  <span>
                    p99{' '}
                    <span className="font-medium text-foreground tabular">
                      {e.p99}ms
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

      {/* Request / response viewer */}
      <Card>
        <CardHeader>
          <CardTitle>Example request & response</CardTitle>
          <CardDescription>
            Aggregate-only payloads. No PHI, no exact stock — enforced at the gateway.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <CodeBlock
            label="cURL · request"
            code={`curl https://api.zoikomeds.io/v2/availability/confidence \\
  -H "Authorization: Bearer $ZOIKO_TOKEN" \\
  -H "X-Jurisdiction: APAC" \\
  --cert client.pem`}
          />
          <CodeBlock label="200 OK · application/json" code={exampleResponse} />
        </CardContent>
      </Card>

      {/* Security, auth flow, rate limits */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ChartCard title="Security Status" description="Gateway posture and controls." index={0}>
          <ul className="flex flex-col gap-3">
            {securityStatus.map((s) => (
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
          description="OAuth 2.0 client credentials + mTLS."
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

        <ChartCard title="Rate Limits" description="Per-tier request ceilings." index={2}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">Burst</TableHead>
                <TableHead className="text-right">Conc.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rateTiers.map((t) => (
                <TableRow key={t.tier}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <KeyRound className="size-3.5 text-muted-foreground" />
                      {t.tier}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular">{t.limit}</TableCell>
                  <TableCell className="text-right tabular">{t.burst}</TableCell>
                  <TableCell className="text-right tabular">{t.concurrency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
      </div>
    </div>
  )
}
