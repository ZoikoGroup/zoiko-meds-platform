import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CommercialClassification, PriceCatalogEntry, ProviderMode } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { isBillableClassification } from '../commercial.doctrine';
import { StripeConfig } from './stripe.config';

/**
 * The Stripe API version this integration targets.
 *
 * Exported so the webhook endpoint configuration and any operational runbook can
 * reference one value rather than three copies drifting apart. It must match the
 * version the installed `stripe` package is generated against.
 */
export const STRIPE_API_VERSION = '2026-07-29.dahlia' as const;

/**
 * Stripe adapter (ZM-COM-BILL-001 S-N1, S-P1, S-Q4).
 *
 * The only place the Stripe SDK is touched. Two rules are enforced here rather
 * than trusted to callers:
 *
 *  - Nothing reaches Stripe unless charging is authorised, so a live key without
 *    Finance sign-off cannot move money.
 *  - A live price is reachable only from a genuinely commercial classification.
 *    Internal, demo, QA, staging, sandbox and pilot records can never touch a live
 *    Price ID, which is what keeps test traffic out of real customer funds.
 *
 * Every provider identifier is persisted so the internal ledger can be reconciled
 * against Stripe during a dispute.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  constructor(
    private readonly config: StripeConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /** Lazily constructed so the app boots fine with billing unconfigured. */
  private stripe(): Stripe {
    const blocked = this.config.chargingBlockedReason();
    if (blocked) throw new ServiceUnavailableException(blocked);

    if (!this.client) {
      this.client = new Stripe(this.config.secretKey as string, {
        // Pinned deliberately: an implicit version bump could change webhook
        // payload shapes and silently break reconciliation.
        //
        // This must stay equal to the version the installed SDK is generated
        // against — its TypeScript types describe that version's shapes, so
        // requesting a different one makes the types lie about the responses. No
        // cast here on purpose: if an SDK upgrade moves the version, this becomes
        // a compile error instead of a silent runtime mismatch. Keep the webhook
        // endpoint in the Stripe dashboard on this same version.
        apiVersion: STRIPE_API_VERSION,
        typescript: true,
        maxNetworkRetries: 2,
      });
    }
    return this.client;
  }

  get mode(): ProviderMode {
    return this.config.mode;
  }

  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  /** Why charging is not possible, or null when it is. Delegates to the gate. */
  chargingBlockedReason(): string | null {
    return this.config.chargingBlockedReason();
  }

  get canCharge(): boolean {
    return this.config.canCharge;
  }

  /** Operator-facing provider status, for the admin console. */
  status(): {
    configured: boolean;
    mode: ProviderMode | null;
    canCharge: boolean;
    blockedReason: string | null;
    liveModeAuthorized: boolean;
  } {
    return {
      configured: this.config.isConfigured,
      mode: this.config.isConfigured ? this.config.mode : null,
      canCharge: this.config.canCharge,
      blockedReason: this.config.chargingBlockedReason(),
      liveModeAuthorized: this.config.liveModeAuthorized,
    };
  }

  /**
   * Guard for using a catalog price against a specific pharmacy. Called before any
   * subscription write so a non-production entity cannot reference a live price.
   */
  assertPriceUsableFor(
    price: Pick<PriceCatalogEntry, 'providerPriceId'>,
    classification: CommercialClassification,
  ): void {
    if (!price.providerPriceId) {
      throw new ForbiddenException(
        'This catalog price has no provider Price ID, so it cannot be charged. Add one before enabling the market.',
      );
    }
    const live = price.providerPriceId.startsWith('price_') && this.mode === ProviderMode.LIVE;
    if (live && !isBillableClassification(classification)) {
      throw new ForbiddenException(
        `Classification ${classification} may never reference a live Price ID. Use a test-mode ` +
          'fixture for internal, demo, QA, staging, sandbox or pilot entities.',
      );
    }
  }

  /**
   * Create or reuse the provider customer for a billing profile.
   *
   * Idempotent by billing profile id: a retry returns the stored customer instead
   * of creating a duplicate, which would fragment a customer's invoice history.
   */
  async ensureCustomer(billingProfileId: string): Promise<string> {
    const profile = await this.prisma.billingProfile.findUnique({
      where: { id: billingProfileId },
    });
    if (!profile) throw new ForbiddenException('Billing profile not found');
    if (profile.providerCustomerId) return profile.providerCustomerId;

    const customer = await this.stripe().customers.create(
      {
        name: profile.legalName,
        email: profile.billingEmail,
        address: profile.country
          ? {
              line1: profile.addressLine1 ?? undefined,
              line2: profile.addressLine2 ?? undefined,
              city: profile.city ?? undefined,
              state: profile.region ?? undefined,
              postal_code: profile.postalCode ?? undefined,
              country: profile.country,
            }
          : undefined,
        // Metadata carries only organizational identifiers. No patient, medicine
        // or search data ever leaves the platform on a billing object (S-N2, S-A4).
        metadata: { billingProfileId: profile.id, platform: 'zoikomeds' },
      },
      { idempotencyKey: `customer:${profile.id}` },
    );

    await this.prisma.billingProfile.update({
      where: { id: profile.id },
      data: { providerCustomerId: customer.id },
    });
    await this.audit.write(null, 'commercial.stripe.customer_created', 'BillingProfile', profile.id, {
      providerCustomerId: customer.id,
      mode: this.mode,
    });

    return customer.id;
  }

  /**
   * Create the provider subscription for an already-activated internal
   * subscription. Quantity is the verified paid location count (S-C1).
   */
  async createSubscription(input: {
    subscriptionId: string;
    billingProfileId: string;
    providerPriceId: string;
    quantity: number;
    classification: CommercialClassification;
    /** Payment terms when the subscription is invoiced rather than auto-charged. */
    daysUntilDue?: number;
  }): Promise<string> {
    this.assertPriceUsableFor({ providerPriceId: input.providerPriceId }, input.classification);

    const customerId = await this.ensureCustomer(input.billingProfileId);

    // Collection method follows what the customer actually has on file.
    //
    // S-N1 specifies Stripe Billing/Invoicing, and a pharmacy organization is a
    // business customer: with no stored card, `charge_automatically` fails outright
    // ("no attached payment source"), so the subscription is invoiced with payment
    // terms instead. Once a payment method exists it is charged automatically.
    const customer = await this.stripe().customers.retrieve(customerId);
    const hasPaymentMethod =
      typeof customer !== 'string' &&
      !customer.deleted &&
      !!(customer.invoice_settings?.default_payment_method || customer.default_source);

    const sub = await this.stripe().subscriptions.create(
      {
        customer: customerId,
        items: [{ price: input.providerPriceId, quantity: Math.max(1, input.quantity) }],
        // Proration is handled on quantity change; see updateQuantity.
        proration_behavior: 'create_prorations',
        ...(hasPaymentMethod
          ? { collection_method: 'charge_automatically' as const }
          : {
              collection_method: 'send_invoice' as const,
              days_until_due: input.daysUntilDue ?? 30,
            }),
        metadata: {
          subscriptionId: input.subscriptionId,
          billingProfileId: input.billingProfileId,
        },
      },
      { idempotencyKey: `subscription:${input.subscriptionId}` },
    );

    await this.prisma.subscription.update({
      where: { id: input.subscriptionId },
      data: { providerSubscriptionId: sub.id },
    });
    await this.audit.write(null, 'commercial.stripe.subscription_created', 'Subscription', input.subscriptionId, {
      providerSubscriptionId: sub.id,
      quantity: input.quantity,
      collectionMethod: sub.collection_method,
      mode: this.mode,
    });

    return sub.id;
  }

  /**
   * Change the billed location count. Additions prorate to the renewal anchor;
   * reductions do not refund mid-term, matching S-C2 and S-C3.
   */
  async updateQuantity(subscriptionId: string, quantity: number): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { providerSubscriptionId: true },
    });
    if (!sub?.providerSubscriptionId) return;

    const remote = await this.stripe().subscriptions.retrieve(sub.providerSubscriptionId);
    const item = remote.items.data[0];
    if (!item) return;

    await this.stripe().subscriptions.update(sub.providerSubscriptionId, {
      items: [{ id: item.id, quantity: Math.max(1, quantity) }],
      proration_behavior: 'create_prorations',
    });

    await this.audit.write(null, 'commercial.stripe.quantity_updated', 'Subscription', subscriptionId, {
      quantity,
      mode: this.mode,
    });
  }

  /** Cancel at period end by default — cancelling immediately would forfeit paid time. */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { providerSubscriptionId: true },
    });
    if (!sub?.providerSubscriptionId) return;

    if (immediately) {
      await this.stripe().subscriptions.cancel(sub.providerSubscriptionId);
    } else {
      await this.stripe().subscriptions.update(sub.providerSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    await this.audit.write(null, 'commercial.stripe.subscription_canceled', 'Subscription', subscriptionId, {
      immediately,
      mode: this.mode,
    });
  }

  /**
   * Issue a refund. Deliberately requires an approver and a reference: S-N3 and
   * S-N4 put refund authority with Billing Operations/Finance, not engineering.
   */
  async refund(input: {
    providerPaymentIntentId: string;
    amountMinor?: number;
    approvedByUserId: string;
    approvalReference: string;
  }): Promise<string> {
    if (!input.approvalReference?.trim()) {
      throw new ForbiddenException(
        'A refund requires an approval reference. Financial adjustments are a Finance decision, not an engineering action.',
      );
    }

    const refund = await this.stripe().refunds.create(
      {
        payment_intent: input.providerPaymentIntentId,
        amount: input.amountMinor,
        metadata: {
          approvedByUserId: input.approvedByUserId,
          approvalReference: input.approvalReference.trim(),
        },
      },
      // Keyed on the approval so a double submit cannot double-refund.
      { idempotencyKey: `refund:${input.approvalReference.trim()}` },
    );

    await this.audit.write(
      input.approvedByUserId,
      'commercial.stripe.refund',
      'Invoice',
      input.providerPaymentIntentId,
      {
        providerRefundId: refund.id,
        amountMinor: input.amountMinor ?? null,
        approvalReference: input.approvalReference,
        mode: this.mode,
      },
    );

    return refund.id;
  }

  /**
   * Start a provider-hosted checkout for a subscription.
   *
   * Hosted deliberately: card details never reach this application, which keeps it
   * out of PCI scope entirely, and S-O2 requires purchasing to run through the
   * web/contract channel rather than in-app. Returns the URL to redirect to.
   *
   * The internal subscription is NOT created here. It is created when the provider
   * confirms payment, so an abandoned checkout leaves no paid entitlement behind.
   */
  async createCheckoutSession(input: {
    billingProfileId: string;
    providerPriceId: string;
    quantity: number;
    classification: CommercialClassification;
    pharmacyId: string;
    /**
     * Catalog record the price came from. Carried through the session so the
     * webhook can bind the resulting subscription back to the approved price —
     * without it the pharmacy cannot be shown what it pays, and an invoice cannot
     * stamp the catalog version it was derived from.
     */
    priceCatalogEntryId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    this.assertPriceUsableFor({ providerPriceId: input.providerPriceId }, input.classification);

    const customerId = await this.ensureCustomer(input.billingProfileId);

    const session = await this.stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: input.providerPriceId, quantity: Math.max(1, input.quantity) }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Carried through to the subscription so the webhook can reconcile the
      // provider record back to the pharmacy that bought it.
      subscription_data: {
        metadata: {
          billingProfileId: input.billingProfileId,
          pharmacyId: input.pharmacyId,
          priceCatalogEntryId: input.priceCatalogEntryId,
        },
      },
      metadata: {
        billingProfileId: input.billingProfileId,
        pharmacyId: input.pharmacyId,
        priceCatalogEntryId: input.priceCatalogEntryId,
      },
    });

    if (!session.url) {
      throw new ServiceUnavailableException('The payment provider did not return a checkout URL.');
    }

    await this.audit.write(null, 'commercial.stripe.checkout_started', 'BillingProfile', input.billingProfileId, {
      sessionId: session.id,
      pharmacyId: input.pharmacyId,
      mode: this.mode,
    });

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Provider-hosted billing portal: manage payment method, view invoices, download
   * receipts. Also hosted, for the same reason as checkout.
   */
  async createBillingPortalSession(input: {
    billingProfileId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const profile = await this.prisma.billingProfile.findUnique({
      where: { id: input.billingProfileId },
      select: { providerCustomerId: true },
    });
    if (!profile?.providerCustomerId) {
      throw new ForbiddenException(
        'This organization has no payment provider customer yet. It appears once a plan is purchased.',
      );
    }

    const session = await this.stripe().billingPortal.sessions.create({
      customer: profile.providerCustomerId,
      return_url: input.returnUrl,
    });

    return { url: session.url };
  }

  /** Fetch the hosted payment page for a provider invoice, if it has one. */
  async hostedInvoiceUrl(providerInvoiceId: string): Promise<string | null> {
    const inv = await this.stripe().invoices.retrieve(providerInvoiceId);
    return inv.hosted_invoice_url ?? null;
  }

  /** Verify a webhook signature. Returns the parsed event or throws. */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    const secret = this.config.webhookSecret;
    if (!secret) {
      throw new ForbiddenException(
        'Webhook rejected: STRIPE_WEBHOOK_SECRET is not configured, so authenticity cannot be verified.',
      );
    }
    // Throws on a bad signature — an unverified payload is never trusted, since
    // acting on a forged event could create or cancel a real charge.
    return this.stripe().webhooks.constructEvent(rawBody, signature, secret);
  }
}
