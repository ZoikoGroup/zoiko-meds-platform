import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { CapabilityService } from './capability.service';
import { CommercialController } from './commercial.controller';
import { EntitlementService } from './entitlement.service';
import { PriceCatalogService } from './price-catalog.service';
import { SubscriptionService } from './subscription.service';
import { UsageMeteringService } from './usage-metering.service';

/**
 * Commercial module — ZM-COM-BILL-001.
 *
 * Deliberately contains no payment-provider integration. Live charging is gated on
 * the S-3 launch blockers, which are organizational rather than technical: an
 * approved market price catalog, a verified merchant/tax configuration and legal
 * entity reconciliation. Everything here is provider-agnostic, and the provider
 * identifier fields on the catalog and subscription models are the seam a Stripe
 * adapter plugs into once Finance signs those off.
 */
@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [CommercialController],
  providers: [
    PriceCatalogService,
    EntitlementService,
    SubscriptionService,
    UsageMeteringService,
    CapabilityService,
  ],
  exports: [
    PriceCatalogService,
    EntitlementService,
    SubscriptionService,
    UsageMeteringService,
    CapabilityService,
  ],
})
export class CommercialModule {}
