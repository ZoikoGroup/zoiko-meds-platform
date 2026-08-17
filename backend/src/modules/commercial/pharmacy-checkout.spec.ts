import { ForbiddenException } from '@nestjs/common';
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

    controller = new PharmacyCheckoutController(
      prisma as unknown as PrismaService,
      new ConfigService({ APP_BASE_URL: 'https://app.test' }),
      stripe as unknown as StripeService,
      priceCatalog as unknown as PriceCatalogService,
      billingProfiles as unknown as BillingProfileService,
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
