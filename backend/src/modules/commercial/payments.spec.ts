import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommercialClassification,
  CreditNoteReason,
  Prisma,
  ProviderEventStatus,
  ProviderMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { StripeConfig } from './stripe/stripe.config';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookService } from './stripe/stripe-webhook.service';
import { TaxService } from './tax.service';
import { InvoiceService } from './invoice.service';
import { SubscriptionService } from './subscription.service';

const audit = () => ({ write: jest.fn() }) as unknown as AuditWriter;
const cfg = (values: Record<string, string | undefined>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

const uniqueViolation = () => {
  const e = Object.assign(new Error('unique'), { code: 'P2002' });
  Object.setPrototypeOf(e, Prisma.PrismaClientKnownRequestError.prototype);
  return e;
};

describe('StripeConfig — live charging needs two independent switches (S-3, S-P1)', () => {
  it('reports billing as unconfigured when no key is set, without throwing', () => {
    const c = new StripeConfig(cfg({}));
    expect(c.isConfigured).toBe(false);
    expect(c.canCharge).toBe(false);
    expect(c.chargingBlockedReason()).toMatch(/no payment provider is configured/i);
  });

  it('infers TEST mode from a test key and allows charging', () => {
    const c = new StripeConfig(cfg({ STRIPE_SECRET_KEY: 'sk_test_abc' }));
    expect(c.mode).toBe(ProviderMode.TEST);
    expect(c.canCharge).toBe(true);
  });

  it('refuses to charge on a live key until BILLING_LIVE_MODE is enabled', () => {
    const c = new StripeConfig(cfg({ STRIPE_SECRET_KEY: 'sk_live_abc' }));
    expect(c.mode).toBe(ProviderMode.LIVE);
    expect(c.canCharge).toBe(false);
    expect(c.chargingBlockedReason()).toMatch(/live charging is not authorised/i);
    expect(c.chargingBlockedReason()).toMatch(/launch blockers/i);
  });

  it('permits live charging only with both the live key and explicit authorisation', () => {
    const c = new StripeConfig(cfg({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE_MODE: 'true' }));
    expect(c.canCharge).toBe(true);
  });

  it('does not treat a truthy-looking string as authorisation', () => {
    const c = new StripeConfig(cfg({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE_MODE: '1' }));
    expect(c.canCharge).toBe(false);
  });
});

describe('StripeService — a live price is unreachable from a non-production entity (S-Q4)', () => {
  const build = (values: Record<string, string | undefined>) =>
    new StripeService(
      new StripeConfig(cfg(values)),
      {} as unknown as PrismaService,
      audit(),
    );

  it('rejects a catalog price with no provider Price ID', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_test_abc' });
    expect(() =>
      s.assertPriceUsableFor({ providerPriceId: null }, CommercialClassification.PRO_ACTIVE),
    ).toThrow(/no provider Price ID/i);
  });

  it('blocks a live price for internal, demo, QA, staging, sandbox and pilot entities', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE_MODE: 'true' });
    for (const c of [
      CommercialClassification.INTERNAL,
      CommercialClassification.DEMO,
      CommercialClassification.QA,
      CommercialClassification.STAGING,
      CommercialClassification.PARTNER_SANDBOX,
      CommercialClassification.PILOT_NON_BILLABLE,
    ]) {
      expect(() => s.assertPriceUsableFor({ providerPriceId: 'price_live_1' }, c)).toThrow(
        ForbiddenException,
      );
    }
  });

  it('blocks a live price for a merely verified free pharmacy', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE_MODE: 'true' });
    expect(() =>
      s.assertPriceUsableFor(
        { providerPriceId: 'price_live_1' },
        CommercialClassification.VERIFIED_NETWORK_CORE,
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows a live price for genuinely commercial classifications', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_live_abc', BILLING_LIVE_MODE: 'true' });
    for (const c of [
      CommercialClassification.PRO_ACTIVE,
      CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
    ]) {
      expect(() => s.assertPriceUsableFor({ providerPriceId: 'price_live_1' }, c)).not.toThrow();
    }
  });

  it('does not apply the live-price restriction in test mode', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_test_abc' });
    expect(() =>
      s.assertPriceUsableFor({ providerPriceId: 'price_test_1' }, CommercialClassification.DEMO),
    ).not.toThrow();
  });

  it('refuses a webhook when no signing secret is configured', () => {
    const s = build({ STRIPE_SECRET_KEY: 'sk_test_abc' });
    expect(() => s.constructWebhookEvent('{}', 'sig')).toThrow(/authenticity cannot be verified/i);
  });
});

describe('StripeWebhookService — a duplicate delivery never charges twice (S-1, S-N5)', () => {
  let service: StripeWebhookService;
  let prisma: any;
  let subs: any;

  beforeEach(() => {
    prisma = {
      providerEvent: {
        create: jest.fn().mockResolvedValue({ id: 'pe_1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoice: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      subscription: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      pharmacy: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    subs = { recordPaymentFailure: jest.fn() };
    service = new StripeWebhookService(
      prisma as unknown as PrismaService,
      audit(),
      subs as unknown as SubscriptionService,
      new StripeConfig(cfg({ STRIPE_SECRET_KEY: 'sk_test_abc' })),
    );
  });

  const event = (type: string, object: any = {}, id = 'evt_1') =>
    ({ id, type, data: { object } }) as any;

  it('records an event before acting on it', async () => {
    await service.handle(event('invoice.paid', { id: 'in_1', amount_paid: 1000 }));
    expect(prisma.providerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerEventId: 'evt_1', eventType: 'invoice.paid' }),
      }),
    );
  });

  it('marks a replayed event DUPLICATE and does not reprocess it', async () => {
    prisma.providerEvent.create.mockRejectedValue(uniqueViolation());

    const result = await service.handle(
      event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_x' }),
    );

    expect(result.status).toBe(ProviderEventStatus.DUPLICATE);
    // The critical assertion: no side effect ran for the duplicate.
    expect(subs.recordPaymentFailure).not.toHaveBeenCalled();
    expect(prisma.providerEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ProviderEventStatus.DUPLICATE } }),
    );
  });

  it('ignores an unsubscribed event type instead of guessing at it', async () => {
    const result = await service.handle(event('customer.created', {}));
    expect(result.status).toBe(ProviderEventStatus.IGNORED);
  });

  it('enters the delinquency timeline on payment failure', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_local' });
    const result = await service.handle(
      event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_x' }),
    );
    expect(result.status).toBe(ProviderEventStatus.PROCESSED);
    expect(subs.recordPaymentFailure).toHaveBeenCalledWith(null, 'sub_local');
  });

  it('clears delinquency when a late payment succeeds', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_local' });
    await service.handle(event('invoice.paid', { id: 'in_1', subscription: 'sub_x', amount_paid: 500 }));
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'ACTIVE', paymentFailedAt: null }),
      }),
    );
  });

  it('downgrades a deleted subscription to Network Core rather than removing the pharmacy (S-L1)', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub_local',
      locations: [{ pharmacyId: 'ph_1' }],
    });
    prisma.pharmacy.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });

    await service.handle(event('customer.subscription.deleted', { id: 'sub_x' }));

    expect(prisma.pharmacy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { commercialClassification: 'VERIFIED_NETWORK_CORE' },
      }),
    );
  });

  it('records a processing failure with its reason instead of dropping the event', async () => {
    prisma.subscription.findFirst.mockRejectedValue(new Error('db down'));
    const result = await service.handle(
      event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_x' }),
    );
    expect(result.status).toBe(ProviderEventStatus.FAILED);
    expect(prisma.providerEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ProviderEventStatus.FAILED, failureReason: 'db down' }),
      }),
    );
  });
});

describe('TaxService — never assumes a rate (S-M3)', () => {
  let service: TaxService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      taxDetermination: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'tx_1', ...a.data })),
        findFirst: jest.fn(),
      },
    };
    service = new TaxService(prisma as unknown as PrismaService);
  });

  const base = {
    billingProfileId: 'bp_1',
    customerCountry: 'IN',
    rateBasisPoints: 1800,
    taxableAmountMinor: 19900,
    currency: 'USD',
    treatment: 'STANDARD_RATED',
    determinedBy: 'finance-manual',
  };

  it('computes tax in integers from the supplied determination', async () => {
    const d = await service.record(base);
    // 19900 * 18% = 3582 exactly.
    expect(d.taxAmountMinor).toBe(3582);
    expect(d.rateBasisPoints).toBe(1800);
  });

  it('requires evidence of customer location', async () => {
    await expect(service.record({ ...base, customerCountry: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires attribution for the determination', async () => {
    await expect(service.record({ ...base, determinedBy: '' })).rejects.toThrow(/determinedBy/i);
  });

  it('rejects a rate above 100 percent', async () => {
    await expect(service.record({ ...base, rateBasisPoints: 10_001 })).rejects.toThrow(/10000/);
  });

  it('rejects an exempt customer carrying a positive rate', async () => {
    await expect(service.record({ ...base, taxExempt: true })).rejects.toThrow(
      /cannot carry a positive tax rate/i,
    );
  });

  it('rejects reverse charge carrying a positive rate', async () => {
    await expect(service.record({ ...base, treatment: 'REVERSE_CHARGE' })).rejects.toThrow(
      /cannot carry a positive tax rate/i,
    );
  });

  it('rounds half-up so a tax figure is reproducible', () => {
    expect(service.computeTax(1000, 1250)).toBe(125);
    expect(service.computeTax(999, 1250)).toBe(125);
    expect(service.computeTax(0, 2000)).toBe(0);
    expect(service.computeTax(1000, 0)).toBe(0);
  });

  it('reports no determination for a customer that has none', async () => {
    prisma.taxDetermination.findFirst.mockResolvedValue(null);
    expect(await service.hasDetermination('bp_1')).toBe(false);
  });
});

describe('InvoiceService — a billing document never carries patient or medicine data (S-N2)', () => {
  let service: InvoiceService;
  let prisma: any;
  let tax: TaxService;

  beforeEach(() => {
    prisma = {
      billingProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'bp_1', legalName: 'Acme Pharmacy Ltd' }) },
      invoice: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'inv_1', ...a.data })),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue({
          id: 'inv_1', totalMinor: 10000, currency: 'USD', provider: 'STRIPE',
        }),
        findMany: jest.fn(),
      },
      creditNote: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'cn_1', ...a.data })),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
      },
      taxDetermination: { findFirst: jest.fn().mockResolvedValue({ id: 'tx_1', rateBasisPoints: 2000 }) },
    };
    tax = new TaxService(prisma as unknown as PrismaService);
    service = new InvoiceService(prisma as unknown as PrismaService, audit(), tax);
  });

  const draftInput = {
    billingProfileId: 'bp_1',
    supplierLegalEntity: 'Zoiko Healthcare Inc.',
    periodStart: new Date('2026-09-01'),
    periodEnd: new Date('2026-10-01'),
    currency: 'USD',
    subtotalMinor: 19900,
    mode: ProviderMode.TEST,
  };

  it('computes tax from the recorded determination and stamps required identity fields', async () => {
    const inv = await service.draft('admin_1', draftInput);
    expect(inv.taxMinor).toBe(3980); // 19900 * 20%
    expect(inv.totalMinor).toBe(23880);
    expect(inv.supplierLegalEntity).toBe('Zoiko Healthcare Inc.');
    expect(inv.customerLegalName).toBe('Acme Pharmacy Ltd');
    expect(inv.taxDeterminationId).toBe('tx_1');
    expect(inv.invoiceNumber).toMatch(/^ZM-\d{4}-\d{6}$/);
  });

  it('refuses to invoice without a tax determination rather than assuming zero', async () => {
    prisma.taxDetermination.findFirst.mockResolvedValue(null);
    await expect(service.draft('admin_1', draftInput)).rejects.toThrow(/never assumed to be zero/i);
  });

  it('requires the verified supplier entity', async () => {
    await expect(
      service.draft('admin_1', { ...draftInput, supplierLegalEntity: '  ' }),
    ).rejects.toThrow(/supplierLegalEntity is required/i);
  });

  it('rejects an inverted service period', async () => {
    await expect(
      service.draft('admin_1', { ...draftInput, periodEnd: new Date('2026-08-01') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an approval reference for a credit note (S-N4)', async () => {
    await expect(
      service.issueCreditNote('admin_1', {
        invoiceId: 'inv_1',
        reason: CreditNoteReason.SERVICE_CREDIT,
        amountMinor: 500,
        approvalReference: '   ',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to credit more than remains creditable', async () => {
    prisma.creditNote.aggregate.mockResolvedValue({ _sum: { amountMinor: 9000 } });
    await expect(
      service.issueCreditNote('admin_1', {
        invoiceId: 'inv_1',
        reason: CreditNoteReason.BILLING_ERROR,
        amountMinor: 5000,
        approvalReference: 'FIN-1',
      }),
    ).rejects.toThrow(/exceeds the 1000 still creditable/i);
  });

  it('blocks protected data leaking into credit-note free text', async () => {
    for (const note of [
      'Refund for Prescription mix-up',
      'customer disputed the medicine name shown',
      'relates to a patient name error',
      'search query was wrong',
    ]) {
      await expect(
        service.issueCreditNote('admin_1', {
          invoiceId: 'inv_1',
          reason: CreditNoteReason.BILLING_ERROR,
          amountMinor: 100,
          approvalReference: 'FIN-1',
          note,
        }),
      ).rejects.toThrow(/never appear on a billing document/i);
    }
  });

  it('accepts a credit note that stays within commercial vocabulary', async () => {
    const cn = await service.issueCreditNote('admin_1', {
      invoiceId: 'inv_1',
      reason: CreditNoteReason.SERVICE_CREDIT,
      amountMinor: 1000,
      approvalReference: 'FIN-2026-08-01',
      note: 'SLA credit for the August availability incident',
      incidentReference: 'INC-4821',
    });
    expect(cn.amountMinor).toBe(1000);
    expect(cn.approvedByUserId).toBe('admin_1');
  });
});
