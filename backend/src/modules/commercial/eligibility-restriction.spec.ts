import { Logger } from '@nestjs/common';
import {
  CommercialClassification,
  CommercialOffer,
  SubscriptionState,
  VerificationStatus,
} from '@prisma/client';
import { SubscriptionService } from './subscription.service';
import { RENEWABLE_STATES, operatingEligibility } from './commercial.doctrine';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditWriter } from '../admin/audit.writer';
import type { PriceCatalogService } from './price-catalog.service';
import type { StripeService } from './stripe/stripe.service';

/**
 * S-B4 — a pharmacy the platform has switched off must stop being charged.
 *
 * The rule had a method and no caller, so it was enforced on paper only: a
 * pharmacy whose verification lapsed was hidden from patients and denied every
 * paid feature, and went on paying for it every month. These tests are about
 * the money, not the access — access is already covered by
 * commercial-visibility.spec.ts and is deliberately not restated here.
 */

const PRO = CommercialOffer.PHARMACY_INTELLIGENCE_PRO;

const pharmacy = (over: Partial<{
  id: string;
  verificationStatus: VerificationStatus;
  commercialClassification: CommercialClassification;
}> = {}) => ({
  id: 'ph_1',
  verificationStatus: VerificationStatus.VERIFIED,
  commercialClassification: CommercialClassification.PRO_ACTIVE,
  ...over,
});

function build(candidates: unknown[]) {
  const prisma = {
    subscription: {
      findMany: jest.fn().mockResolvedValue(candidates),
      update: jest.fn().mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data }),
      ),
    },
  } as unknown as PrismaService;

  const stripe = { cancelSubscription: jest.fn().mockResolvedValue(undefined) };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionService(
    prisma,
    audit as unknown as AuditWriter,
    {} as unknown as PriceCatalogService,
    stripe as unknown as StripeService,
  );
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { service, prisma, stripe, audit };
}

/** One subscription covering one pharmacy, as the sweep's query shapes it. */
const covering = (p: ReturnType<typeof pharmacy>, id = 'sub_1') => ({
  id,
  locations: [{ pharmacy: p }],
});

afterEach(() => jest.restoreAllMocks());

describe('S-B4: the sweep only touches what it should', () => {
  it('asks the database for renewable Pro subscriptions with live locations', async () => {
    const { service, prisma } = build([]);

    await service.restrictIneligibleSubscriptions();

    const where = (prisma.subscription.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.offer).toBe(PRO);
    expect(where.state.in).toEqual([...RENEWABLE_STATES]);
    expect(where.locations).toEqual({ some: { releasedAt: null } });
    // EVALUATION has no charge to stop; CANCELED and ELIGIBILITY_RESTRICTED are
    // already stopped. Selecting them would mean re-walking dead history hourly.
    for (const dead of [
      SubscriptionState.EVALUATION,
      SubscriptionState.CANCELED,
      SubscriptionState.ELIGIBILITY_RESTRICTED,
    ]) {
      expect(where.state.in).not.toContain(dead);
    }
  });

  it('A. leaves a verified, paying pharmacy completely alone', async () => {
    const { service, stripe, prisma } = build([covering(pharmacy())]);

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 0,
      failed: 0,
    });
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it.each([
    ['verification suspended', { verificationStatus: VerificationStatus.SUSPENDED }],
    ['verification pending', { verificationStatus: VerificationStatus.PENDING }],
    ['verification rejected', { verificationStatus: VerificationStatus.REJECTED }],
    [
      'suspended for compliance',
      { commercialClassification: CommercialClassification.SUSPENDED_COMPLIANCE },
    ],
    ['closed', { commercialClassification: CommercialClassification.CLOSED }],
  ])('B. stops renewal when the pharmacy is ineligible: %s', async (_label, over) => {
    const { service, stripe, prisma, audit } = build([covering(pharmacy(over))]);

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 1,
      failed: 0,
    });

    // The provider action: cancel at period end. Not an immediate cancellation,
    // which would forfeit time the pharmacy has already paid for, and not a
    // refund, which S-N3/S-N4 put with Finance rather than with a cron job.
    expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(stripe.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub_1' },
      data: { state: SubscriptionState.ELIGIBILITY_RESTRICTED },
    });
    expect(audit.write).toHaveBeenCalledWith(
      null,
      'commercial.subscription.eligibility_restricted',
      'Subscription',
      'sub_1',
      expect.objectContaining({ providerAction: 'cancel_at_period_end' }),
    );
  });

  it('never cancels immediately, so the paid term is honoured and nothing is refunded', async () => {
    const { service, stripe } = build([
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED })),
    ]);

    await service.restrictIneligibleSubscriptions();

    // `immediately` is left at its default. Passing true here would end the
    // term the pharmacy already paid for.
    const [, immediately] = stripe.cancelSubscription.mock.calls[0];
    expect(immediately).toBeUndefined();
  });

  it('spares a multi-location subscription while any branch is still eligible', async () => {
    // Billing covers the subscription, not the branch. One lapsed sibling must
    // not switch off a pharmacy group that is still owed the service.
    const { service, stripe } = build([
      {
        id: 'sub_multi',
        locations: [
          { pharmacy: pharmacy({ id: 'ph_bad', verificationStatus: VerificationStatus.SUSPENDED }) },
          { pharmacy: pharmacy({ id: 'ph_good' }) },
        ],
      },
    ]);

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 0,
      failed: 0,
    });
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
  });

  it('skips a subscription whose locations have all been released', async () => {
    const { service, stripe } = build([{ id: 'sub_empty', locations: [] }]);

    await service.restrictIneligibleSubscriptions();
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe('S-B4: failure, repetition and recovery', () => {
  it('D. does not record billing as stopped when the provider call fails', async () => {
    const { service, prisma, stripe } = build([
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED })),
    ]);
    stripe.cancelSubscription.mockRejectedValue(new Error('stripe unreachable'));

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 0,
      failed: 1,
    });

    // The crucial assertion: no local state claiming the renewal was blocked.
    // A row written here would be a database that says the money stopped while
    // it carries on moving.
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('D. leaves a failed one selectable, so the next run retries it', async () => {
    const { service, stripe, prisma } = build([
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED })),
    ]);
    stripe.cancelSubscription.mockRejectedValueOnce(new Error('stripe unreachable'));

    await service.restrictIneligibleSubscriptions();
    // Still ACTIVE, therefore still inside RENEWABLE_STATES, therefore selected
    // again — the retry needs no queue of its own.
    expect(prisma.subscription.update).not.toHaveBeenCalled();

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 1,
      failed: 0,
    });
    expect(stripe.cancelSubscription).toHaveBeenCalledTimes(2);
  });

  it('one pharmacy failing does not abandon the rest of the sweep', async () => {
    const { service, stripe } = build([
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED }), 'sub_a'),
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED }), 'sub_b'),
    ]);
    stripe.cancelSubscription.mockRejectedValueOnce(new Error('stripe unreachable'));

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 1,
      failed: 1,
    });
    expect(stripe.cancelSubscription).toHaveBeenCalledTimes(2);
  });

  it('C/E. a second run selects nothing, because the state is no longer renewable', async () => {
    // Idempotency comes from the query, not from a lock: once restricted, the
    // subscription leaves RENEWABLE_STATES and the sweep stops seeing it.
    const { service, stripe } = build([]);

    await expect(service.restrictIneligibleSubscriptions()).resolves.toEqual({
      restricted: 0,
      failed: 0,
    });
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
    expect(RENEWABLE_STATES).not.toContain(SubscriptionState.ELIGIBILITY_RESTRICTED);
  });

  it('E. a repeated provider call is harmless — it is an update, never a create', async () => {
    const { service, stripe, prisma } = build([
      covering(pharmacy({ verificationStatus: VerificationStatus.SUSPENDED })),
    ]);

    await service.restrictIneligibleSubscriptions();
    await service.restrictIneligibleSubscriptions();

    // Same request twice, same end state, no second subscription and no invoice.
    expect(stripe.cancelSubscription.mock.calls).toEqual([['sub_1'], ['sub_1']]);
    expect(prisma.subscription.update).toHaveBeenCalledTimes(2);
    for (const call of (prisma.subscription.update as jest.Mock).mock.calls) {
      expect(call[0].data).toEqual({ state: SubscriptionState.ELIGIBILITY_RESTRICTED });
    }
  });
});

describe('S-B4: the eligibility question itself', () => {
  it('I. an Order Form is never swept — its cure periods are contractual (S-L3)', async () => {
    const { service, prisma } = build([]);
    await service.restrictIneligibleSubscriptions();
    // Scoped to Intelligence Pro at the query, the same way advanceDelinquency
    // excludes Enterprise.
    expect((prisma.subscription.findMany as jest.Mock).mock.calls[0][0].where.offer).toBe(PRO);
    expect(PRO).not.toBe(CommercialOffer.ENTERPRISE_API_DATA);
  });

  it('I. a pilot and an enterprise classification both read as eligible', async () => {
    // Non-billable and contract-invoiced standings must not be mistaken for a
    // lapsed pharmacy by a sweep that is looking for lapsed verification.
    for (const c of [
      CommercialClassification.PILOT_NON_BILLABLE,
      CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
    ]) {
      expect(operatingEligibility(VerificationStatus.VERIFIED, c).eligible).toBe(true);
    }
  });

  it('H. a trial has no provider subscription, so there is no charge to stop', async () => {
    // EVALUATION is outside RENEWABLE_STATES, so a trial is never a candidate.
    // Its visibility and features are withdrawn by the live eligibility rule.
    expect(RENEWABLE_STATES).not.toContain(SubscriptionState.EVALUATION);
  });

  it('matches the rule the entitlement resolver uses, field for field', async () => {
    // One doctrine function, two callers. If these ever disagree, the platform
    // either charges someone it has switched off or switches off someone it is
    // still charging.
    expect(operatingEligibility(VerificationStatus.VERIFIED, CommercialClassification.PRO_ACTIVE))
      .toEqual({ eligible: true });
    expect(
      operatingEligibility(VerificationStatus.SUSPENDED, CommercialClassification.PRO_ACTIVE)
        .eligible,
    ).toBe(false);
    expect(
      operatingEligibility(
        VerificationStatus.VERIFIED,
        CommercialClassification.SUSPENDED_COMPLIANCE,
      ).eligible,
    ).toBe(false);
  });
});
