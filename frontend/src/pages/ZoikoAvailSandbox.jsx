import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Copy,
  Hash,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { apiBaseUrl, getToken } from '@/lib/api-client'
import {
  SANDBOX_ENDPOINTS,
  buildQueryString,
  exampleValues,
} from '@/services/sandbox-endpoints'

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

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="gap-1.5">
      {copied ? <Check className="text-success" /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

function statusTone(status) {
  if (status >= 200 && status < 300) return 'text-success'
  if (status >= 400 && status < 500) return 'text-warning'
  return 'text-destructive'
}

export default function ZoikoAvailSandbox() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState(SANDBOX_ENDPOINTS[0].id)
  const endpoint = useMemo(
    () => SANDBOX_ENDPOINTS.find((e) => e.id === selectedId),
    [selectedId]
  )
  const [valuesById, setValuesById] = useState(() => ({
    [SANDBOX_ENDPOINTS[0].id]: exampleValues(SANDBOX_ENDPOINTS[0]),
  }))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const values = valuesById[selectedId] ?? {}
  const hasToken = Boolean(getToken())

  const path = `${endpoint.path}${buildQueryString(endpoint.params, values)}`
  const fullUrl = `${apiBaseUrl()}${path}`
  const curl = `curl -s "${fullUrl}"${hasToken ? ' \\\n  -H "Authorization: Bearer <token>"' : ''}`

  function selectEndpoint(id) {
    setSelectedId(id)
    setResult(null)
    setValuesById((prev) =>
      prev[id]
        ? prev
        : { ...prev, [id]: exampleValues(SANDBOX_ENDPOINTS.find((e) => e.id === id)) }
    )
  }

  function setValue(name, value) {
    setValuesById((prev) => ({
      ...prev,
      [selectedId]: { ...(prev[selectedId] ?? {}), [name]: value },
    }))
  }

  function fillExample() {
    setValuesById((prev) => ({ ...prev, [selectedId]: exampleValues(endpoint) }))
  }

  function reset() {
    setValuesById((prev) => ({ ...prev, [selectedId]: {} }))
    setResult(null)
  }

  async function send() {
    const missing = endpoint.params.filter(
      (p) => p.required && (values[p.name] === undefined || values[p.name] === '')
    )
    if (missing.length) {
      setResult({
        error: `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing
          .map((m) => m.label)
          .join(', ')}`,
      })
      return
    }

    setLoading(true)
    setResult(null)
    const token = getToken()
    const started = performance.now()
    try {
      const res = await fetch(fullUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const ms = Math.round(performance.now() - started)
      const text = await res.text()
      let body
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      setResult({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText || '',
        ms,
        traceId: res.headers.get('X-Request-Id'),
        body,
      })
    } catch {
      // Network / CORS failure — the API is unreachable. Fall back to the
      // offline sample so the console still shows the response shape, clearly
      // flagged so it is never mistaken for a live result.
      const ms = Math.round(performance.now() - started)
      setResult({
        offline: true,
        ok: true,
        status: 200,
        statusText: 'OK',
        ms,
        body: endpoint.sample,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="ZoikoAvail™"
        title="API Sandbox"
        subtitle="Try the governed, aggregate-only ZoikoAvail API live. Pick an endpoint, set parameters, and send a real request."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/admin/dashboard' },
          { label: 'ZoikoAvail™', to: '/admin/zoikoavail' },
          { label: 'Sandbox' },
        ]}
        meta={
          <>
            <Badge variant="outline" size="sm" className="font-mono">
              {apiBaseUrl()}
            </Badge>
            <Badge variant={hasToken ? 'success' : 'secondary'} size="sm">
              {hasToken ? <ShieldCheck className="size-3.5" /> : <KeyRound className="size-3.5" />}
              {hasToken ? 'Test key attached' : 'Unauthenticated (public)'}
            </Badge>
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/admin/zoikoavail')}>
              <ArrowLeft />
              Back to ZoikoAvail
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open(`${apiBaseUrl()}/docs`, '_blank', 'noopener')}
            >
              <BookOpen />
              Documentation
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Request builder */}
        <Card className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Request</h2>
          </div>

          {/* Endpoint picker */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endpoint">Endpoint</Label>
            <select
              id="endpoint"
              value={selectedId}
              onChange={(e) => selectEndpoint(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {SANDBOX_ENDPOINTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.method} {e.path} — {e.summary}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{endpoint.description}</p>
          </div>

          {/* Method + path preview */}
          <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2">
            <MethodTag method={endpoint.method} />
            <code className="whitespace-nowrap font-mono text-[13px]">{path}</code>
          </div>

          {/* Parameters */}
          {endpoint.params.length > 0 ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Parameters
                </span>
                <Button variant="ghost" size="sm" onClick={fillExample}>
                  Fill example
                </Button>
              </div>
              {endpoint.params.map((p) => (
                <div key={p.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={p.name}>
                    {p.label}
                    {p.required && <span className="ml-1 text-destructive">*</span>}
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {p.name}
                    </span>
                  </Label>
                  {p.type === 'boolean' ? (
                    <div className="flex h-9 items-center">
                      <Switch
                        id={p.name}
                        checked={Boolean(values[p.name])}
                        onCheckedChange={(v) => setValue(p.name, v)}
                      />
                    </div>
                  ) : p.type === 'select' ? (
                    <select
                      id={p.name}
                      value={values[p.name] ?? ''}
                      onChange={(e) => setValue(p.name, e.target.value)}
                      className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <option value="">Select…</option>
                      {p.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={p.name}
                      type={p.type === 'number' ? 'number' : 'text'}
                      value={values[p.name] ?? ''}
                      placeholder={p.placeholder}
                      onChange={(e) => setValue(p.name, e.target.value)}
                    />
                  )}
                  {p.help && <p className="text-xs text-muted-foreground">{p.help}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This endpoint takes no parameters.</p>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={send} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              {loading ? 'Sending…' : 'Send request'}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={loading}>
              Reset
            </Button>
          </div>

          {/* curl */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                cURL
              </span>
              <CopyButton value={curl} />
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              {curl}
            </pre>
          </div>
        </Card>

        {/* Response viewer */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Response</h2>
            {result?.body !== undefined && !result?.error && (
              <CopyButton
                value={
                  typeof result.body === 'string'
                    ? result.body
                    : JSON.stringify(result.body, null, 2)
                }
                label="Copy JSON"
              />
            )}
          </div>

          {!result && !loading && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
              Send a request to see the governed response here.
            </div>
          )}

          {loading && (
            <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Awaiting response…
            </div>
          )}

          {result?.error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {result.error}
            </div>
          )}

          {result && !result.error && (
            <>
              {result.offline && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>
                    The API at <code className="font-mono">{apiBaseUrl()}</code> was unreachable.
                    Showing an offline sample response — not live data.
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <span className={cn('flex items-center gap-1.5 font-semibold', statusTone(result.status))}>
                  <span className="tabular">{result.status}</span>
                  {result.statusText}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3.5" />
                  <span className="tabular">{result.ms}ms</span>
                </span>
                {result.traceId && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Hash className="size-3.5" />
                    <code className="font-mono">{result.traceId}</code>
                  </span>
                )}
              </div>
              <pre className="max-h-[520px] flex-1 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {typeof result.body === 'string'
                  ? result.body
                  : JSON.stringify(result.body, null, 2)}
              </pre>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
