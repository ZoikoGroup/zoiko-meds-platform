import { Injectable, Logger } from '@nestjs/common';
import {
  BillingChannel,
  CommercialClassification,
  CommercialOffer,
  InvoiceStatus,
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
    const local = await this.findLocalInvoice(inv.id);

    if (local) {
      await this.prisma.invoice.update({
        where: { id: local.id },
        data: {
          status: InvoiceStatus.PAID,
          amountPaidMinor: inv.amount_paid ?? local.totalMinor,
          paidAt: new Date(),
          hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
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
    const local = await this.findLocalInvoice(inv.id);
    if (!local) return;

    await this.prisma.invoice.update({
      where: { id: local.id },
      data: {
        status: InvoiceStatus.OPEN,
        issuedAt: new Date(),
        // Captured here so an unpaid invoice is actionable in the portal instead
        // of a dead end. Stripe hosts the page; no card data reaches this app.
        hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
      },
    });
  }

  private async onInvoiceVoided(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const local = await this.findLocalInvoice(inv.id);
    if (!local) return;

    await this.prisma.invoice.update({
      where: { id: local.id },
      data: { status: InvoiceStatus.VOID, voidedAt: new Date() },
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

  /** Resolve the internal subscription for a provider invoice. */
  private async localSubscriptionId(inv: Stripe.Invoice): Promise<string | null> {
    const raw = (inv as unknown as { subscription?: string | { id: string } }).subscription;
    const providerSubscriptionId = typeof raw === 'string' ? raw : raw?.id;
    if (!providerSubscriptionId) return null;

    const sub = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId },
      select: { id: true },
    });
    return sub?.id ?? null;
  }
}
