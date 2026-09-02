import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BillingCapability,
  BillingChannel,
  BillingInterval,
  CommercialOffer,
  UserRole,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CapabilityService } from './capability.service';
import { EntitlementService } from './entitlement.service';
import { PriceCatalogService } from './price-catalog.service';
import { SubscriptionService } from './subscription.service';
import { UsageMeteringService } from './usage-metering.service';
import { BillingProfileService } from './billing-profile.service';
import { InvoiceService } from './invoice.service';
import { TaxService } from './tax.service';
import { StripeService } from './stripe/stripe.service';
import { CreatePriceEntryDto } from './dto/create-price-entry.dto';
import {
  CreateBillingProfileDto,
  DraftInvoiceDto,
  IssueCreditNoteDto,
  RecordTaxDeterminationDto,
  RefundDto,
} from './dto/commercial-billing.dto';
import { GrantCapabilityDto } from './dto/grant-capability.dto';
import { ActivateProDto } from './dto/activate-pro.dto';

/**
 * Commercial administration.
 *
 * Price catalog and capability management are SUPER_ADMIN-only at the route level,
 * and additionally capability-checked in the services, so delegating authority to
 * another role works without widening the route guard. There is deliberately no
 * public checkout endpoint yet: live charging is blocked until the S-3 launch
 * blockers close.
 */
@ApiTags('commercial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/commercial')
export class CommercialController {
  constructor(
    private readonly priceCatalog: PriceCatalogService,
    private readonly entitlements: EntitlementService,
    private readonly subscriptions: SubscriptionService,
    private readonly usage: UsageMeteringService,
    private readonly capabilities: CapabilityService,
    private readonly billingProfiles: BillingProfileService,
    private readonly tax: TaxService,
    private readonly invoices: InvoiceService,
    private readonly stripe: StripeService,
  ) {}

  // --- Payment provider status --------------------------------------------

  @Get('provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Payment provider status',
    description:
      'Whether a provider is configured, which mode it is in, and whether charging is authorised. A live key alone does not authorise charging.',
  })
  providerStatus() {
    return this.stripe.status();
  }

  // --- Billing profiles ----------------------------------------------------

  @Get('billing-profiles')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'List organizational billing identities' })
  async listBillingProfiles(@CurrentUser() user: AuthenticatedUser) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_PLAN_AND_USAGE);
    return this.billingProfiles.list();
  }

  @Get('billing-profiles/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get one billing profile with subscriptions and invoices' })
  async getBillingProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_PLAN_AND_USAGE, {
      billingProfileId: id,
    });
    return this.billingProfiles.get(id);
  }

  @Post('billing-profiles')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a billing identity for an organization',
    description: 'Billing identity is the legal organization, never a patient account.',
  })
  async createBillingProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBillingProfileDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN);
    return this.billingProfiles.create(user.id, dto);
  }

  // --- Tax -----------------------------------------------------------------

  @Post('tax-determinations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Record an approved tax determination',
    description:
      'The platform never assumes a rate. A determination must come from a tax engine or a manual Finance approval, and is stored with its inputs so the figure can be re-explained.',
  })
  async recordTax(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordTaxDeterminationDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN, {
      billingProfileId: dto.billingProfileId,
    });
    return this.tax.record(dto);
  }

  @Get('tax-determinations/:billingProfileId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Latest tax determination for a customer' })
  async latestTax(
    @CurrentUser() user: AuthenticatedUser,
    @Param('billingProfileId') billingProfileId: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_PLAN_AND_USAGE, {
      billingProfileId,
    });
    return this.tax.latestFor(billingProfileId);
  }

  // --- Invoices ------------------------------------------------------------

  @Get('invoices/:billingProfileId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Invoices for a customer' })
  async listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('billingProfileId') billingProfileId: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_INVOICES, {
      billingProfileId,
    });
    return this.invoices.listForProfile(billingProfileId);
  }

  @Post('invoices')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Draft an invoice',
    description: 'Refuses without a recorded tax determination rather than assuming zero tax.',
  })
  async draftInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DraftInvoiceDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_INVOICES, {
      billingProfileId: dto.billingProfileId,
    });
    return this.invoices.draft(user.id, {
      billingProfileId: dto.billingProfileId,
      subscriptionId: dto.subscriptionId,
      supplierLegalEntity: dto.supplierLegalEntity,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      currency: dto.currency,
      subtotalMinor: dto.subtotalMinor,
      discountMinor: dto.discountMinor,
      locationCount: dto.locationCount,
      catalogVersion: dto.catalogVersion,
      mode: this.stripe.mode,
    });
  }

  @Post('invoices/:id/credit-notes')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Issue a credit note against an invoice',
    description: 'Requires APPROVE_REFUND_OR_CREDIT and a traceable approval reference.',
  })
  async issueCreditNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') invoiceId: string,
    @Body() dto: IssueCreditNoteDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.APPROVE_REFUND_OR_CREDIT);
    return this.invoices.issueCreditNote(user.id, { invoiceId, ...dto });
  }

  // --- Refunds -------------------------------------------------------------

  @Post('refunds')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Refund a payment through the provider',
    description:
      'Requires APPROVE_REFUND_OR_CREDIT and an approval reference, which also keys idempotency so a double submit cannot double-refund.',
  })
  async refund(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefundDto) {
    await this.capabilities.require(user.id, BillingCapability.APPROVE_REFUND_OR_CREDIT);
    const providerRefundId = await this.stripe.refund({
      providerPaymentIntentId: dto.providerPaymentIntentId,
      amountMinor: dto.amountMinor,
      approvedByUserId: user.id,
      approvalReference: dto.approvalReference,
    });
    return { providerRefundId };
  }

  // --- Price catalog -------------------------------------------------------

  @Get('prices')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'List approved price catalog records' })
  listPrices(
    @Query('offer') offer?: CommercialOffer,
    @Query('market') market?: string,
    @Query('catalogVersion') catalogVersion?: string,
  ) {
    return this.priceCatalog.list({ offer, market, catalogVersion });
  }

  @Post('prices')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Add an approved price to the catalog',
    description:
      'Requires an approval reference. A published marketing range is never an executable price, ' +
      'so every chargeable amount must exist here first. When no provider price id is supplied, ' +
      'one is created at the payment provider from the approved amount, so the two cannot disagree.',
  })
  async createPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceEntryDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.MANAGE_PRICE_CATALOG);

    const input = {
      offer: dto.offer,
      market: dto.market,
      currency: dto.currency,
      interval: dto.interval,
      amountMinor: dto.amountMinor,
      channel: dto.channel,
      catalogVersion: dto.catalogVersion,
      approvalReference: dto.approvalReference,
      effectiveFrom: new Date(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      providerProductId: dto.providerProductId ?? null,
      providerPriceId: dto.providerPriceId ?? null,
      taxBehavior: dto.taxBehavior,
      legalTermsVersion: dto.legalTermsVersion,
    };

    // Validate before touching the provider. An entry the catalog would reject must
    // not leave a live price behind at Stripe with nothing pointing at it.
    this.priceCatalog.assertEntryValid(input);

    // A catalog record with no provider price id cannot be charged — checkout stops
    // at assertPriceUsableFor. Rather than accept an entry that is dead on arrival,
    // derive the provider price from the amount that was just approved. An operator
    // who created it at the provider themselves supplies the id and this is skipped.
    //
    // Zero-cost offers are exempt: a free plan is never presented for payment, so it
    // needs no provider price at all.
    if (!input.providerPriceId?.trim() && input.amountMinor > 0) {
      const blocked = this.stripe.chargingBlockedReason();
      if (blocked) {
        throw new ServiceUnavailableException(
          `No provider price id was supplied and one cannot be created: ${blocked} ` +
            'Add the price at the provider and supply its id, or configure billing first.',
        );
      }

      const provisioned = await this.stripe.ensureRecurringPrice({
        offer: input.offer,
        market: input.market,
        currency: input.currency,
        interval: input.interval,
        amountMinor: input.amountMinor,
        catalogVersion: input.catalogVersion,
        taxBehavior: input.taxBehavior,
        providerProductId: input.providerProductId,
      });
      input.providerProductId = provisioned.providerProductId;
      input.providerPriceId = provisioned.providerPriceId;
    }

    return this.priceCatalog.createEntry(user.id, input);
  }

  @Get('prices/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Resolve the price that would be charged',
    description: 'Fails closed with 404 when no approved record matches — never returns a fallback.',
  })
  resolvePrice(
    @Query('offer') offer: CommercialOffer,
    @Query('market') market: string,
    @Query('currency') currency: string,
    @Query('interval') interval: BillingInterval,
    @Query('channel') channel: BillingChannel,
  ) {
    return this.priceCatalog.requirePrice({ offer, market, currency, interval, channel });
  }

  // --- Entitlements --------------------------------------------------------

  @Get('entitlements/:pharmacyId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Resolve a pharmacy commercial entitlement and eligibility',
    description: 'Entitlement is what was purchased; eligibility is whether it may be used.',
  })
  entitlements_(@Param('pharmacyId') pharmacyId: string) {
    return this.entitlements.resolveForPharmacy(pharmacyId);
  }

  // --- Subscription lifecycle ---------------------------------------------

  @Post('subscriptions/evaluation')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Start a 30-day Pro evaluation (no card, never auto-converts)' })
  async startEvaluation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { billingProfileId: string; pharmacyId: string },
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN);
    return this.subscriptions.startEvaluation(user.id, body);
  }

  @Post('subscriptions/pro')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Convert a verified location to paid Intelligence Pro',
    description:
      'Blocked unless verification is approved, an authorized payer selected the offer, an approved ' +
      'catalog price exists, a billing profile exists, tax is determined and terms were accepted.',
  })
  async activatePro(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActivateProDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN);
    return this.subscriptions.activatePro(user.id, {
      billingProfileId: dto.billingProfileId,
      pharmacyId: dto.pharmacyId,
      market: dto.market,
      currency: dto.currency,
      interval: dto.interval,
      channel: dto.channel,
      hasAuthorizedPayer: dto.hasAuthorizedPayer,
      hasTaxDetermination: dto.hasTaxDetermination,
      termsAccepted: dto.termsAccepted,
    });
  }

  @Post('subscriptions/:id/locations/:pharmacyId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Add a verified location to a paid subscription (prorated)' })
  async addLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN);
    return this.subscriptions.addLocation(user.id, { subscriptionId: id, pharmacyId });
  }

  @Post('subscriptions/:id/locations/:pharmacyId/release')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Release a paid location',
    description: 'Frees capacity immediately; billed quantity reduces at renewal, no automatic refund.',
  })
  async releaseLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.CHANGE_PLAN);
    return this.subscriptions.releaseLocation(user.id, { subscriptionId: id, pharmacyId });
  }

  // --- Usage ---------------------------------------------------------------

  @Get('usage/:billingProfileId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Usage summary for a window',
    description: 'Reports billable units alongside excluded events so both are visible.',
  })
  async usageSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('billingProfileId') billingProfileId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('metricCode') metricCode?: string,
  ) {
    await this.capabilities.require(user.id, BillingCapability.VIEW_PLAN_AND_USAGE, {
      billingProfileId,
    });
    return this.usage.summarize({
      billingProfileId,
      from: new Date(from),
      to: new Date(to),
      metricCode,
    });
  }

  // --- Capabilities --------------------------------------------------------

  @Get('capabilities/me')
  @ApiOperation({ summary: 'Billing capabilities held by the caller' })
  async myCapabilities(@CurrentUser() user: AuthenticatedUser) {
    return {
      role: user.role,
      capabilities: await this.capabilities.effectiveCapabilities(user.id),
    };
  }

  @Get('capabilities/:userId')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Billing capabilities held by a user' })
  async userCapabilities(@Param('userId') userId: string) {
    return {
      userId,
      capabilities: await this.capabilities.effectiveCapabilities(userId),
      grants: await this.capabilities.activeGrants(userId),
    };
  }

  @Post('capabilities/grant')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Grant a billing capability to a user',
    description:
      'SUPER_ADMIN holds every capability implicitly and can delegate any of them. Grants that would ' +
      'break separation of duties require an explicit acknowledgement.',
  })
  grant(@CurrentUser() user: AuthenticatedUser, @Body() dto: GrantCapabilityDto) {
    return this.capabilities.grant(user.id, {
      userId: dto.userId,
      capability: dto.capability,
      billingProfileId: dto.billingProfileId,
      reason: dto.reason,
      acknowledgeSeparationOfDutiesConflict: dto.acknowledgeSeparationOfDutiesConflict,
    });
  }

  @Post('capabilities/:grantId/revoke')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revoke a capability grant' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
    @Body() body: { reason?: string },
  ) {
    return this.capabilities.revoke(user.id, grantId, body?.reason);
  }
}
