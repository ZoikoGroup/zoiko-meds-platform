import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, ExternalLink, Loader2, Lock, Unlock } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState } from '@/components/shared/states'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getZoikoAvailContract } from '@/services/admin-api'

/**
 * The ZoikoAvail™ API contract, inside the console.
 *
 * The Documentation button used to open the backend's Swagger UI, which does
 * not work anywhere it matters: production withholds `/api/docs` on purpose, and
 * locally the relative URL resolved against the Vite origin and hit the SPA's
 * own 404 page. An operator clicking Documentation got a dead tab either way.
 *
 * Everything below is read from `GET /admin/zoikoavail/openapi`, a filtered view
 * of the same OpenAPI document Swagger generates from the controllers. Nothing
 * here is a second, hand-written copy of the contract, so it cannot drift: add a
 * guard to a controller and the padlock on this page changes with it.
 */

const METHOD_STYLE = {
  GET: 'bg-info/12 text-info',
  POST: 'bg-success/12 text-success',
  PATCH: 'bg-warning/15 text-warning',
  DELETE: 'bg-danger/12 text-danger',
}

function MethodPill({ method }) {
  return (
    <code
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide',
        METHOD_STYLE[method] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {method}
    </code>
  )
}

/** Who may call an endpoint, said the same way for every one of them. */
function AuthLine({ auth }) {
  if (!auth?.required) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <Unlock className="size-3.5 shrink-0" />
        Public — no token required
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <Lock className="size-3.5 shrink-0" />
        Bearer token required
      </span>
      <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {auth.header}
      </code>
      {auth.roles?.length > 0 && (
        <span className="text-[11px] text-muted-foreground">
          Allowed roles: {auth.roles.join(' · ')}
        </span>
      )}
    </div>
  )
}

function Endpoint({ endpoint }) {
  const { parameters = [], responses = [] } = endpoint
  const query = parameters.filter((p) => p.in === 'query')
  const path = parameters.filter((p) => p.in === 'path')

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <MethodPill method={endpoint.method} />
        <code className="text-sm font-semibold text-foreground">{endpoint.path}</code>
        {endpoint.scope && (
          <Badge variant="secondary" size="sm">
            scope: {endpoint.scope}
          </Badge>
        )}
      </div>

      {endpoint.summary && (
        <p className="text-sm font-medium text-foreground">{endpoint.summary}</p>
      )}
      {endpoint.description && (
        <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
          {endpoint.description}
        </p>
      )}

      <AuthLine auth={endpoint.auth} />

      {[
        ['Path parameters', path],
        ['Query parameters', query],
      ].map(([label, rows]) =>
        rows.length === 0 ? null : (
          <div key={label} className="flex flex-col gap-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {label}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {rows.map((p) => (
                <li key={p.name} className="flex flex-col gap-0.5 border-s-2 border-border ps-2.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    <code className="font-semibold text-foreground">{p.name}</code>
                    {p.type && <span className="text-muted-foreground">{p.type}</span>}
                    <Badge variant={p.required ? 'warning' : 'outline'} size="sm">
                      {p.required ? 'required' : 'optional'}
                    </Badge>
                  </span>
                  {p.description && (
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                      {p.description}
                    </span>
                  )}
                  {p.example != null && (
                    <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      e.g. {String(p.example)}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}

      {responses.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Responses
          </h4>
          <ul className="flex flex-col gap-1.5">
            {responses.map((r) => (
              <li key={r.status} className="flex flex-col gap-1">
                <span className="flex items-start gap-2 text-xs">
                  <code
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold',
                      r.status.startsWith('2')
                        ? 'bg-success/12 text-success'
                        : 'bg-danger/12 text-danger',
                    )}
                  >
                    {r.status}
                  </code>
                  <span className="leading-relaxed text-muted-foreground">{r.description}</span>
                </span>
                {r.example != null && (
                  <pre className="overflow-x-auto rounded-lg bg-muted p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(r.example, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export default function ZoikoAvailDocumentation() {
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    getZoikoAvailContract()
      .then(setContract)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // Production leads; the service orders the list and labels each entry, so the
  // page does not decide which host is which.
  const servers = contract?.servers ?? []
  const primary = servers[0] ?? null
  const secondary = servers.slice(1)


  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !contract) {
    return (
      <ErrorState
        title="Couldn't load the API contract"
        description="The governed API contract could not be read from this deployment. Please try again."
        onRetry={load}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="API Documentation"
        subtitle="The governed ZoikoAvail™ API surface, generated from the running service."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/dashboard' },
          { label: 'ZoikoAvail™', to: '/admin/zoikoavail' },
          { label: 'API Documentation' },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/admin/zoikoavail')}>
              <ArrowLeft />
              Back to ZoikoAvail
            </Button>
            {/*
              Shown everywhere now, production included.
              It used to appear only in development, because the only explorer
              was the backend's own /api/docs — withheld on the live deployment
              so the full API surface is not published. The explorer it opens is
              rendered inside the console from the filtered contract, so there
              is nothing environment-specific left to hide.
            */}
            <Button
              variant="outline"
              onClick={() => navigate('/admin/zoikoavail/swagger')}
            >
              <ExternalLink />
              Open Swagger UI
            </Button>
          </>
        }
      />

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookOpen className="size-4 text-primary" />
          API base URL
        </h2>

        {/*
          One headline URL, and it is the production API.
          The page used to list whatever the document declared, in its order —
          so a Super Admin's reference opened with "http://localhost:8000/api"
          and "/api": a developer's machine, and a path naming no host at all.
        */}
        {primary && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
              {primary.description ?? 'Production API'}
            </span>
            <code className="w-fit break-all rounded-lg bg-primary/10 px-2.5 py-1.5 text-sm font-semibold text-foreground">
              {primary.url}
            </code>
          </div>
        )}

        {/* Kept, because a developer testing against a local backend needs it —
            just not as the thing the page leads with. */}
        {secondary.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            {secondary.map((server) => (
              <div key={server.url} className="flex flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {server.description ?? 'Other'}
                </span>
                <code className="w-fit break-all text-xs text-muted-foreground">{server.url}</code>
              </div>
            ))}
          </div>
        )}
        {contract.description && (
          <p className="whitespace-pre-line pt-1 text-xs leading-relaxed text-muted-foreground">
            {contract.description}
          </p>
        )}
      </Card>

      {contract.sections.map((section) => (
        <section key={section.name} className="flex flex-col gap-3">
          <h2 className="text-base font-bold text-foreground">{section.name}</h2>
          <div className="flex flex-col gap-3">
            {section.endpoints.map((endpoint) => (
              <Endpoint key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
