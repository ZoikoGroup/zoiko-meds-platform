import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { CapabilityService } from './capability.service';
import { CommercialController } from './commercial.controller';
import { BillingProfileService } from './billing-profile.service';
import { InvoiceService } from './invoice.service';
import { TaxService } from './tax.service';
import { StripeConfig } from './stripe/stripe.config';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookService } from './stripe/stripe-webhook.service';
import { StripeWebhookController } from './stripe/stripe-webhook.controller';
import { PharmacyCheckoutController } from './pharmacy-checkout.controller';
import { EntitlementService } from './entitlement.service';
import { PriceCatalogService } from './price-catalog.service';
import { SubscriptionService } from './subscription.service';
import { UsageMeteringService } from './usage-metering.service';

/**
 * Commercial module — ZM-COM-BILL-001.
 *
 * Stripe is the named provider for self-serve Pro. Live charging stays gated on the
 * S-3 launch blockers, which are organizational rather than technical: an approved
 * market price catalog, a verified merchant and tax configuration, and legal entity
 * reconciliation. StripeConfig enforces that gate — a live key alone cannot charge
 * anyone without BILLING_LIVE_MODE, so the integration can ship and be exercised in
 * test mode before Finance signs off.
 */
@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [CommercialController, StripeWebhookController, PharmacyCheckoutController],
  providers: [
    PriceCatalogService,
    TaxService,
    InvoiceService,
    BillingProfileService,
    StripeConfig,
    StripeService,
    StripeWebhookService,
    EntitlementService,
    SubscriptionService,
    UsageMeteringService,
    CapabilityService,
  ],
  exports: [
    PriceCatalogService,
    TaxService,
    InvoiceService,
    BillingProfileService,
    StripeConfig,
    StripeService,
    EntitlementService,
    SubscriptionService,
    UsageMeteringService,
    CapabilityService,
  ],
})
export class CommercialModule {}
