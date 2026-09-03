import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorState } from '@/components/shared/states'
import { PharmacyOnboardingState } from '@/components/shared/pharmacy-onboarding-state'
import {
  confirmBillingCheckout,
  getBilling,
  openBillingPortal,
  startBillingCheckout,
} from '@/services/pharmacy-api'
import { CLASSIFICATION_META, DELINQUENCY_TIMELINE, formatMinor } from '@/lib/commercial'
import { CreditCard, ExternalLink, FileText, Info, Loader2, ShieldCheck } from 'lucide-react'

const STATE_META = {
  EVALUATION: { variant: 'info', label: 'Evaluation' },
  ACTIVE: { variant: 'success', label: 'Active' },
  PAST_DUE: { variant: 'warning', label: 'Payment failed' },
  EXPANSION_BLOCKED: { variant: 'warning', label: 'Expansion blocked' },
  PAID_FEATURES_RESTRICTED: { variant: 'warning', label: 'Paid features restricted' },
  CANCELED: { variant: 'secondary', label: 'Canceled' },
  ELIGIBILITY_RESTRICTED: { variant: 'danger', label: 'Restricted — verification lapsed' },
}

const INVOICE_META = {
  DRAFT: { variant: 'secondary', label: 'Draft' },
  OPEN: { variant: 'warning', label: 'Open' },
  PAID: { variant: 'success', label: 'Paid' },
  UNCOLLECTIBLE: { variant: 'danger', label: 'Uncollectible' },
  VOID: { variant: 'secondary', label: 'Void' },
  REFUNDED: { variant: 'info', label: 'Refunded' },
  PARTIALLY_REFUNDED: { variant: 'info', label: 'Partially refunded' },
}

/**
 * Pharmacy-facing billing view (ZM-COM-BILL-001 S-22).
 *
 * Read-only by design. Purchasing runs through an authorized payer, and the
 * portal is not a billing surface: there is no payment method, no checkout and no
 * plan change here.
 *
 * Financial detail is scoped server-side — `canSeeFinancialDetail` reflects what
 * the API actually sent, so a Pharmacist simply receives no amounts rather than
 * receiving them and relying on this component to hide them.
 */
/**
 * How many times the page asks whether the payment has landed, and how long it
 * waits between asks (MP-52).
 *
 * The confirm call reconciles the session directly, so the first attempt
 * normally settles it. The retries are for a payment method that settles
 * asynchronously, where the provider itself does not know yet. Twelve attempts
 * five seconds apart is a minute of watching, after which the page says plainly
 * that it is still waiting rather than spinning forever.
 */
const CONFIRM_ATTEMPTS = 12
const CONFIRM_INTERVAL_MS = 5000

export default function PharmacyBilling() {
  // Populated by the hosted checkout redirect.
  const search = new URLSearchParams(window.location.search)
  const checkoutOutcome = search.get('checkout')
  const checkoutSessionId = search.get('session_id')

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  /**
   * Where the return-from-checkout confirmation has got to.
   *
   * 'confirming' while the page is asking, 'active' once the plan is, 'waiting'
   * once it has asked as many times as it is going to. The page used to promise
   * it "updates automatically" while doing nothing of the kind — it read the
   * billing record once on mount and then only on window focus, so a webhook
   * that arrived a second later, or never, left the message standing over an
   * inactive plan indefinitely.
   */
  const [confirmState, setConfirmState] = useState(null)

  // Both actions hand off to a provider-hosted page. Navigating away is the point:
  // card entry happens on the provider's domain, never here.
  const goToProvider = async (kind) => {
    setBusy(kind)
    setActionError('')
    try {
      const res = kind === 'checkout' ? await startBillingCheckout() : await openBillingPortal()
      if (!res?.url) throw new Error('The payment provider did not return a URL.')
      window.location.assign(res.url)
    } catch (err) {
      setActionError(err.message || 'Could not open the payment provider.')
      setBusy('')
    }
  }

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await getBilling())
    } catch (err) {
      setError(err.message || 'Could not load your billing details.')
    }
  }, [])

  useEffect(() => {
    load()
    const sync = () => load()
    window.addEventListener('pharmacy-status-updated', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('pharmacy-status-updated', sync)
      window.removeEventListener('focus', sync)
    }
  }, [load])

  /**
   * Confirm the payment this page was redirected back from.
   *
   * The platform used to learn about a completed checkout from the provider's
   * webhook alone. When that webhook was misconfigured, unreachable, or merely
   * slower than the browser, the pharmacy was left on an inactive plan with
   * nothing recorded anywhere — not on this page and not for an administrator
   * either, because no subscription had been created to see.
   *
   * So the pharmacy confirms its own session. The server reads it back from the
   * provider and runs the same reconciliation the webhook runs, idempotently:
   * whichever route arrives first activates the plan and the other finds the
   * work already done.
   */
  useEffect(() => {
    if (checkoutOutcome !== 'success' || !checkoutSessionId) return

    let alive = true
    let attempt = 0
    let timer = null
    setConfirmState('confirming')

    const ask = async () => {
      attempt += 1
      try {
        const result = await confirmBillingCheckout(checkoutSessionId)
        if (!alive) return
        if (result?.status === 'active') {
          setConfirmState('active')
          await load()
          return
        }
      } catch {
        // A refusal here is not worth showing: the webhook may still land, and
        // the honest thing to report is that the answer has not arrived, which
        // is what the 'waiting' state below says.
        if (!alive) return
      }

      if (attempt >= CONFIRM_ATTEMPTS) {
        setConfirmState('waiting')
        return
      }
      timer = setTimeout(ask, CONFIRM_INTERVAL_MS)
    }

    ask()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [checkoutOutcome, checkoutSessionId, load])

  if (error) {
    return (
      <ErrorState
        title="Could not load billing"
        description={error}
        onRetry={load}
        className="max-w-4xl"
      />
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading billing…
      </div>
    )
  }

  if (!data.linked) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing" subtitle="Your plan and participation in the ZoikoMeds network." />
        <PharmacyOnboardingState
          description="Once your pharmacy is set up and verified, your plan and any billing history appear here."
          className="max-w-4xl"
        />
      </div>
    )
  }

  const plan = CLASSIFICATION_META[data.classification]
  const state = data.plan ? STATE_META[data.plan.state] : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        subtitle="Your plan and participation in the ZoikoMeds network."
      />

      {/* Returned from the hosted checkout. Success is not asserted until the
          provider has confirmed the payment — this reports which of those has
          happened, rather than one standing message that outlived both. */}
      {checkoutOutcome === 'success' && confirmState !== 'waiting' && (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success max-w-4xl">
          {confirmState === 'confirming' ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="text-foreground/90">
            {confirmState === 'active'
              ? 'Payment confirmed. Your plan is active.'
              : 'Payment submitted. Confirming it with the payment provider…'}
          </span>
        </div>
      )}

      {/* Asked as many times as it is going to and still no confirmation. Said
          plainly, with something to do about it: a pharmacy that has been
          charged must not be left reading "activates automatically" over a plan
          that never activated. */}
      {checkoutOutcome === 'success' && confirmState === 'waiting' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium max-w-4xl">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span className="text-foreground/90">
            Your payment was submitted, but the payment provider has not confirmed it yet. If you
            have been charged and your plan is still not active in a few minutes, contact
            ZoikoMeds support with your payment reference — nothing further is needed from you
            here.
          </span>
        </div>
      )}
      {checkoutOutcome === 'cancelled' && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground max-w-4xl">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Checkout was cancelled. Nothing has been charged.
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger max-w-4xl">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {actionError}
        </div>
      )}

      <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Plan */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" /> Plan
            </CardTitle>
            <CardDescription>{data.pharmacyName}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              {plan && <Badge variant={plan.variant}>{plan.label}</Badge>}
              {state && <Badge variant={state.variant} size="sm">{state.label}</Badge>}
            </div>

            {data.plan ? (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Paid locations</dt>
                  <dd className="font-medium tabular">{data.plan.quantity}</dd>
                </div>
                {/* Amounts appear only when the API sent them for this role. */}
                {data.plan.amountMinor !== undefined && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="font-medium tabular">
                      {formatMinor(data.plan.amountMinor, data.plan.currency)}
                      <span className="text-xs text-muted-foreground">
                        {' '}/ location / {String(data.plan.interval || '').toLowerCase()}
                      </span>
                    </dd>
                  </div>
                )}
                {data.plan.currentPeriodEnd && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Renews</dt>
                    <dd className="font-medium">
                      {new Date(data.plan.currentPeriodEnd).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {data.plan.evaluationEndsAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Evaluation ends</dt>
                    <dd className="font-medium">
                      {new Date(data.plan.evaluationEndsAt).toLocaleDateString()}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                You are on free Network Core participation. There is nothing to pay, and your
                pharmacy appears in patient search on the same terms as any other verified
                pharmacy.
              </p>
            )}

            {!data.canSeeFinancialDetail && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Amounts and invoices are visible to your Pharmacy Manager or Billing Admin.
              </p>
            )}

            {/* Purchase authority sits with the Pharmacy Manager, so a Pharmacist
                sees no actions at all rather than a disabled button. */}
            {data.canSeeFinancialDetail && (
              <div className="flex flex-col gap-2">
                {!data.plan && (
                  <Button
                    size="sm"
                    disabled={busy === 'checkout'}
                    onClick={() => goToProvider('checkout')}
                  >
                    {busy === 'checkout' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-3.5" />
                    )}
                    Upgrade to Intelligence Pro
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === 'portal'}
                  onClick={() => goToProvider('portal')}
                >
                  {busy === 'portal' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-3.5" />
                  )}
                  Manage payment method
                </Button>
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  Payment is handled on the provider&apos;s secure page. Card details never reach
                  ZoikoMeds.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Billing documents never show medicine names, prescriptions or patient details.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {!data.canSeeFinancialDetail ? (
              <EmptyState
                icon={ShieldCheck}
                title="Not available for your role"
                description="Invoice detail is restricted to the Pharmacy Manager or Billing Admin."
              />
            ) : data.invoices.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No invoices"
                description="Nothing has been billed to your pharmacy."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices.map((inv) => {
                      const meta = INVOICE_META[inv.status] ?? { variant: 'secondary', label: inv.status }
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(inv.periodStart).toLocaleDateString()} –{' '}
                            {new Date(inv.periodEnd).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular">
                            {formatMinor(inv.totalMinor, inv.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
                              {/* An unpaid invoice needs somewhere to go, not just a status. */}
                              {inv.hostedInvoiceUrl && inv.status !== 'PAID' && (
                                <a
                                  href={inv.hostedInvoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                                >
                                  Pay
                                </a>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Only worth showing when a payment can actually fail. */}
      {data.plan && data.plan.state !== 'EVALUATION' && (
        <Card className="max-w-5xl">
          <CardHeader>
            <CardTitle>If a payment fails</CardTitle>
            <CardDescription>
              Your pharmacy is never removed from the free availability network because of a
              payment problem.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-4">
            {DELINQUENCY_TIMELINE.map((s, i) => (
              <div
                key={s.day}
                className={
                  'flex gap-3 py-2.5 ' +
                  (i < DELINQUENCY_TIMELINE.length - 1 ? 'border-b border-border' : '')
                }
              >
                <span className="w-16 shrink-0 text-xs font-semibold text-foreground">{s.day}</span>
                <span className="text-xs text-muted-foreground">{s.action}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
