import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BillingChannel,
  BillingInterval,
  CommercialOffer,
  UserRole,
} from '@prisma/client';
import { IsOptional, IsString, Length } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BillingProfileService } from './billing-profile.service';
import { PriceCatalogService } from './price-catalog.service';
import { StripeService } from './stripe/stripe.service';

class StartCheckoutDto {
  /** Market to price against. Defaults to the pharmacy's own country. */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  market?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

/**
 * Pharmacy-initiated purchase (ZM-COM-BILL-001 S-E5, S-O2).
 *
 * Lives in the commercial module rather than the pharmacy module so the pharmacy
 * domain does not have to depend on billing internals.
 *
 * Two deliberate constraints:
 *
 *  - PHARMACY_ADMIN only. S-E5 puts purchase authority with the Organization Owner
 *    or Billing Admin; a Pharmacist may not buy, and PHARMACY_STAFF is absent from
 *    the guard rather than checked in the body.
 *  - Provider-hosted. Card details never reach this application, so it stays out of
 *    PCI scope, and S-O2 requires purchasing to run through the web channel.
 *
 * No internal subscription is created here. It is created when the provider
 * confirms payment, so an abandoned checkout leaves no paid entitlement behind.
 */
@ApiTags('pharmacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pharmacies/me/billing')
export class PharmacyCheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
    private readonly priceCatalog: PriceCatalogService,
    private readonly billingProfiles: BillingProfileService,
  ) {}

  @Post('checkout')
  @Roles(UserRole.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Start a provider-hosted checkout for Intelligence Pro',
    description:
      'Returns a URL to redirect to. Fails closed when no approved price exists for the market, or when charging is not authorised.',
  })
  async startCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartCheckoutDto,
  ): Promise<{ url: string }> {
    const blocked = this.stripe.chargingBlockedReason();
    if (blocked) {
      throw new ForbiddenException(
        `Purchasing is unavailable: ${blocked} Please contact ZoikoMeds support.`,
      );
    }

    const pharmacy = await this.requireVerifiedPharmacy(user);

    // Price the pharmacy's own market unless one is supplied. Fails closed when no
    // approved record exists — a published range is not an executable price.
    const market = (dto.market || pharmacy.country || '').toUpperCase();
    if (market.length !== 2) {
      throw new ForbiddenException(
        'Your pharmacy has no country set, so we cannot determine the price for your market. Add it to your profile first.',
      );
    }
    const price = await this.priceCatalog.requirePrice({
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      market,
      currency: (dto.currency || 'USD').toUpperCase(),
      interval: BillingInterval.MONTH,
      channel: BillingChannel.WEB_SELF_SERVE,
    });

    // Reuse the organization's billing identity, or create it from the pharmacy's
    // own verified details so the operator is not asked to retype them.
    const existing = await this.billingProfiles.forPharmacy(pharmacy.id);
    const profile =
      existing ??
      (await this.billingProfiles.create(user.id, {
        legalName: pharmacy.name,
        billingEmail: user.email,
        country: pharmacy.country as string,
        addressLine1: pharmacy.addressLine1,
        addressLine2: pharmacy.addressLine2,
        city: pharmacy.city,
        region: pharmacy.region,
        postalCode: pharmacy.postalCode,
      }));

    const base = this.appBaseUrl();
    const session = await this.stripe.createCheckoutSession({
      billingProfileId: profile.id,
      providerPriceId: price.providerPriceId as string,
      quantity: 1,
      classification: pharmacy.commercialClassification,
      pharmacyId: pharmacy.id,
      priceCatalogEntryId: price.id,
      successUrl: `${base}/pharmacy/billing?checkout=success`,
      cancelUrl: `${base}/pharmacy/billing?checkout=cancelled`,
    });

    return { url: session.url };
  }

  @Post('portal')
  @Roles(UserRole.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Open the provider-hosted billing portal',
    description:
      'Manage payment method, view invoices and download receipts. Hosted by the provider, so no card data reaches this application.',
  })
  async openPortal(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    const blocked = this.stripe.chargingBlockedReason();
    if (blocked) {
      throw new ForbiddenException(`The billing portal is unavailable: ${blocked}`);
    }

    const pharmacyId = user.pharmacyId ?? (await this.resolvePharmacyId(user));
    if (!pharmacyId) {
      throw new ForbiddenException('Your account is not linked to a pharmacy.');
    }

    const profile = await this.billingProfiles.forPharmacy(pharmacyId);
    if (!profile) {
      throw new ForbiddenException(
        'There is no billing account for your pharmacy yet. It is created when you purchase a plan.',
      );
    }

    return this.stripe.createBillingPortalSession({
      billingProfileId: profile.id,
      returnUrl: `${this.appBaseUrl()}/pharmacy/billing`,
    });
  }

  private appBaseUrl(): string {
    // Trailing slashes would produce a double slash in the return URL.
    return (this.config.get<string>('APP_BASE_URL') || 'http://localhost:5173').replace(/\/+$/, '');
  }

  private async resolvePharmacyId(user: AuthenticatedUser): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { pharmacyId: true },
    });
    return row?.pharmacyId ?? null;
  }

  /**
   * Purchase requires a verified pharmacy. Verification gates commercial
   * conversion, so an unverified operator is told to finish that first rather than
   * being taken to a payment page they should not reach.
   */
  private async requireVerifiedPharmacy(user: AuthenticatedUser) {
    const pharmacyId = user.pharmacyId ?? (await this.resolvePharmacyId(user));
    if (!pharmacyId) {
      throw new ForbiddenException(
        'Your account is not linked to a pharmacy. Complete your pharmacy profile first.',
      );
    }
    const pharmacy = await this.prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
    if (!pharmacy) throw new ForbiddenException('Pharmacy not found.');
    if (pharmacy.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        'Your pharmacy must be verified before you can purchase Intelligence Pro.',
      );
    }
    return pharmacy;
  }
}
