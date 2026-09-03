import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BillingChannel,
  BillingInterval,
  CommercialOffer,
  UserRole,
} from '@prisma/client';
import { IsOptional, IsString, Length } from 'class-validator';
import { appBaseUrl, appUrl } from '../../config/app-urls';
import { resolveCountryAlpha2 } from '../../common/countries';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BillingProfileService } from './billing-profile.service';
import { PriceCatalogService } from './price-catalog.service';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookService } from './stripe/stripe-webhook.service';

class StartCheckoutDto {
  /**
   * Market to price against. Defaults to the pharmacy's own country. Accepts an
   * alpha-2 code or a country name, as the pharmacy profile field does.
   */
  @IsOptional()
  @IsString()
  @Length(2, 56)
  market?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

/** The session id the provider put in the return URL. */
class ConfirmCheckoutDto {
  @IsString()
  @Length(8, 256)
  sessionId!: string;
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
    // The same reconciliation the webhook runs, so the two routes cannot drift
    // into disagreeing about what a paid checkout means.
    private readonly webhooks: StripeWebhookService,
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

    // The pharmacy's own country drives both tax identity and, by default, which
    // market it is priced in. It is accepted as a code or a name on the profile, so
    // resolve it here rather than assume the operator typed a code.
    const pharmacyCountry = resolveCountryAlpha2(pharmacy.country);
    if (!pharmacyCountry) {
      throw new ForbiddenException(
        pharmacy.country?.trim()
          ? `We could not recognise "${pharmacy.country.trim()}" as a country, so we cannot determine the ` +
              'price for your market. Correct it in your pharmacy profile — a name such as India, or the ' +
              'two-letter code IN, both work.'
          : 'Your pharmacy has no country set, so we cannot determine the price for your market. Add it to your profile first.',
      );
    }

    // Price the pharmacy's own market unless one is supplied.
    const market = dto.market ? resolveCountryAlpha2(dto.market) : pharmacyCountry;
    if (!market) {
      throw new ForbiddenException(
        `We could not recognise "${dto.market}" as a country. Use a country name or its two-letter code.`,
      );
    }

    // Fails closed when no approved record exists — a published range is not an
    // executable price. The currency is left to the catalog unless the caller names
    // one: which currency a market is billed in is a commercial decision recorded
    // there, not something this endpoint should assume.
    const price = await this.priceCatalog.requirePriceForMarket({
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      market,
      currency: dto.currency?.toUpperCase(),
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
        // The resolved code, not what was typed: this becomes the customer address
        // at the provider, which only accepts alpha-2.
        country: pharmacyCountry,
        addressLine1: pharmacy.addressLine1,
        addressLine2: pharmacy.addressLine2,
        city: pharmacy.city,
        region: pharmacy.region,
        postalCode: pharmacy.postalCode,
      }));

    // The shared resolver, not a local copy of it: this controller had its own,
    // which is how the return URL kept pointing at a host with no such page while
    // the OAuth bounce - configured separately - worked (MP-47).
    const base = appBaseUrl(this.config);
    const session = await this.stripe.createCheckoutSession({
      billingProfileId: profile.id,
      providerPriceId: price.providerPriceId as string,
      quantity: 1,
      classification: pharmacy.commercialClassification,
      pharmacyId: pharmacy.id,
      priceCatalogEntryId: price.id,
      // The session id comes back in the redirect so the page returning from
      // checkout can confirm the payment itself. Without it the platform had no
      // way to learn a payment succeeded except the webhook, and a webhook that
      // is misconfigured or slower than the browser left the pharmacy staring at
      // an inactive plan with nothing recorded anywhere (MP-52). Stripe
      // substitutes the id for this literal placeholder.
      successUrl: `${base}/pharmacy/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/pharmacy/billing?checkout=cancelled`,
    });

    return { url: session.url };
  }

  @Post('checkout/confirm')
  @Roles(UserRole.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Confirm a checkout the browser has just returned from',
    description:
      'Reads the session back from the provider and activates the plan if it is paid. The webhook does the same thing; whichever arrives first wins and the other finds the work done. Exists because a webhook that is misconfigured, unreachable, or simply slower than the redirect used to leave a paid pharmacy on an inactive plan with nothing recorded for an administrator to find (MP-52).',
  })
  async confirmCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmCheckoutDto,
  ): Promise<{ status: 'active' | 'pending'; message: string }> {
    const pharmacyId = user.pharmacyId ?? (await this.resolvePharmacyId(user));
    if (!pharmacyId) {
      throw new ForbiddenException('Your account is not linked to a pharmacy.');
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.retrieveCheckoutSession(dto.sessionId);
    } catch {
      // An id that the provider does not recognise. Not an error worth alarming
      // the operator with — the webhook may yet arrive — so it reads as pending.
      throw new NotFoundException('That checkout session could not be found.');
    }

    // The session must be this pharmacy's own. Session ids are not secret once
    // they have been in a URL, and confirming somebody else's purchase would
    // activate a plan against a pharmacy that never bought one.
    if (session.metadata?.pharmacyId !== pharmacyId) {
      throw new ForbiddenException('That checkout session does not belong to your pharmacy.');
    }

    const result = await this.webhooks.reconcileCheckoutSession(session, 'return');
    if (result.reconciled) {
      return { status: 'active', message: 'Payment confirmed. Your plan is active.' };
    }

    return {
      status: 'pending',
      message:
        result.reason === 'unpaid'
          ? 'The payment provider has not confirmed this payment yet. This page will keep checking.'
          : 'This checkout is not ready to activate yet. This page will keep checking.',
    };
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
      returnUrl: appUrl(this.config, '/pharmacy/billing'),
    });
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
