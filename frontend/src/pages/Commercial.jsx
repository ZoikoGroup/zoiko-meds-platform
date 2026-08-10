import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorState, EmptyState } from '@/components/shared/states'
import { Flash, useFlash } from '@/components/shared/flash'
import * as commercial from '@/services/commercial-api'
import {
  BILLING_CHANNELS,
  BILLING_INTERVALS,
  BILLING_RBAC_MATRIX,
  COMMERCIAL_OFFERS,
  DELINQUENCY_TIMELINE,
  USAGE_THRESHOLDS,
  formatMinor,
} from '@/lib/commercial'
import {
  AlertTriangle,
  BadgeCheck,
  Info,
  Loader2,
  Lock,
  Plus,
  Search,
  Tag,
} from 'lucide-react'

const EMPTY_PRICE = {
  offer: 'PHARMACY_INTELLIGENCE_PRO',
  market: '',
  currency: 'USD',
  interval: 'MONTH',
  amountMajor: '',
  channel: 'WEB_SELF_SERVE',
  catalogVersion: '',
  approvalReference: '',
  effectiveFrom: '',
}

/**
 * Commercial administration — ZM-COM-BILL-001.
 *
 * The price catalog is the only place a chargeable amount can come from, so this
 * screen is where Finance loads approved prices. Everything here is real data from
 * /admin/commercial; nothing is fabricated, because a made-up price or usage
 * figure on a financial surface is worse than an error.
 */
export default function Commercial() {
  const [prices, setPrices] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [flashMsg, flash] = useFlash()

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_PRICE)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Price resolver — proves the fail-closed behaviour to an operator.
  const [probe, setProbe] = useState({
    offer: 'PHARMACY_INTELLIGENCE_PRO',
    market: '',
    currency: 'USD',
    interval: 'MONTH',
    channel: 'WEB_SELF_SERVE',
  })
  const [probeResult, setProbeResult] = useState(null)
  const [probing, setProbing] = useState(false)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setPrices(await commercial.listPrices())
    } catch (err) {
      setLoadError(err.message || 'Could not load the price catalog.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const submitPrice = async (e) => {
    e.preventDefault()
    setFormError('')

    const major = Number(form.amountMajor)
    if (!form.market.trim() || form.market.trim().length !== 2) {
      setFormError('Market must be a 2-letter ISO country code, e.g. IN or US.')
      return
    }
    if (!Number.isFinite(major) || major <= 0) {
      setFormError('Enter the approved amount as a positive number.')
      return
    }
    if (!form.approvalReference.trim()) {
      setFormError('An approval reference is required — a price cannot enter the catalog without one.')
      return
    }
    if (!form.catalogVersion.trim()) {
      setFormError('A catalog version is required.')
      return
    }
    if (!form.effectiveFrom) {
      setFormError('An effective-from date is required.')
      return
    }

    setSaving(true)
    try {
      await commercial.createPrice({
        offer: form.offer,
        market: form.market.trim().toUpperCase(),
        currency: form.currency.trim().toUpperCase(),
        interval: form.interval,
        // Money crosses the wire in minor units so it is never a float.
        amountMinor: Math.round(major * 100),
        channel: form.channel,
        catalogVersion: form.catalogVersion.trim(),
        approvalReference: form.approvalReference.trim(),
        effectiveFrom: new Date(form.effectiveFrom).toISOString(),
      })
      setAddOpen(false)
      setForm(EMPTY_PRICE)
      flash('Price added to the catalog')
      await load()
    } catch (err) {
      setFormError(err.message || 'Could not add the price.')
    } finally {
      setSaving(false)
    }
  }

  const runProbe = async () => {
    setProbing(true)
    setProbeResult(null)
    try {
      const entry = await commercial.resolvePrice(probe)
      setProbeResult({ ok: true, entry })
    } catch (err) {
      // A miss is the correct, designed outcome — not a page error.
      setProbeResult({ ok: false, message: err.message })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Commercial"
        subtitle="Price catalog governance, plan taxonomy, and billing access control."
        actions={
          <Button size="sm" onClick={() => { setFormError(''); setAddOpen(true) }} className="gap-1">
            <Plus className="size-3.5" />
            Add approved price
          </Button>
        }
      />

      {flashMsg && <Flash message={flashMsg} className="max-w-3xl" />}

      <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning max-w-4xl">
        <div className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle className="size-5 shrink-0" />
          Live charging is not enabled
        </div>
        <p className="pl-7 text-xs leading-relaxed text-foreground/90">
          No payment provider is connected. Before any customer can be charged, the launch blockers
          must close: an approved price per market and currency, a verified merchant and bank
          beneficiary, tax registrations, and reconciliation of the contracting legal entity.
          Adding a catalog record here does not charge anyone.
        </p>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Price catalog</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="access">Billing access</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>

        {/* --- Price catalog ------------------------------------------------ */}
        <TabsContent value="catalog">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="size-4 text-primary" /> Approved prices
                </CardTitle>
                <CardDescription>
                  The only legitimate source of a charge amount. A locked record has been referenced
                  by a finalized invoice and can never be edited — publish a new catalog version
                  instead.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                {loadError ? (
                  <ErrorState
                    title="Could not load the price catalog"
                    description={loadError}
                    onRetry={load}
                  />
                ) : !prices ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading catalog…
                  </div>
                ) : prices.length === 0 ? (
                  <EmptyState
                    icon={Tag}
                    title="No approved prices yet"
                    description="Until a price exists for a market, currency and interval, conversion to a paid plan fails closed and routes to sales. That is the intended behaviour."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Offer</TableHead>
                          <TableHead>Market</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Interval</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Approval</TableHead>
                          <TableHead>Effective</TableHead>
                          <TableHead>State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prices.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs font-medium">{p.offer}</TableCell>
                            <TableCell className="text-xs">{p.market}</TableCell>
                            <TableCell className="text-xs font-semibold tabular">
                              {formatMinor(p.amountMinor, p.currency)}
                            </TableCell>
                            <TableCell className="text-xs">{p.interval}</TableCell>
                            <TableCell className="text-xs">{p.channel}</TableCell>
                            <TableCell className="text-xs">{p.catalogVersion}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {p.approvalReference}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(p.effectiveFrom).toLocaleDateString()}
                              {p.effectiveTo
                                ? ` – ${new Date(p.effectiveTo).toLocaleDateString()}`
                                : ''}
                            </TableCell>
                            <TableCell>
                              {p.lockedAt ? (
                                <Badge variant="secondary" className="gap-1">
                                  <Lock className="size-3" /> Locked
                                </Badge>
                              ) : (
                                <Badge variant="success">Editable</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Price resolver */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="size-4 text-primary" /> Resolve a price
                </CardTitle>
                <CardDescription>
                  Shows exactly what checkout would charge, or that it would fail closed. Use this
                  before enabling a market.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pr-offer">Offer</Label>
                    <select
                      id="pr-offer"
                      value={probe.offer}
                      onChange={(e) => setProbe((p) => ({ ...p, offer: e.target.value }))}
                      className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs outline-none focus:border-primary"
                    >
                      {COMMERCIAL_OFFERS.map((o) => (
                        <option key={o.code} value={o.code}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pr-market">Market</Label>
                    <Input
                      id="pr-market"
                      placeholder="IN"
                      maxLength={2}
                      value={probe.market}
                      onChange={(e) => setProbe((p) => ({ ...p, market: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pr-currency">Currency</Label>
                    <Input
                      id="pr-currency"
                      placeholder="USD"
                      maxLength={3}
                      value={probe.currency}
                      onChange={(e) => setProbe((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pr-interval">Interval</Label>
                    <select
                      id="pr-interval"
                      value={probe.interval}
                      onChange={(e) => setProbe((p) => ({ ...p, interval: e.target.value }))}
                      className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs outline-none focus:border-primary"
                    >
                      {BILLING_INTERVALS.map((i) => (
                        <option key={i.code} value={i.code}>{i.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pr-channel">Channel</Label>
                    <select
                      id="pr-channel"
                      value={probe.channel}
                      onChange={(e) => setProbe((p) => ({ ...p, channel: e.target.value }))}
                      className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs outline-none focus:border-primary"
                    >
                      {BILLING_CHANNELS.map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Button size="sm" variant="outline" onClick={runProbe} disabled={probing || !probe.market}>
                    {probing && <Loader2 className="size-4 animate-spin" />}
                    Resolve
                  </Button>
                </div>

                {probeResult?.ok && (
                  <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                    <BadgeCheck className="size-4 shrink-0" />
                    <div className="text-xs">
                      Checkout would charge{' '}
                      <strong>{formatMinor(probeResult.entry.amountMinor, probeResult.entry.currency)}</strong>{' '}
                      per {probeResult.entry.interval.toLowerCase()} — catalog version{' '}
                      {probeResult.entry.catalogVersion}, approval {probeResult.entry.approvalReference}.
                    </div>
                  </div>
                )}
                {probeResult && !probeResult.ok && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-warning">
                    <AlertTriangle className="size-4 shrink-0" />
                    <div className="text-xs text-foreground/90">
                      <strong>Fails closed — no charge possible.</strong> {probeResult.message}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* --- Offers ------------------------------------------------------- */}
        <TabsContent value="offers">
          <Card>
            <CardHeader>
              <CardTitle>Commercial taxonomy</CardTitle>
              <CardDescription>
                The billing unit for Intelligence Pro is the verified paid pharmacy location — not a
                staff user, patient search, confirmation request, or dispensing outcome.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="flex flex-col gap-4">
                {COMMERCIAL_OFFERS.map((o) => (
                  <div key={o.code} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{o.label}</span>
                      <Badge variant={o.variant} size="sm">{o.status}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <span>Role: {o.role}</span>
                      <span>Metric: {o.metric}</span>
                      <span>Launch: {o.launchPrice}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-foreground/80">{o.statusNote}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Billing access ---------------------------------------------- */}
        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Billing access matrix</CardTitle>
              <CardDescription>
                Separation of duties: verification authority, availability editing and billing
                authority are separate permissions. Whoever can approve a pharmacy or edit inventory
                must not also change pricing or issue refunds. Grants are managed per user in Users
                &amp; Roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Plan / usage</TableHead>
                      <TableHead>Payment methods</TableHead>
                      <TableHead>Change plan</TableHead>
                      <TableHead>Cancel</TableHead>
                      <TableHead>Refund / credit</TableHead>
                      <TableHead>Discounts</TableHead>
                      <TableHead>Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BILLING_RBAC_MATRIX.map((r) => (
                      <TableRow key={r.role}>
                        <TableCell className="text-xs font-medium">{r.role}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.viewPlanUsage}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.paymentMethods}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.changePlan}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.cancel}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.refund}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.discounts}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.invoices}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Policy ------------------------------------------------------ */}
        <TabsContent value="policy">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Non-payment timeline</CardTitle>
                <CardDescription>
                  Self-serve Pro only. Enterprise follows its Order Form cure terms.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 pt-5">
                {DELINQUENCY_TIMELINE.map((s, i) => (
                  <div
                    key={s.day}
                    className={
                      'flex gap-3 py-3 ' +
                      (i < DELINQUENCY_TIMELINE.length - 1 ? 'border-b border-border' : '')
                    }
                  >
                    <span className="w-16 shrink-0 text-xs font-semibold text-foreground">{s.day}</span>
                    <span className="text-xs text-muted-foreground">{s.action}</span>
                  </div>
                ))}
                <p className="mt-3 text-xs leading-relaxed text-info">
                  A verified pharmacy is never removed from the free availability network because a
                  paid-intelligence payment failed.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Monetization boundaries</CardTitle>
                <CardDescription>Enforced server-side, not by convention.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <ul className="flex flex-col gap-2.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Paid standing never affects organic medicine-search ranking or availability
                    confidence. No sponsored placement in availability results.
                  </li>
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    No per-search, per-lead, per-confirmation or dispensing-commission charge.
                  </li>
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Exact stock is never publicly exposed, and no paid tier can unlock it.
                  </li>
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Failed syncs, platform errors, duplicate retries and denied requests are never
                    billable usage.
                  </li>
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Usage notifications fire at {USAGE_THRESHOLDS.join('%, ')}% of an allowance; there
                    is no silent overage.
                  </li>
                  <li className="flex gap-2">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Patient-level search behaviour is never sold. Enterprise intelligence is
                    aggregated, anonymized and thresholded.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add price dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add an approved price</DialogTitle>
            <DialogDescription>
              Requires a traceable approval reference. Pricing is a governed commercial decision —
              a published range is never an executable price.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitPrice} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-offer">Offer</Label>
              <select
                id="f-offer"
                value={form.offer}
                onChange={(e) => set('offer')(e.target.value)}
                className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {COMMERCIAL_OFFERS.filter(
                  (o) => o.code !== 'PATIENT_CAREGIVER_ACCESS' && o.code !== 'PHARMACY_NETWORK_CORE',
                ).map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">
                Free offers are not listed: charging one requires a new approved commercial program,
                not a catalog entry.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-market">Market (ISO-2)</Label>
                <Input id="f-market" maxLength={2} placeholder="IN" value={form.market}
                  onChange={(e) => set('market')(e.target.value.toUpperCase())} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-currency">Currency (ISO-3)</Label>
                <Input id="f-currency" maxLength={3} placeholder="USD" value={form.currency}
                  onChange={(e) => set('currency')(e.target.value.toUpperCase())} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-amount">Approved amount</Label>
                <Input id="f-amount" inputMode="decimal" placeholder="199.00" value={form.amountMajor}
                  onChange={(e) => set('amountMajor')(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-interval">Interval</Label>
                <select id="f-interval" value={form.interval}
                  onChange={(e) => set('interval')(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary">
                  {BILLING_INTERVALS.map((i) => (
                    <option key={i.code} value={i.code}>{i.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-channel">Channel</Label>
                <select id="f-channel" value={form.channel}
                  onChange={(e) => set('channel')(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary">
                  {BILLING_CHANNELS.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-effective">Effective from</Label>
                <Input id="f-effective" type="date" value={form.effectiveFrom}
                  onChange={(e) => set('effectiveFrom')(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-version">Catalog version</Label>
              <Input id="f-version" placeholder="2026-08-launch" value={form.catalogVersion}
                onChange={(e) => set('catalogVersion')(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-approval">Approval reference</Label>
              <Input id="f-approval" placeholder="ZM-PRICE-APPROVAL-2026-08-01"
                value={form.approvalReference}
                onChange={(e) => set('approvalReference')(e.target.value)} />
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {formError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Add price
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
