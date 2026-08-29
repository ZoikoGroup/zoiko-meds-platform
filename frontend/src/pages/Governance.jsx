import { Link } from 'react-router-dom'
import { Users, ShieldCheck, BookOpen, ChevronRight, ScanSearch } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  oversightFunctions,
  governanceStandards,
  governanceStage,
} from '@/services/governance-data'

export default function Governance() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header: intro (left) + position-based governance staging note (right) */}
      <section className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-3">
          <Breadcrumb className="mb-1">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/admin">ZoikoMeds</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Leadership &amp; Oversight</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">
            Leadership &amp; Oversight
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
            Accountable by design.
          </h1>
          <p className="text-base text-muted-foreground">
            ZoikoMeds is governed through defined oversight functions — each with
            clear accountability for how the platform is built, protected, and
            commercialized.
          </p>
          <p className="text-base text-muted-foreground">
            Every function below is anchored to published standards in the
            ZoikoMeds{' '}
            <a
              href="https://zoikomeds.com/trust-center"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-teal underline-offset-4 hover:underline"
            >
              Trust Center
            </a>
            .
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 lg:max-w-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">
              <Users className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-tight">
                {governanceStage.current}
              </p>
              <p className="text-sm text-muted-foreground">
                {governanceStage.summary}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Stage 2 Trigger:</span>{' '}
            {governanceStage.trigger}
          </div>
        </div>
      </section>

      {/* Six oversight functions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {oversightFunctions.map((f, i) => {
          const Icon = f.icon
          return (
            <Card key={f.id} className="p-6 transition-shadow hover:shadow-card">
              <div className="flex gap-4">
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-full',
                    f.accent
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
                    {i + 1}. {f.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-1 w-fit max-w-full whitespace-normal text-left border-teal/40 text-teal"
                  >
                    {f.tag}
                  </Badge>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Standards we operate against */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="flex items-start gap-3 lg:max-w-xs lg:shrink-0">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-teal" />
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-teal">
                Standards we operate against
              </h3>
              <p className="text-xs text-muted-foreground">
                Our governance is built on globally recognized standards and
                best-practice frameworks.
              </p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-5 sm:grid-cols-3">
            {governanceStandards.map((s) => {
              const Icon = s.icon
              return (
                <div
                  key={s.id}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <Icon className="size-6 text-muted-foreground" />
                  <span className="text-sm font-semibold leading-tight">
                    {s.name}
                  </span>
                  <span
                    className={cn(
                      'text-[11px]',
                      s.pending ? 'text-warning' : 'text-muted-foreground'
                    )}
                  >
                    {s.detail}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Governance in detail — CTA band */}
      <Card className="relative overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.06] to-teal/[0.07] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="flex items-start gap-4 lg:gap-5">
            <span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-teal text-white shadow-sm sm:flex">
              <ShieldCheck className="size-7" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Governance in detail.
              </h3>
              <p className="max-w-xl text-sm text-muted-foreground">
                Enterprise, wholesale, and public-sector partners can review our
                full governance, security, and privacy posture — or request a
                review through the existing enterprise pathway.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            <Button asChild variant="teal" size="lg">
              <a href="https://zoikomeds.com/trust-center" target="_blank" rel="noopener noreferrer">
                <BookOpen />
                Visit the Trust Center
                <ChevronRight />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="mailto:info@zoikomeds.com?subject=Security%20%26%20Procurement%20Review%20Request">
                <ScanSearch />
                Request Security &amp; Procurement Review
                <ChevronRight />
              </a>
            </Button>
          </div>
        </div>
      </Card>

      {/* Footer assurance line */}
      <div className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-teal" />
        Governed for patient safety, data trust, medicine availability integrity,
        and responsible healthcare intelligence.
      </div>
    </div>
  )
}
