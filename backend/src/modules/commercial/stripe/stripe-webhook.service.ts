import { Injectable, Logger } from '@nestjs/common';
import {
  BillingChannel,
  CommercialClassification,
  CommercialOffer,
  type Invoice,
  InvoiceStatus,
  PaymentProvider,
  Prisma,
  ProviderEventStatus,
  SubscriptionState,
} from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { SubscriptionService } from '../subscription.service';
import { StripeConfig } from './stripe.config';

/** Event types acted on. Anything else is recorded and ignored, not guessed at. */
const HANDLED = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalized',
  'invoice.voided',
  'customer.subscription.deleted',
  'charge.refunded',
]);

/**
 * Statuses a late-arriving earlier event must not regress.
 *
 * Stripe does not guarantee delivery order, so `invoice.finalized` can land
 * after `invoice.paid`. Marking a paid invoice open again would be a worse
 * error than the missing row these handlers exist to create.
 */
const SETTLED_STATUSES = new Set<InvoiceStatus>([
  InvoiceStatus.PAID,
  InvoiceStatus.VOID,
  InvoiceStatus.REFUNDED,
  InvoiceStatus.PARTIALLY_REFUNDED,
]);

/**
 * The subscription that generated an invoice.
 *
 * Read from `parent.subscription_details`, never `invoice.subscription`: that
 * field was removed from the Invoice object in API version 2025-04-30 and this
 * integration is pinned well past it (STRIPE_API_VERSION). It was still being
 * read here through an `as unknown as` cast, which hid the removal from the
 * compiler — so it resolved to undefined on every delivery and silently
 * disabled both subscription-linked invoice handlers. Same class of fault as
 * the `charge.invoice` removal already documented in onChargeRefunded, so it
 * is typed against the SDK now rather than cast past it.
 */
function providerSubscriptionIdOf(inv: Stripe.Invoice): string | null {
  const raw = inv.parent?.subscription_details?.subscription;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : raw.id;
}

/**
 * Subscription metadata as it stood when the invoice was finalized.
 *
 * Checkout stamps billingProfileId and pharmacyId onto the subscription, and
 * Stripe snapshots that onto every invoice it generates — which is what lets an
 * invoice be attributed without a round trip.
 */
function subscriptionMetadataOf(inv: Stripe.Invoice): Record<string, string> {
  return (inv.parent?.subscription_details?.metadata ?? {}) as Record<string, string>;
}

/** Total tax on an invoice. `invoice.tax` was removed alongside `subscription`. */
function taxMinorOf(inv: Stripe.Invoice): number {
  return (inv.total_taxes ?? []).reduce((sum, tax) => sum + (tax.amount ?? 0), 0);
}

/** Total discount, in the same minor units as every other amount here. */
function discountMinorOf(inv: Stripe.Invoice): number {
  return (inv.total_discount_amounts ?? []).reduce(
    (sum, discount) => sum + (discount.amount ?? 0),
    0,
  );
}

/**
 * Payment intent behind an invoice, when the payload carries it.
 *
 * `invoice.payment_intent` was removed too; it now lives in the `payments`
 * sublist, which is expandable and so is often absent from a webhook body.
 * Best-effort on purpose: it feeds refund linkage only, and a missing value
 * leaves that no worse off than it already was.
 */
function paymentIntentIdOf(inv: Stripe.Invoice): string | null {
  for (const payment of inv.payments?.data ?? []) {
    const raw = payment.payment?.payment_intent;
    if (raw) return typeof raw === 'string' ? raw : raw.id;
  }
  return null;
}

/** Unix seconds to a Date, tolerating the nulls the provider uses for "not yet". */
function atSeconds(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * Webhook processing (ZM-COM-BILL-001 S-1, S-K2, S-N5).
 *
 * The executive doctrine states that nobody may be charged because of a duplicate
 * webhook, and S-N5 classes a duplicate charge as a P1 incident. That is enforced
 * structurally: every delivery is inserted against a unique provider event id
 * before any side effect runs, so a replay loses the insert race and is recorded as
 * DUPLICATE without being processed a second time.
 *
 * Processing is also fail-safe rather than fail-open — an event that throws is
 * marked FAILED with its reason and can be replayed deliberately, instead of being
 * silently dropped.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly subscriptions: SubscriptionService,
    private readonly config: StripeConfig,
  ) {}

  /**
   * Record then process. Returns what happened so the controller can answer 200
   * for anything already handled — Stripe retries non-2xx, and retrying a
   * duplicate forever would be noise.
   */
  async handle(event: Stripe.Event): Promise<{ status: ProviderEventStatus; detail?: string }> {
    // Claim the event id first. The unique constraint is the deduplication.
    try {
      await this.prisma.providerEvent.create({
        data: {
          providerEventId: event.id,
          eventType: event.type,
          mode: this.config.mode,
          status: ProviderEventStatus.RECEIVED,
          payload: event.data?.object as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already seen. Do not reprocess — this is the duplicate-charge guard.
        await this.prisma.providerEvent.updateMany({
          where: { providerEventId: event.id, status: ProviderEventStatus.RECEIVED },
          data: { status: ProviderEventStatus.DUPLICATE },
        });
        this.logger.warn(`Duplicate webhook ${event.id} (${event.type}) ignored.`);
        return { status: ProviderEventStatus.DUPLICATE };
      }
      throw err;
    }

    if (!HANDLED.has(event.type)) {
      await this.finish(event.id, ProviderEventStatus.IGNORED);
      return { status: ProviderEventStatus.IGNORED };
    }

    try {
      await this.dispatch(event);
      await this.finish(event.id, ProviderEventStatus.PROCESSED);
      return { status: ProviderEventStatus.PROCESSED };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.prisma.providerEvent.update({
        where: { providerEventId: event.id },
        data: {
          status: ProviderEventStatus.FAILED,
          failureReason: detail,
          processedAt: new Date(),
        },
      });
      this.logger.error(`Webhook ${event.id} (${event.type}) failed: ${detail}`);
      return { status: ProviderEventStatus.FAILED, detail };
    }
  }

  private async finish(providerEventId: string, status: ProviderEventStatus) {
    await this.prisma.providerEvent.update({
      where: { providerEventId },
      data: { status, processedAt: new Date() },
    });
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event);
      case 'invoice.paid':
        return this.onInvoicePaid(event);
      case 'invoice.payment_failed':
        return this.onPaymentFailed(event);
      case 'invoice.finalized':
        return this.onInvoiceFinalized(event);
      case 'invoice.voided':
        return this.onInvoiceVoided(event);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event);
      case 'charge.refunded':
        return this.onChargeRefunded(event);
      default:
        return;
    }
  }

  /**
   * A pharmacy completed provider-hosted checkout.
   *
   * This is where the internal subscription comes into existence: creating it when
   * checkout *starts* would grant paid entitlement to anyone who opened the payment
   * page and walked away. The provider confirming payment is the only trustworthy
   * signal.
   */
  private async onCheckoutCompleted(event: Stripe.Event): Promise<void> {
    await this.reconcileCheckoutSession(
      event.data.object as Stripe.Checkout.Session,
      'webhook',
    );
  }

  /**
   * Turn a paid checkout session into the internal subscription (MP-52).
   *
   * Public and separate from the event handler because the webhook is not the only
   * way this platform learns a payment succeeded, and it must not be the only way.
   * A webhook endpoint that is misconfigured, unreachable, or simply slower than
   * the browser redirect left the pharmacy looking at "your plan activates as soon
   * as the payment provider confirms it" over a plan that never activated, with
   * nothing recorded for an administrator to find either. The pharmacy returning
   * from checkout now reconciles its own session directly, and lands here.
   *
   * Idempotent on providerSubscriptionId, which is what makes it safe to run from
   * both routes: whichever arrives first creates the subscription, and the other
   * finds it and stops. `source` is recorded so an operator can tell which one did.
   */
  async reconcileCheckoutSession(
    session: Stripe.Checkout.Session,
    source: 'webhook' | 'return',
  ): Promise<{ reconciled: boolean; reason?: string }> {
    const rawSub = (session as unknown as { subscription?: string | { id: string } }).subscription;
    const providerSubscriptionId = typeof rawSub === 'string' ? rawSub : rawSub?.id;
    const billingProfileId = session.metadata?.billingProfileId;
    const pharmacyId = session.metadata?.pharmacyId;
    const priceCatalogEntryId = session.metadata?.priceCatalogEntryId ?? null;

    if (!providerSubscriptionId || !billingProfileId || !pharmacyId) {
      this.logger.warn(
        `checkout session ${session.id} (${source}) lacks subscription or metadata; nothing to reconcile.`,
      );
      return { reconciled: false, reason: 'incomplete' };
    }

    // Only a paid session becomes a subscription. The webhook only fires on
    // completion so this is normally moot, but the return route can be reached
    // with a session that is still processing — an asynchronous payment method,
    // or a browser that beat the provider to it.
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return { reconciled: false, reason: 'unpaid' };
    }

    const existing = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId },
      select: { id: true },
    });
    // Already reconciled, by whichever route got here first. Reported as done
    // rather than as nothing having happened: the plan is active, and the caller
    // is asking whether it is.
    if (existing) return { reconciled: true, reason: 'already' };

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          billingProfileId,
          offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
          state: SubscriptionState.ACTIVE,
          channel: BillingChannel.WEB_SELF_SERVE,
          quantity: 1,
          // Obligation starts at confirmed payment; nothing earlier is billable.
          commercialEffectiveAt: now,
          currentPeriodStart: now,
          providerSubscriptionId,
          // Binds the subscription to the approved price it was sold at, so the
          // amount is explainable and an invoice can stamp its catalog version.
          priceCatalogEntryId,
        },
      });

      await tx.subscriptionLocation.create({
        data: { subscriptionId: sub.id, pharmacyId },
      });

      await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { commercialClassification: CommercialClassification.PRO_ACTIVE },
      });

      return sub;
    });

    await this.audit.write(null, 'commercial.stripe.checkout_completed', 'Subscription', created.id, {
      providerSubscriptionId,
      pharmacyId,
      billingProfileId,
      sessionId: session.id,
      // Which route confirmed it. When this reads "return" repeatedly, webhook
      // delivery is broken and the redirect is carrying the whole flow.
      source,
    });

    return { reconciled: true };
  }

  private async onInvoicePaid(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    // Recorded here when it does not exist yet: for self-serve Pro this event,
    // not any internal step, is the first the platform hears of the invoice.
    const local = await this.ensureLocalInvoice(inv);

    if (local) {
      await this.prisma.invoice.update({
        where: { id: local.id },
        data: {
          status: InvoiceStatus.PAID,
          amountPaidMinor: inv.amount_paid ?? local.totalMinor,
          paidAt: atSeconds(inv.status_transitions?.paid_at) ?? new Date(),
          hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
          // Only ever set, never cleared: `payments` is expandable, so a payload
          // that omits it must not wipe a value an earlier delivery supplied.
          providerPaymentIntentId: paymentIntentIdOf(inv) ?? undefined,
        },
      });
    }

    // Payment success clears delinquency. Recomputed from the provider event
    // rather than assumed, so a late payment restores the account correctly.
    const subId = await this.localSubscriptionId(inv);
    if (subId) {
      await this.prisma.subscription.update({
        where: { id: subId },
        data: {
          state: SubscriptionState.ACTIVE,
          paymentFailedAt: null,
        },
      });
    }

    await this.audit.write(null, 'commercial.stripe.invoice_paid', 'Invoice', local?.id ?? inv.id, {
      providerInvoiceId: inv.id,
      amountPaidMinor: inv.amount_paid,
    });
  }

  private async onPaymentFailed(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const subId = await this.localSubscriptionId(inv);
    if (!subId) return;

    // Enters the S-L1 recovery timeline. Network Core participation is untouched:
    // a verified pharmacy is never evicted from the free network for non-payment.
    await this.subscriptions.recordPaymentFailure(null, subId);

    await this.audit.write(null, 'commercial.stripe.payment_failed', 'Subscription', subId, {
      providerInvoiceId: inv.id,
      networkCorePreserved: true,
    });
  }

  private async onInvoiceFinalized(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const local = await this.ensureLocalInvoice(inv);
    if (!local) return;

    // Nothing to open once something later has already settled it.
    if (SETTLED_STATUSES.has(local.status)) return;

    await this.prisma.invoice.update({
      where: { id: local.id },
      data: {
        status: InvoiceStatus.OPEN,
        issuedAt: local.issuedAt ?? this.issuedAtOf(inv),
        // Captured here so an unpaid invoice is actionable in the portal instead
        // of a dead end. Stripe hosts the page; no card data reaches this app.
        hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
      },
    });
  }

  private async onInvoiceVoided(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const local = await this.ensureLocalInvoice(inv);
    if (!local) return;

    await this.prisma.invoice.update({
      where: { id: local.id },
      data: {
        status: InvoiceStatus.VOID,
        voidedAt: atSeconds(inv.status_transitions?.voided_at) ?? new Date(),
      },
    });
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const local = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId: sub.id },
      include: { locations: { where: { releasedAt: null } } },
    });
    if (!local) return;

    // Downgrade, not removal: paid intelligence stops, free participation does not.
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: local.id },
        data: { state: SubscriptionState.CANCELED, canceledAt: new Date() },
      });
      for (const loc of local.locations) {
        const pharmacy = await tx.pharmacy.findUnique({
          where: { id: loc.pharmacyId },
          select: { verificationStatus: true },
        });
        await tx.pharmacy.update({
          where: { id: loc.pharmacyId },
          data: {
            commercialClassification:
              pharmacy?.verificationStatus === 'VERIFIED'
                ? 'VERIFIED_NETWORK_CORE'
                : 'VERIFICATION_IN_REVIEW',
          },
        });
      }
    });

    await this.audit.write(null, 'commercial.stripe.subscription_deleted', 'Subscription', local.id, {
      providerSubscriptionId: sub.id,
      downgradedToNetworkCore: true,
    });
  }

  private async onChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;

    // Resolve the invoice via payment_intent, not charge.invoice: the latter was
    // removed from the Charge object in this API version, so reading it would
    // always be undefined and every refund would silently fail to post.
    const rawIntent = charge.payment_intent;
    const paymentIntentId = typeof rawIntent === 'string' ? rawIntent : rawIntent?.id;
    if (!paymentIntentId) return;

    const local = await this.prisma.invoice.findFirst({
      where: { providerPaymentIntentId: paymentIntentId },
    });
    if (!local) return;

    const refunded = charge.amount_refunded ?? 0;
    await this.prisma.invoice.update({
      where: { id: local.id },
      data: {
        amountRefundedMinor: refunded,
        status:
          refunded >= local.totalMinor
            ? InvoiceStatus.REFUNDED
            : InvoiceStatus.PARTIALLY_REFUNDED,
      },
    });

    await this.audit.write(null, 'commercial.stripe.charge_refunded', 'Invoice', local.id, {
      amountRefundedMinor: refunded,
    });
  }

  private async findLocalInvoice(providerInvoiceId: string | null | undefined) {
    if (!providerInvoiceId) return null;
    return this.prisma.invoice.findFirst({ where: { providerInvoiceId } });
  }

  /**
   * The local invoice for a provider invoice, created from the provider's own
   * record when there is not one yet.
   *
   * Every handler above used to be an update over a row that some earlier
   * internal step was assumed to have drafted. That holds for an administrator
   * issuing an invoice through the commercial console, and does not hold at all
   * for self-serve Intelligence Pro, where Stripe originates the invoice and
   * nothing internal ever writes providerInvoiceId. So the lookup always missed,
   * every handler returned early, and a pharmacy that had genuinely paid saw an
   * empty invoice list for ever — with no row for an administrator to find
   * either. Recording the provider's invoice is what closes that.
   *
   * Returns null when the invoice cannot be attributed to a billing profile, or
   * when the supplier entity is unconfigured: both are columns an invoice may
   * not be missing, and a row that fails either is worse than no row at all.
   */
  private async ensureLocalInvoice(inv: Stripe.Invoice): Promise<Invoice | null> {
    const existing = await this.findLocalInvoice(inv.id);
    const subscriptionId = await this.localSubscriptionId(inv);

    if (existing) {
      // Backfill the subscription link when an invoice event beat the checkout
      // reconciliation that creates the subscription. Delivery order is not
      // guaranteed, and an invoice orphaned from its subscription cannot be
      // explained to the customer afterwards.
      if (!existing.subscriptionId && subscriptionId) {
        return this.prisma.invoice.update({
          where: { id: existing.id },
          data: { subscriptionId },
        });
      }
      return existing;
    }

    const profile = await this.resolveBillingProfile(inv);
    if (!profile) {
      this.logger.warn(
        `Provider invoice ${inv.id} cannot be attributed to a billing profile, so it was not ` +
          'recorded. Neither its subscription metadata nor its customer id matched one.',
      );
      return null;
    }

    const supplierLegalEntity = this.config.supplierLegalEntity;
    if (!supplierLegalEntity) {
      this.logger.error(
        `Provider invoice ${inv.id} cannot be recorded: BILLING_SUPPLIER_LEGAL_ENTITY is not set, ` +
          'so the verified supplier entity that must appear on the document is unknown.',
      );
      return null;
    }

    const periodStart = atSeconds(inv.period_start) ?? new Date();

    return this.prisma.invoice.create({
      data: {
        billingProfileId: profile.id,
        subscriptionId,
        // The provider's own number rather than one drawn from the internal ZM-
        // sequence. Stripe has already numbered this document and shown that
        // number to the pharmacy on its receipt; minting a second, different
        // number for the same invoice would leave the two disagreeing. Falling
        // back to the invoice id keeps the @unique column collision-free even if
        // a payload somehow arrives unnumbered.
        invoiceNumber: inv.number ?? inv.id,
        status: InvoiceStatus.OPEN,
        supplierLegalEntity,
        customerLegalName: profile.legalName,
        periodStart,
        periodEnd: atSeconds(inv.period_end) ?? periodStart,
        currency: (inv.currency ?? 'usd').toUpperCase(),
        subtotalMinor: inv.subtotal ?? 0,
        discountMinor: discountMinorOf(inv),
        taxMinor: taxMinorOf(inv),
        totalMinor: inv.total ?? 0,
        amountPaidMinor: inv.amount_paid ?? 0,
        provider: PaymentProvider.STRIPE,
        mode: this.config.mode,
        providerInvoiceId: inv.id,
        providerPaymentIntentId: paymentIntentIdOf(inv),
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        issuedAt: this.issuedAtOf(inv),
        // No tax determination attached on purpose. These amounts are the
        // provider's, computed by its tax engine, so pointing at an internally
        // resolved rate would misrepresent where they came from. S-M3 forbids a
        // hard-coded rate, not a provider-computed one, and the column is
        // nullable for exactly this case.
        taxDeterminationId: null,
      },
    });
  }

  /**
   * Date of issue, taken from the provider so it matches the document the
   * pharmacy actually receives. `effective_at` is what Stripe prints on the PDF
   * when set; otherwise the moment it was finalized, and failing both, created.
   */
  private issuedAtOf(inv: Stripe.Invoice): Date {
    return (
      atSeconds(inv.effective_at) ??
      atSeconds(inv.status_transitions?.finalized_at) ??
      atSeconds(inv.created) ??
      new Date()
    );
  }

  /**
   * The billing profile an invoice belongs to.
   *
   * Metadata first, because checkout stamps billingProfileId onto the
   * subscription and Stripe snapshots it onto every invoice that subscription
   * generates — the most direct answer available, and it needs no round trip.
   * The customer id is the fallback for anything raised outside that flow, such
   * as an invoice created by hand in the Stripe dashboard.
   */
  private async resolveBillingProfile(
    inv: Stripe.Invoice,
  ): Promise<{ id: string; legalName: string } | null> {
    const select = { id: true, legalName: true };

    const fromMetadata = subscriptionMetadataOf(inv).billingProfileId;
    if (fromMetadata) {
      const byId = await this.prisma.billingProfile.findUnique({
        where: { id: fromMetadata },
        select,
      });
      if (byId) return byId;
    }

    const rawCustomer = inv.customer;
    const providerCustomerId = typeof rawCustomer === 'string' ? rawCustomer : rawCustomer?.id;
    if (!providerCustomerId) return null;

    return this.prisma.billingProfile.findFirst({
      where: { providerCustomerId },
      select,
    });
  }

  /** Resolve the internal subscription for a provider invoice. */
  private async localSubscriptionId(inv: Stripe.Invoice): Promise<string | null> {
    const providerSubscriptionId = providerSubscriptionIdOf(inv);
    if (!providerSubscriptionId) return null;

    const sub = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId },
      select: { id: true },
    });
    return sub?.id ?? null;
  }
}
