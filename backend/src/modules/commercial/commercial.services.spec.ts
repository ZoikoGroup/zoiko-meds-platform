import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BillingChannel,
  BillingInterval,
  CommercialClassification,
  CommercialOffer,
  SubscriptionState,
  UsageExclusionReason,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { PriceCatalogService } from './price-catalog.service';
import { EntitlementService, CommercialFeature } from './entitlement.service';
import { UsageMeteringService } from './usage-metering.service';

const audit = () => ({ write: jest.fn() }) as unknown as AuditWriter;

describe('PriceCatalogService — fail closed, never guess a price', () => {
  let service: PriceCatalogService;
  let prisma: any;

  beforeEach(() => {
    prisma = { priceCatalogEntry: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } };
    service = new PriceCatalogService(prisma as unknown as PrismaService, audit());
  });

  it('throws rather than defaulting when no approved price exists (S-E2, S-M2)', async () => {
    prisma.priceCatalogEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.requirePrice({
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        market: 'IN',
        currency: 'USD',
        interval: BillingInterval.MONTH,
        channel: BillingChannel.WEB_SELF_SERVE,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says explicitly that a published range is not an executable price', async () => {
    prisma.priceCatalogEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.requirePrice({
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        market: 'IN',
        currency: 'USD',
        interval: BillingInterval.MONTH,
        channel: BillingChannel.WEB_SELF_SERVE,
      }),
    ).rejects.toThrow(/range is not an executable price/i);
  });

  it('normalizes market and currency so a lowercase caller still matches', async () => {
    prisma.priceCatalogEntry.findFirst.mockResolvedValue({ id: 'pc_1' });

    await service.findPrice({
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      market: 'in',
      currency: 'usd',
      interval: BillingInterval.MONTH,
      channel: BillingChannel.WEB_SELF_SERVE,
    });

    expect(prisma.priceCatalogEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ market: 'IN', currency: 'USD' }),
      }),
    );
  });

  it('refuses a catalog entry with no approval reference (S-P4)', async () => {
    await expect(
      service.createEntry('admin_1', {
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        market: 'IN',
        currency: 'USD',
        interval: BillingInterval.MONTH,
        amountMinor: 19900,
        channel: BillingChannel.WEB_SELF_SERVE,
        catalogVersion: 'v1',
        approvalReference: '   ',
        effectiveFrom: new Date('2026-09-01'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.priceCatalogEntry.create).not.toHaveBeenCalled();
  });

  it('refuses to price a paid offer at zero', async () => {
    await expect(
      service.createEntry('admin_1', {
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        market: 'IN',
        currency: 'USD',
        interval: BillingInterval.MONTH,
        amountMinor: 0,
        channel: BillingChannel.WEB_SELF_SERVE,
        catalogVersion: 'v1',
        approvalReference: 'ZM-APPROVAL-1',
        effectiveFrom: new Date('2026-09-01'),
      }),
    ).rejects.toThrow(/cannot be priced at zero/i);
  });

  it('refuses to put a price on a free offer — that needs a new program, not an insert (S-D1)', async () => {
    await expect(
      service.createEntry('admin_1', {
        offer: CommercialOffer.PHARMACY_NETWORK_CORE,
        market: 'IN',
        currency: 'USD',
        interval: BillingInterval.MONTH,
        amountMinor: 5000,
        channel: BillingChannel.WEB_SELF_SERVE,
        catalogVersion: 'v1',
        approvalReference: 'ZM-APPROVAL-1',
        effectiveFrom: new Date('2026-09-01'),
      }),
    ).rejects.toThrow(/free at launch/i);
  });

  it('treats a locked price as immutable (S-21)', async () => {
    prisma.priceCatalogEntry.findUnique.mockResolvedValue({
      id: 'pc_1',
      lockedAt: new Date('2026-09-02'),
    });
    await expect(service.assertMutable('pc_1')).rejects.toThrow(/immutable/i);
  });

  it('allows editing a price that has not been invoiced', async () => {
    prisma.priceCatalogEntry.findUnique.mockResolvedValue({ id: 'pc_1', lockedAt: null });
    await expect(service.assertMutable('pc_1')).resolves.toBeUndefined();
  });

  describe('requirePriceForMarket — a buyer names a market, not a currency', () => {
    const lookup = {
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      market: 'IN',
      interval: BillingInterval.MONTH,
      channel: BillingChannel.WEB_SELF_SERVE,
    };

    const entry = (currency: string, over: Record<string, unknown> = {}) => ({
      id: `pc_${currency}`,
      currency,
      amountMinor: 19900,
      effectiveFrom: new Date('2026-08-01'),
      ...over,
    });

    it('takes the only approved currency for the market', async () => {
      // The bug this replaces: the caller assumed USD, so an INR-only market 404ed
      // even though an approved price existed for it.
      prisma.priceCatalogEntry.findMany.mockResolvedValue([entry('INR')]);

      await expect(service.requirePriceForMarket(lookup)).resolves.toMatchObject({ currency: 'INR' });
    });

    it('prefers the market currency when several are approved', async () => {
      prisma.priceCatalogEntry.findMany.mockResolvedValue([entry('USD'), entry('INR')]);

      await expect(service.requirePriceForMarket(lookup)).resolves.toMatchObject({ currency: 'INR' });
    });

    it('falls back to USD for a market with no local price', async () => {
      prisma.priceCatalogEntry.findMany.mockResolvedValue([entry('USD'), entry('EUR')]);

      await expect(
        service.requirePriceForMarket({ ...lookup, market: 'BW' }),
      ).resolves.toMatchObject({ currency: 'USD' });
    });

    it('refuses to choose when the market currency is genuinely ambiguous', async () => {
      prisma.priceCatalogEntry.findMany.mockResolvedValue([entry('EUR'), entry('AED')]);

      await expect(service.requirePriceForMarket({ ...lookup, market: 'BW' })).rejects.toThrow(
        /ambiguous/i,
      );
    });

    it('honours an explicitly requested currency without inspecting the market', async () => {
      prisma.priceCatalogEntry.findFirst.mockResolvedValue(entry('USD'));

      await expect(
        service.requirePriceForMarket({ ...lookup, currency: 'USD' }),
      ).resolves.toMatchObject({ currency: 'USD' });
      expect(prisma.priceCatalogEntry.findMany).not.toHaveBeenCalled();
    });

    it('still fails closed when the market has no approved price in any currency', async () => {
      prisma.priceCatalogEntry.findMany.mockResolvedValue([]);

      await expect(service.requirePriceForMarket(lookup)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.requirePriceForMarket(lookup)).rejects.toThrow(
        /range is not an executable price/i,
      );
    });

    it('uses the newest effective record for the chosen currency', async () => {
      prisma.priceCatalogEntry.findMany.mockResolvedValue([
        entry('INR', { id: 'pc_new', effectiveFrom: new Date('2026-08-01') }),
        entry('INR', { id: 'pc_old', effectiveFrom: new Date('2026-01-01') }),
      ]);

      await expect(service.requirePriceForMarket(lookup)).resolves.toMatchObject({ id: 'pc_new' });
    });
  });
});

describe('EntitlementService — entitlement and eligibility are separate questions', () => {
  let service: EntitlementService;
  let prisma: any;

  const pharmacy = (over: Record<string, unknown> = {}) => ({
    id: 'ph_1',
    verificationStatus: VerificationStatus.VERIFIED,
    commercialClassification: CommercialClassification.PRO_ACTIVE,
    subscriptionLocations: [],
    ...over,
  });

  beforeEach(() => {
    prisma = { pharmacy: { findUnique: jest.fn() } };
    service = new EntitlementService(prisma as unknown as PrismaService);
  });

  it('grants Network Core features to a verified free pharmacy', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE }),
    );
    const result = await service.resolveForPharmacy('ph_1');

    expect(result.features).toContain(CommercialFeature.AVAILABILITY_SIGNALS);
    expect(result.features).not.toContain(CommercialFeature.LOCAL_DEMAND_DASHBOARD);
    expect(result.eligible).toBe(true);
    expect(result.participatesInNetworkCore).toBe(true);
  });

  it('grants Pro features during a no-card evaluation', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ commercialClassification: CommercialClassification.PRO_EVALUATION }),
    );
    const result = await service.resolveForPharmacy('ph_1');
    expect(result.features).toContain(CommercialFeature.LOCAL_DEMAND_DASHBOARD);
  });

  it('treats a paid pharmacy with lapsed verification as entitled but ineligible (S-B4)', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ verificationStatus: VerificationStatus.PENDING }),
    );
    const result = await service.resolveForPharmacy('ph_1');

    // Still entitled — they paid for it...
    expect(result.features).toContain(CommercialFeature.LOCAL_DEMAND_DASHBOARD);
    // ...but not permitted to act until re-verified.
    expect(result.eligible).toBe(false);
    expect(result.eligibilityReason).toMatch(/verification is not approved/i);
  });

  it('withdraws paid analytics on delinquency but keeps Network Core (S-L1)', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({
        subscriptionLocations: [
          {
            subscription: {
              state: SubscriptionState.PAID_FEATURES_RESTRICTED,
              offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
            },
          },
        ],
      }),
    );
    const result = await service.resolveForPharmacy('ph_1');

    expect(result.features).not.toContain(CommercialFeature.ANALYTICS_EXPORT);
    expect(result.features).not.toContain(CommercialFeature.LOCAL_DEMAND_DASHBOARD);
    // The pharmacy is still discoverable and still signalling availability.
    expect(result.features).toContain(CommercialFeature.AVAILABILITY_SIGNALS);
    expect(result.participatesInNetworkCore).toBe(true);
  });

  it('gives a suspended pharmacy no features and no eligibility', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({
        commercialClassification: CommercialClassification.SUSPENDED_COMPLIANCE,
      }),
    );
    const result = await service.resolveForPharmacy('ph_1');
    expect(result.features).toEqual([]);
    expect(result.eligible).toBe(false);
  });

  it('gives a demo entity Network Core capability so it stays testable', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ commercialClassification: CommercialClassification.DEMO }),
    );
    const result = await service.resolveForPharmacy('ph_1');
    expect(result.features).toContain(CommercialFeature.AVAILABILITY_SIGNALS);
  });

  it('requireFeature refuses on missing entitlement and on ineligibility alike', async () => {
    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE }),
    );
    await expect(
      service.requireFeature('ph_1', CommercialFeature.ANALYTICS_EXPORT),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.pharmacy.findUnique.mockResolvedValue(
      pharmacy({ verificationStatus: VerificationStatus.SUSPENDED }),
    );
    await expect(
      service.requireFeature('ph_1', CommercialFeature.LOCAL_DEMAND_DASHBOARD),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('UsageMeteringService — nothing billable unless delivered and contracted', () => {
  let service: UsageMeteringService;
  let prisma: any;

  const metered = {
    state: SubscriptionState.ACTIVE,
    usageBillingEnabled: true,
    usageRateCardVersion: 'rc_v1',
    commercialEffectiveAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = {
      usageEvent: { create: jest.fn((a: any) => Promise.resolve({ id: 'ue_1', ...a.data })), findUnique: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
      subscription: { findUnique: jest.fn().mockResolvedValue(metered) },
    };
    service = new UsageMeteringService(prisma as unknown as PrismaService);
  });

  const record = (over: Record<string, unknown> = {}) =>
    service.record({
      idempotencyKey: 'k1',
      metricCode: 'API_REQUEST',
      subscriptionId: 'sub_1',
      responseStatus: 200,
      units: 1,
      occurredAt: new Date('2026-06-01'),
      ...over,
    });

  it('counts a delivered, contracted request', async () => {
    const ev = await record();
    expect(ev.countableUnits).toBe(1);
    expect(ev.exclusionReason).toBeNull();
    expect(ev.rateCardVersion).toBe('rc_v1');
  });

  it('never bills a platform 5xx (S-K2)', async () => {
    const ev = await record({ responseStatus: 503 });
    expect(ev.countableUnits).toBe(0);
    expect(ev.exclusionReason).toBe(UsageExclusionReason.PLATFORM_ERROR);
  });

  it('does not bill a client 4xx by default (S-K2)', async () => {
    const ev = await record({ responseStatus: 429 });
    expect(ev.countableUnits).toBe(0);
    expect(ev.exclusionReason).toBe(UsageExclusionReason.CLIENT_ERROR);
  });

  it('does not bill when the contract has no usage billing enabled (S-K1)', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ ...metered, usageBillingEnabled: false });
    const ev = await record();
    expect(ev.countableUnits).toBe(0);
    expect(ev.exclusionReason).toBe(UsageExclusionReason.NOT_METERED);
  });

  it('refuses to invent a rate when the rate card version is missing', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ ...metered, usageRateCardVersion: null });
    const ev = await record();
    expect(ev.countableUnits).toBe(0);
  });

  it('never bills before the commercial effective date (S-Q2)', async () => {
    const ev = await record({ occurredAt: new Date('2025-12-31') });
    expect(ev.countableUnits).toBe(0);
    expect(ev.exclusionReason).toBe(UsageExclusionReason.NOT_METERED);
  });

  it('creates no new usage charge while blocked by platform policy (S-B4)', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      ...metered,
      state: SubscriptionState.ELIGIBILITY_RESTRICTED,
    });
    const ev = await record();
    expect(ev.exclusionReason).toBe(UsageExclusionReason.DENIED_BY_POLICY);
  });

  it('never bills a doctrine-excluded event even on a metered contract', async () => {
    for (const metricCode of [
      'patient_search',
      'dispense_success',
      'confirmation_request_accepted',
      'sync_failed',
    ]) {
      const ev = await record({ metricCode });
      expect(ev.countableUnits).toBe(0);
      expect(ev.exclusionReason).toBe(UsageExclusionReason.NOT_METERED);
    }
  });

  it('counts a retry once — the stored event is returned, not a second charge (S-J3)', async () => {
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
    Object.setPrototypeOf(conflict, require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype);
    prisma.usageEvent.create.mockRejectedValue(conflict);
    prisma.usageEvent.findUnique.mockResolvedValue({
      id: 'ue_existing',
      idempotencyKey: 'k1',
      countableUnits: 1,
    });

    const ev = await record();
    expect(ev.id).toBe('ue_existing');
    expect(prisma.usageEvent.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'k1' },
    });
  });

  it('notifies at 70, 85 and 100 percent of the allowance (S-K3)', () => {
    expect(service.thresholdCrossed(69, 100)).toBeNull();
    expect(service.thresholdCrossed(70, 100)).toBe(70);
    expect(service.thresholdCrossed(86, 100)).toBe(85);
    expect(service.thresholdCrossed(140, 100)).toBe(100);
    // No allowance means no threshold, not a division by zero.
    expect(service.thresholdCrossed(500, null)).toBeNull();
    expect(service.thresholdCrossed(500, 0)).toBeNull();
  });
});
