import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/shared/status'
import { ErrorState } from '@/components/shared/states'
import { PharmacyOnboardingState } from '@/components/shared/pharmacy-onboarding-state'
import { Flash, useFlash } from '@/components/shared/flash'
import { CopyButton } from '@/components/shared/copy-button'
import {
  getIntegration,
  saveIntegration,
  disconnectIntegration,
  triggerSync,
  issueIntegrationKey,
} from '@/services/pharmacy-api'
import { apiBaseUrl } from '@/lib/api-client'
import { formatRelative } from '@/utils/format'
import {
  PlugZap, RefreshCw, Loader2, Clock, KeyRound,
  TriangleAlert, Unplug, Download, Upload, BookOpen,
} from 'lucide-react'

const SYNC_TONE = { success: 'good', partial: 'warning', failed: 'critical' }

const INTERVALS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Once a day' },
]

const blankForm = {
  provider: '',
  direction: 'PULL',
  feedUrl: '',
  authHeaderName: '',
  authHeaderValue: '',
  syncMode: 'merge',
  intervalMinutes: 60,
  enabled: true,
}

/**
 * The stored configuration as form state.
 *
 * authHeaderValue is deliberately always empty: the server never returns the
 * credential, and pre-filling the field with a placeholder would mean saving
 * the form wrote the placeholder back. Left empty, an omitted value keeps
 * whatever is stored — which is what the API does with it.
 */
const toForm = (data) => ({
  provider: data.provider || '',
  direction: data.direction || 'PULL',
  feedUrl: data.feedUrl || '',
  authHeaderName: data.authHeaderName || '',
  authHeaderValue: '',
  syncMode: data.syncMode || 'merge',
  intervalMinutes: data.intervalMinutes ?? 60,
  enabled: data.enabled ?? true,
})

const selectClass =
  'rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary'

/**
 * The push endpoint as something an operator can paste into a POS config.
 *
 * apiBaseUrl() is normally the relative proxy path "/internal", which is fine
 * for this app's own fetches and useless in a curl command run on somebody
 * else's server — so it is resolved against the current origin. That URL is
 * proxied to the API, so it genuinely works from outside.
 */
function pushEndpoint() {
  const base = apiBaseUrl()
  const absolute = base.startsWith('http')
    ? base
    : `${window.location.origin}${base}`
  return `${absolute.replace(/\/$/, '')}/pharmacies/integration/push`
}

export default function PharmacyIntegration() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notLinked, setNotLinked] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(blankForm)
  const [formError, setFormError] = useState('')
  const [issuedKey, setIssuedKey] = useState('')
  const [flashMsg, flash] = useFlash()

  const load = useCallback(async () => {
    setError('')
    try {
      const next = await getIntegration()
      setData(next)
      setForm(next.connected ? toForm(next) : blankForm)
    } catch (err) {
      if (err.notLinked) setNotLinked(true)
      else setError(err.message || 'Could not load your integration settings.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      const body = {
        provider: form.provider.trim(),
        direction: form.direction,
        syncMode: form.syncMode,
        enabled: form.enabled,
        intervalMinutes: Number(form.intervalMinutes),
      }
      if (form.direction === 'PULL') {
        body.feedUrl = form.feedUrl.trim()
        body.authHeaderName = form.authHeaderName.trim()
        // Only sent when the operator typed something. Omitting it keeps the
        // stored credential; sending "" would clear it.
        if (form.authHeaderValue) body.authHeaderValue = form.authHeaderValue
      }
      const next = await saveIntegration(body)
      setData(next)
      setForm(toForm(next))
      setEditing(false)
      flash(data?.connected ? 'Integration updated' : 'Integration connected')
    } catch (err) {
      setFormError(err.message || 'Could not save the integration.')
    } finally {
      setSaving(false)
    }
  }

  const manualSync = async () => {
    setSyncing(true)
    try {
      const next = await triggerSync()
      setData(next)
      // The run may well have failed — its reason is the newest history row, and
      // saying "sync completed" over the top of that would be a lie the page is
      // in a position to check.
      const latest = next.history?.[0]
      flash(
        latest?.status === 'failed'
          ? 'Sync failed — see the reason below'
          : latest?.status === 'partial'
            ? `Synced with ${latest.skipped} row(s) skipped`
            : 'Sync completed',
      )
    } catch (err) {
      flash(err.message || 'Sync failed — please try again')
    } finally {
      setSyncing(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm(
      'Disconnect this integration? Your inventory stays exactly as it is — only the automatic feed and its sync history are removed.',
    )) return
    setSaving(true)
    try {
      const next = await disconnectIntegration()
      setData(next)
      setForm(blankForm)
      setEditing(false)
      setIssuedKey('')
      flash('Integration disconnected')
    } catch (err) {
      flash(err.message || 'Could not disconnect')
    } finally {
      setSaving(false)
    }
  }

  const issueKey = async () => {
    if (
      data?.apiKeyPrefix &&
      !window.confirm(
        'Generate a new key? The current key stops working immediately, and anything still using it will fail.',
      )
    ) return
    setSaving(true)
    try {
      const { apiKey, integration } = await issueIntegrationKey()
      setIssuedKey(apiKey)
      setData(integration)
    } catch (err) {
      flash(err.message || 'Could not issue a key')
    } finally {
      setSaving(false)
    }
  }

  if (notLinked) {
    return (
      <PharmacyOnboardingState
        title="Connect a POS or ERP once your pharmacy is set up"
        description="An integration writes stock into your pharmacy's inventory, so there has to be a pharmacy to write to. Complete your profile first."
      />
    )
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load your integration"
        description={error}
        onRetry={load}
        className="max-w-3xl"
      />
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading integration status…
      </div>
    )
  }

  const isPull = data.connected && data.direction === 'PULL'
  const showForm = editing || !data.connected

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integration"
        subtitle="Connect your POS / ERP so availability stays fresh automatically."
        actions={
          // Available while paused too: pausing stops the schedule, it does not
          // stop the operator asking for one run.
          isPull && (
            <Button onClick={manualSync} disabled={syncing}>
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync now
            </Button>
          )
        }
      />
      {flashMsg && <Flash message={flashMsg} />}

      {/* Connection status */}
      {data.connected && (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <PlugZap className="size-5" />
              </span>
              <div className="flex flex-col">
                <span className="text-base font-bold text-foreground">{data.provider}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {data.direction === 'PULL' ? (
                    <><Download className="size-3.5" /> ZoikoMeds fetches your feed</>
                  ) : (
                    <><Upload className="size-3.5" /> Your system pushes to ZoikoMeds</>
                  )}
                  {' · '}
                  {data.syncMode === 'replace' ? 'Full replace' : 'Merge'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!data.enabled && <Badge variant="secondary" size="sm">Paused</Badge>}
              <Badge variant={data.enabled ? 'success' : 'secondary'} size="sm">
                {data.enabled ? 'Connected' : 'Connected (paused)'}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Last sync</span>
              <span className="font-semibold text-foreground">
                {formatRelative(data.lastSyncAt) || 'Never'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Next sync</span>
              <span className="font-semibold text-foreground">
                {!data.enabled
                  ? 'Paused'
                  : data.direction === 'PUSH'
                    ? 'On push'
                    : formatRelative(data.nextSyncAt) || 'Due now'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Last result</span>
              <span
                className={`font-semibold ${
                  data.lastSyncStatus === 'failed'
                    ? 'text-danger'
                    : data.lastSyncStatus === 'partial'
                      ? 'text-warning'
                      : data.lastSyncStatus === 'success'
                        ? 'text-success'
                        : 'text-muted-foreground'
                }`}
              >
                {data.lastSyncStatus
                  ? data.lastSyncStatus[0].toUpperCase() + data.lastSyncStatus.slice(1)
                  : 'Not run yet'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Schedule</span>
              <span className="font-semibold text-foreground">
                {data.direction === 'PUSH'
                  ? 'When you push'
                  : (INTERVALS.find((i) => i.value === data.intervalMinutes)?.label ??
                     `Every ${data.intervalMinutes} min`)}
              </span>
            </div>
          </div>

          {!showForm && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit connection
              </Button>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={saving}>
                <Unplug className="size-4" />
                Disconnect
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Connect / edit form */}
      {showForm && (
        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-foreground">
              {data.connected ? 'Edit connection' : 'Connect your POS or ERP'}
            </h3>
            <p className="text-sm text-muted-foreground">
              Every sync writes into the same inventory the Inventory tab shows — the
              feed is just another way to update it, not a separate list.
            </p>
          </div>

          <form className="flex flex-col gap-5" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="i-provider">System name</Label>
                <Input
                  id="i-provider"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Marg ERP"
                  value={form.provider}
                  onChange={(e) => set('provider')(e.target.value)}
                />
                <span className="text-[11px] text-muted-foreground">
                  Whatever you call the system this stock comes from.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="i-direction">How stock reaches us</Label>
                <select
                  id="i-direction"
                  className={selectClass}
                  value={form.direction}
                  onChange={(e) => set('direction')(e.target.value)}
                >
                  <option value="PULL">We fetch your file on a schedule</option>
                  <option value="PUSH">Your system posts to us</option>
                </select>
                <span className="text-[11px] text-muted-foreground">
                  {form.direction === 'PULL'
                    ? 'Publish a CSV or JSON file at a public URL and we read it.'
                    : 'For systems behind a firewall we cannot reach. You get an API key.'}
                </span>
              </div>
            </div>

            {form.direction === 'PULL' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="i-url">Feed URL</Label>
                  <Input
                    id="i-url"
                    required
                    type="url"
                    placeholder="https://pos.yourpharmacy.com/exports/stock.csv"
                    value={form.feedUrl}
                    onChange={(e) => set('feedUrl')(e.target.value)}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Must be reachable from the public internet and must not redirect.
                    CSV or JSON, both accepted.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="i-header">Auth header name (optional)</Label>
                    <Input
                      id="i-header"
                      placeholder="Authorization"
                      value={form.authHeaderName}
                      onChange={(e) => set('authHeaderName')(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="i-secret">Auth header value (optional)</Label>
                    <Input
                      id="i-secret"
                      type="password"
                      autoComplete="off"
                      placeholder={data.hasAuthHeader ? 'Stored — leave blank to keep' : 'Bearer …'}
                      value={form.authHeaderValue}
                      onChange={(e) => set('authHeaderValue')(e.target.value)}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Encrypted and never shown again. Leave blank to keep the stored value.
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="i-mode">What a sync does</Label>
                <select
                  id="i-mode"
                  className={selectClass}
                  value={form.syncMode}
                  onChange={(e) => set('syncMode')(e.target.value)}
                >
                  <option value="merge">Merge — update what the feed lists</option>
                  <option value="replace">Replace — the feed is my whole stock list</option>
                </select>
                <span className="text-[11px] text-muted-foreground">
                  {form.syncMode === 'replace'
                    ? 'Medicines missing from the feed are removed from your listing.'
                    : 'Medicines missing from the feed are left exactly as they are.'}
                </span>
              </div>

              {form.direction === 'PULL' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="i-interval">How often</Label>
                  <select
                    id="i-interval"
                    className={selectClass}
                    value={form.intervalMinutes}
                    onChange={(e) => set('intervalMinutes')(Number(e.target.value))}
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>{i.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div className="flex flex-col">
                <Label htmlFor="i-enabled">Automatic syncing</Label>
                <span className="text-[11px] text-muted-foreground">
                  Pause while your POS is being upgraded. Your settings and key are kept.
                </span>
              </div>
              <Switch
                id="i-enabled"
                checked={form.enabled}
                onCheckedChange={set('enabled')}
              />
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {formError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {data.connected ? 'Save changes' : 'Connect'}
              </Button>
              {data.connected && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setEditing(false); setForm(toForm(data)); setFormError('') }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* Push credentials */}
      {data.connected && data.direction === 'PUSH' && (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="size-5" />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground">Integration key</span>
                <span className="text-xs text-muted-foreground">
                  {data.apiKeyPrefix
                    ? `${data.apiKeyPrefix}… · issued ${formatRelative(data.apiKeyIssuedAt) || 'recently'}`
                    : 'No key issued yet'}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={issueKey} disabled={saving}>
              {data.apiKeyPrefix ? 'Rotate key' : 'Generate key'}
            </Button>
          </div>

          {issuedKey && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TriangleAlert className="size-4 text-warning" aria-hidden />
                Copy this key now — it is not shown again
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
                  {issuedKey}
                </code>
                <CopyButton value={issuedKey} label="Copy key" />
              </div>
              <span className="text-[11px] text-muted-foreground">
                Only a hash is stored, so we cannot show it to you later. Lose it and you
                generate a new one.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Post your stock here
            </span>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
{`curl -X POST ${pushEndpoint()} \\
  -H "X-Zoiko-Api-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[{"name":"Amoxicillin 500mg","status":"available"}]}'`}
            </pre>
            <CopyButton value={pushEndpoint()} label="Copy endpoint" />
          </div>
        </Card>
      )}

      {/* Sync history */}
      {data.connected && (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-4 text-primary" />
            Sync history
          </h3>
          <Card className="divide-y divide-border p-0">
            {data.history.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No syncs yet.{' '}
                {data.direction === 'PULL'
                  ? 'The first one runs on the schedule above, or press Sync now.'
                  : 'Attempts appear here as soon as your system posts stock.'}
              </p>
            ) : (
              data.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-foreground">{h.note}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(h.startedAt)} · {h.trigger} ·{' '}
                      {h.status === 'failed'
                        ? 'no rows applied'
                        : `${h.rows} row${h.rows === 1 ? '' : 's'} · ${h.imported} added, ${h.updated} updated${h.skipped ? `, ${h.skipped} skipped` : ''}`}
                    </span>
                  </div>
                  <StatusBadge tone={SYNC_TONE[h.status] ?? 'neutral'} size="sm">
                    {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
                  </StatusBadge>
                </div>
              ))
            )}
          </Card>
        </section>
      )}

      {/* What the feed has to contain. In-product because the operator setting
          this up is looking at this page, not at documentation. */}
      <Card className="flex flex-col gap-3 border-primary/20 bg-primary/5 p-5">
        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookOpen className="size-4 text-primary" aria-hidden />
          What your file needs to contain
        </span>
        <p className="text-sm leading-relaxed text-foreground">
          One row per medicine. <strong>name</strong> is the only required column —
          everything else sharpens the match against MediBase™, which is what puts your
          stock in front of the right patient search.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-card p-3 text-[11px] leading-relaxed">
{`name,generic,strength,form,status
Amoxicillin 500mg,Amoxicillin,500 mg,Capsule,available
Metformin 500mg,Metformin,500 mg,Tablet,limited
Salbutamol Inhaler,Salbutamol,100 mcg,Inhaler,out-of-stock`}
        </pre>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong>status</strong> is one of available, limited or out-of-stock; anything
          else is read as available. If your system holds MediBase identity ids, send a{' '}
          <strong>medicineId</strong> column instead of a name and the row attaches to
          that identity exactly. JSON works too — an array of the same objects, or{' '}
          <code>{'{ "items": [...] }'}</code>.
        </p>
      </Card>
    </div>
  )
}
