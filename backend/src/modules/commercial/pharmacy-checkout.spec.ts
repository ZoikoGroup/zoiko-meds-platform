import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingChannel,
  BillingInterval,
  CommercialClassification,
  CommercialOffer,
  UserRole,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BillingProfileService } from './billing-profile.service';
import { PharmacyCheckoutController } from './pharmacy-checkout.controller';
import { PriceCatalogService } from './price-catalog.service';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookService } from './stripe/stripe-webhook.service';

const USER: AuthenticatedUser = {
  id: 'u_1',
  email: 'owner@apollo.test',
  role: UserRole.PHARMACY_ADMIN,
  pharmacyId: 'ph_1',
} as AuthenticatedUser;

describe('PharmacyCheckoutController — a pharmacy states a country, not a market code', () => {
  let controller: PharmacyCheckoutController;
  let prisma: any;
  let stripe: any;
  let priceCatalog: any;
  let billingProfiles: any;
  let webhooks: any;

  const pharmacy = (over: Record<string, unknown> = {}) => ({
    id: 'ph_1',
    name: 'Apollo Kompally',
    verificationStatus: VerificationStatus.VERIFIED,
    commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    country: 'IN',
    addressLine1: 'Kompally Main Rd',
    addressLine2: null,
    city: 'Hyderabad',
    region: 'Telangana',
    postalCode: '500014',
    ...over,
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() }, pharmacy: { findUnique: jest.fn() } };
    stripe = {
      chargingBlockedReason: jest.fn().mockReturnValue(null),
      createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://pay.test/s_1', sessionId: 's_1' }),
    };
    priceCatalog = {
      requirePriceForMarket: jest
        .fn()
        .mockResolvedValue({ id: 'pc_1', providerPriceId: 'price_1', currency: 'INR' }),
    };
    billingProfiles = {
      forPharmacy: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'bp_1' }),
    };
    // The reconciliation the return route shares with the webhook (MP-52).
    webhooks = { reconcileCheckoutSession: jest.fn().mockResolvedValue({ reconciled: true }) };

    controller = new PharmacyCheckoutController(
      prisma as unknown as PrismaService,
      new ConfigService({ APP_BASE_URL: 'https://app.test' }),
      stripe as unknown as StripeService,
      priceCatalog as unknown as PriceCatalogService,
      billingProfiles as unknown as BillingProfileService,
      webhooks as unknown as StripeWebhookService,
    );
  });

  it('prices the pharmacy market and returns the hosted URL', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await expect(controller.startCheckout(USER, {})).resolves.toEqual({
      url: 'https://pay.test/s_1',
    });
    expect(priceCatalog.requirePriceForMarket).toHaveBeenCalledWith(
      expect.objectContaining({
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        market: 'IN',
        interval: BillingInterval.MONTH,
        channel: BillingChannel.WEB_SELF_SERVE,
      }),
    );
  });

  it('leaves the currency to the catalog when the caller names none', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await controller.startCheckout(USER, {});

    // Previously hard-coded to USD, which 404ed every market priced locally.
    expect(priceCatalog.requirePriceForMarket).toHaveBeenCalledWith(
      expect.objectContaining({ currency: undefined }),
    );
  });

  it('resolves a country stored as a name to its market code', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy({ country: 'India' }));

    await controller.startCheckout(USER, {});

    expect(priceCatalog.requirePriceForMarket).toHaveBeenCalledWith(
      expect.objectContaining({ market: 'IN' }),
    );
  });

  it('accepts a requested market written as a name', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await controller.startCheckout(USER, { market: 'united kingdom' });

    expect(priceCatalog.requirePriceForMarket).toHaveBeenCalledWith(
      expect.objectContaining({ market: 'GB' }),
    );
  });

  it('gives the billing profile the resolved code, which is what the provider accepts', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy({ country: 'India' }));

    await controller.startCheckout(USER, {});

    expect(billingProfiles.create).toHaveBeenCalledWith(
      'u_1',
      expect.objectContaining({ country: 'IN' }),
    );
  });

  it('says the country is missing only when it is actually missing', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy({ country: null }));

    await expect(controller.startCheckout(USER, {})).rejects.toThrow(/no country set/i);
  });

  it('says a country is unrecognised rather than claiming none is set', async () => {
    // The reported bug: a pharmacy with country "Hyderabad" was told it had no
    // country at all, and the profile field it was sent to fix accepted names.
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy({ country: 'Hyderabad' }));

    const attempt = controller.startCheckout(USER, {});
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(/could not recognise "Hyderabad"/i);
    await expect(attempt).rejects.not.toThrow(/no country set/i);
  });

  it('refuses an unverified pharmacy before pricing anything', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ verificationStatus: VerificationStatus.PENDING }),
    );

    await expect(controller.startCheckout(USER, {})).rejects.toThrow(/must be verified/i);
    expect(priceCatalog.requirePriceForMarket).not.toHaveBeenCalled();
  });

  it('refuses when charging is not authorised, before reading the pharmacy', async () => {
    stripe.chargingBlockedReason.mockReturnValue('Billing is not configured.');

    await expect(controller.startCheckout(USER, {})).rejects.toThrow(/Purchasing is unavailable/i);
    expect(prisma.pharmacy.findUnique).not.toHaveBeenCalled();
  });

  it('puts the session id in the return URL, so the payment can be confirmed', async () => {
    // Without it the platform has no way to learn a payment succeeded except the
    // provider's webhook, and a webhook that is misconfigured or unreachable
    // leaves a paid pharmacy on an inactive plan for good (MP-52).
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy());

    await controller.startCheckout(USER, {});

    const { successUrl } = stripe.createCheckoutSession.mock.calls[0][0];
    expect(successUrl).toContain('checkout=success');
    // The literal placeholder: the provider substitutes the real id into it.
    expect(successUrl).toContain('session_id={CHECKOUT_SESSION_ID}');
  });

  it('reuses an existing billing profile instead of creating a second identity', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(pharmacy());
    billingProfiles.forPharmacy.mockResolvedValue({ id: 'bp_existing' });

    await controller.startCheckout(USER, {});

    expect(billingProfiles.create).not.toHaveBeenCalled();
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ billingProfileId: 'bp_existing' }),
    );
  });
});

/**
 * Confirming a payment on the way back from checkout (MP-52).
 *
 * The pharmacy paid, was returned here, and was told its plan "activates as soon
 * as the payment provider confirms it — this page updates automatically". Then
 * nothing happened, on the pharmacy's own page or on the administrator's, because
 * the only thing that could have created the subscription was a webhook that
 * never arrived. This is the second route: the pharmacy confirming its own
 * session, running the same reconciliation the webhook runs.
 */
describe('PharmacyCheckoutController — confirming a returned checkout', () => {
  let controller: PharmacyCheckoutController;
  let prisma: any;
  let stripe: any;
  let webhooks: any;

  const session = (over: Record<string, unknown> = {}) => ({
    id: 'cs_1',
    payment_status: 'paid',
    metadata: { pharmacyId: 'ph_1', billingProfileId: 'bp_1' },
    ...over,
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() }, pharmacy: { findUnique: jest.fn() } };
    stripe = {
      chargingBlockedReason: jest.fn().mockReturnValue(null),
      retrieveCheckoutSession: jest.fn().mockResolvedValue(session()),
    };
    webhooks = { reconcileCheckoutSession: jest.fn().mockResolvedValue({ reconciled: true }) };

    controller = new PharmacyCheckoutController(
      prisma as unknown as PrismaService,
      new ConfigService({ APP_BASE_URL: 'https://app.test' }),
      stripe as unknown as StripeService,
      {} as unknown as PriceCatalogService,
      {} as unknown as BillingProfileService,
      webhooks as unknown as StripeWebhookService,
    );
  });

  it('activates the plan without waiting for the webhook', async () => {
    await expect(controller.confirmCheckout(USER, { sessionId: 'cs_1' })).resolves.toMatchObject({
      status: 'active',
    });
    expect(webhooks.reconcileCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cs_1' }),
      'return',
    );
  });

  it('reads the session back from the provider rather than trusting the query string', async () => {
    // "?checkout=success" is whatever the browser was redirected with, and
    // anybody can type it. The provider's own answer is the only one worth having.
    await controller.confirmCheckout(USER, { sessionId: 'cs_1' });

    expect(stripe.retrieveCheckoutSession).toHaveBeenCalledWith('cs_1');
  });

  it('refuses a session belonging to another pharmacy', async () => {
    // Session ids are not secret once they have been in a URL, and confirming
    // somebody else's purchase would activate a plan nobody bought.
    stripe.retrieveCheckoutSession.mockResolvedValue(
      session({ metadata: { pharmacyId: 'ph_other' } }),
    );

    await expect(controller.confirmCheckout(USER, { sessionId: 'cs_1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(webhooks.reconcileCheckoutSession).not.toHaveBeenCalled();
  });

  it('reports a payment the provider has not settled as pending, not as failed', async () => {
    // An asynchronous payment method, or a browser that beat the provider back.
    // Nothing has gone wrong, so nothing should read as though it has.
    webhooks.reconcileCheckoutSession.mockResolvedValue({ reconciled: false, reason: 'unpaid' });

    await expect(controller.confirmCheckout(USER, { sessionId: 'cs_1' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('reports an id the provider does not recognise', async () => {
    stripe.retrieveCheckoutSession.mockRejectedValue(new Error('No such checkout.session'));

    await expect(controller.confirmCheckout(USER, { sessionId: 'cs_nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an account with no pharmacy behind it', async () => {
    prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });

    await expect(
      controller.confirmCheckout({ ...USER, pharmacyId: null } as never, { sessionId: 'cs_1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
