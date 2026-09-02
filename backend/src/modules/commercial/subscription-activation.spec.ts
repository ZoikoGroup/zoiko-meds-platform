import { ForbiddenException } from '@nestjs/common';
import {
  BillingChannel,
  CommercialClassification,
  ProviderMode,
  SubscriptionState,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { PriceCatalogService } from './price-catalog.service';
import { StripeService } from './stripe/stripe.service';
import { SubscriptionService } from './subscription.service';

/**
 * Activation must never leave a pharmacy entitled to paid features that the
 * platform cannot bill. Before this was wired, activatePro created a PRO_ACTIVE
 * subscription with no provider subscription behind it — free Pro.
 */
describe('SubscriptionService.activatePro — a paid plan cannot activate unbilled', () => {
  let service: SubscriptionService;
  let prisma: any;
  let stripe: any;
  let priceCatalog: any;
  let audit: any;

  const PRICE = {
    id: 'pc_1',
    amountMinor: 19900,
    currency: 'USD',
    market: 'IN',
    catalogVersion: 'v1',
    providerPriceId: 'price_test_1',
  };

  const input = {
    billingProfileId: 'bp_1',
    pharmacyId: 'ph_1',
    market: 'IN',
    currency: 'USD',
    hasAuthorizedPayer: true,
    hasTaxDetermination: true,
    termsAccepted: true,
  };

  beforeEach(() => {
    prisma = {
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ph_1',
          verificationStatus: VerificationStatus.VERIFIED,
          commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
        }),
        update: jest.fn(),
      },
      billingProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'bp_1' }) },
      subscription: {
        create: jest.fn().mockResolvedValue({
          id: 'sub_1',
          commercialEffectiveAt: new Date('2026-09-01'),
        }),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'sub_1', state: 'ACTIVE' }),
      },
      subscriptionLocation: { upsert: jest.fn(), count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    audit = { write: jest.fn() };
    priceCatalog = {
      requirePrice: jest.fn().mockResolvedValue(PRICE),
      lock: jest.fn(),
    };
    stripe = {
      chargingBlockedReason: jest.fn().mockReturnValue(null),
      assertPriceUsableFor: jest.fn(),
      createSubscription: jest.fn().mockResolvedValue('sub_stripe_1'),
      updateQuantity: jest.fn().mockResolvedValue(undefined),
      mode: ProviderMode.TEST,
    };
    service = new SubscriptionService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
      priceCatalog as unknown as PriceCatalogService,
      stripe as unknown as StripeService,
    );
  });

  it('creates the provider subscription so the charge actually exists', async () => {
    await service.activatePro('admin_1', input);

    expect(stripe.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_1',
        billingProfileId: 'bp_1',
        providerPriceId: 'price_test_1',
        quantity: 1,
        classification: CommercialClassification.PRO_ACTIVE,
      }),
    );
  });

  it('refuses to activate self-serve Pro when charging is not possible', async () => {
    stripe.chargingBlockedReason.mockReturnValue('No payment provider is configured.');

    await expect(service.activatePro('admin_1', input)).rejects.toBeInstanceOf(ForbiddenException);
    // Nothing was created — no free Pro.
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(stripe.createSubscription).not.toHaveBeenCalled();
  });

  it('points the operator at the Finance-invoiced route when charging is unavailable', async () => {
    stripe.chargingBlockedReason.mockReturnValue('No payment provider is configured.');
    await expect(service.activatePro('admin_1', input)).rejects.toThrow(/SALES_CONTRACT/);
  });

  it('allows a Finance-invoiced sales contract with no provider subscription (S-N1)', async () => {
    stripe.chargingBlockedReason.mockReturnValue('No payment provider is configured.');

    await service.activatePro('admin_1', {
      ...input,
      channel: BillingChannel.SALES_CONTRACT,
    });

    expect(prisma.subscription.create).toHaveBeenCalled();
    // Deliberately no provider subscription: the Order Form is invoiced by Finance.
    expect(stripe.createSubscription).not.toHaveBeenCalled();
  });

  it('rolls back to free participation when the provider rejects the subscription', async () => {
    stripe.createSubscription.mockRejectedValue(new Error('card_declined'));

    await expect(service.activatePro('admin_1', input)).rejects.toThrow(/was not activated/i);

    // The pharmacy must not be left on PRO_ACTIVE with no billing behind it.
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: SubscriptionState.CANCELED }),
      }),
    );
    expect(prisma.pharmacy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE },
      }),
    );
  });

  it('still fails closed when no approved catalog price exists', async () => {
    priceCatalog.requirePrice.mockRejectedValue(new Error('No approved price catalog record'));
    await expect(service.activatePro('admin_1', input)).rejects.toThrow(/No approved price/);
  });

  it('checks the live-price guard before creating anything', async () => {
    stripe.assertPriceUsableFor.mockImplementation(() => {
      throw new ForbiddenException('may never reference a live Price ID');
    });
    await expect(service.activatePro('admin_1', input)).rejects.toThrow(/live Price ID/);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });
});
