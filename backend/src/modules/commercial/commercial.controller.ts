import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import { CreatePriceEntryDto } from './dto/create-price-entry.dto';
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
  ) {}

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
      'so every chargeable amount must exist here first.',
  })
  async createPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceEntryDto,
  ) {
    await this.capabilities.require(user.id, BillingCapability.MANAGE_PRICE_CATALOG);
    return this.priceCatalog.createEntry(user.id, {
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
      providerProductId: dto.providerProductId,
      providerPriceId: dto.providerPriceId,
      taxBehavior: dto.taxBehavior,
      legalTermsVersion: dto.legalTermsVersion,
    });
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
