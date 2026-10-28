import { CommercialClassification, SubscriptionState, VerificationStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  PRO_DELINQUENCY_DAYS,
  PRO_EVALUATION_DAYS,
  isCommerciallyEligibleForVisibility,
  proDelinquencyState,
  subscriptionEntitlesVisibility,
} from './commercial.doctrine';
import { isPatientVisible } from '../availability/availability.visibility';
import { CommercialLifecycleScheduler } from './commercial-lifecycle.scheduler';
import type { SubscriptionService } from './subscription.service';

/**
 * The commercial lifecycle, end to end, as the business rule states it.
 *
 * A verified pharmacy is listed to patients while a trial or a paid term covers
 * it, and stops being listed when neither does. The pharmacy itself is never
 * removed — its record, inventory and billing page all survive — so every
 * "hidden" case here is about one boolean and nothing else.
 *
 * Written against the two functions that actually decide it, rather than
 * through a service: `isCommerciallyEligibleForVisibility` answers the
 * commercial half and `isPatientVisible` combines it with the safety gates, and
 * every caller in the codebase goes through one or both.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-06-01T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

/** A verified, participating, staffed pharmacy — every safety gate open. */
const SAFE: {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  hasActiveManager: boolean;
} = {
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.PRO_ACTIVE,
  hasActiveManager: true,
};

const liveTrial = {
  state: SubscriptionState.EVALUATION,
  evaluationEndsAt: inDays(PRO_EVALUATION_DAYS - 1),
};
const lapsedTrial = { state: SubscriptionState.EVALUATION, evaluationEndsAt: inDays(-1) };
const paid = { state: SubscriptionState.ACTIVE, evaluationEndsAt: null };
const cancelled = { state: SubscriptionState.CANCELED, evaluationEndsAt: null };

/** The whole rule, as a patient query would answer it. */
const visible = (
  classification: CommercialClassification,
  subscriptions: { state: SubscriptionState; evaluationEndsAt: Date | null }[],
  safety: Partial<typeof SAFE> = {},
) =>
  isPatientVisible({
    ...SAFE,
    commercialClassification: classification,
    ...safety,
    commerciallyEligible: isCommerciallyEligibleForVisibility({
      commercialClassification: classification,
      subscriptions,
      now: NOW,
    }),
  });

describe('the commercial lifecycle decides patient visibility', () => {
  it('A. a verified pharmacy on day 1 of its trial is listed', () => {
    expect(visible(CommercialClassification.PRO_EVALUATION, [liveTrial])).toBe(true);
  });

  it('B. still listed on day 29, the last day of the window', () => {
    const almostOver = {
      state: SubscriptionState.EVALUATION,
      // One hour left of the thirty days.
      evaluationEndsAt: new Date(NOW.getTime() + 3_600_000),
    };
    expect(visible(CommercialClassification.PRO_EVALUATION, [almostOver])).toBe(true);
  });

  it('C. the trial expires with no payment, and the pharmacy stops being listed', () => {
    // The classification is deliberately still PRO_EVALUATION: this is the
    // window between the trial lapsing and the sweep rewriting it, and the
    // answer must already be "not listed".
    expect(visible(CommercialClassification.PRO_EVALUATION, [lapsedTrial])).toBe(false);
    // And after the sweep has run, when the classification agrees.
    expect(visible(CommercialClassification.VERIFIED_NETWORK_CORE, [cancelled])).toBe(false);
  });

  it('C. an expired trial with no subscription at all is not listed either', () => {
    expect(visible(CommercialClassification.VERIFIED_NETWORK_CORE, [])).toBe(false);
  });

  it('D. paying after the trial expired lists the pharmacy again, with no admin step', () => {
    // Exactly what reconcileCheckoutSession leaves behind: the old link
    // released, a new ACTIVE one in its place, classification PRO_ACTIVE.
    expect(visible(CommercialClassification.PRO_ACTIVE, [paid])).toBe(true);
  });

  it('E. an active paid subscription is listed', () => {
    expect(visible(CommercialClassification.PRO_ACTIVE, [paid])).toBe(true);
  });

  describe('F/G. a payment fails, and the published delinquency timeline runs', () => {
    // Not a grace period invented here: these are the days commercial doctrine
    // already defines, and the only question this adds is when listing stops.
    const stateAfter = (days: number) => ({
      state: proDelinquencyState(days),
      evaluationEndsAt: null,
    });

    it.each([
      [0, true],
      [PRO_DELINQUENCY_DAYS.BLOCK_EXPANSION, true],
      [PRO_DELINQUENCY_DAYS.RESTRICT_PAID_FEATURES, true],
      [PRO_DELINQUENCY_DAYS.DOWNGRADE - 1, true],
      // Day 20: the subscription is cancelled, and listing stops with it.
      [PRO_DELINQUENCY_DAYS.DOWNGRADE, false],
    ])('day %i since the failure -> listed=%s', (days, expected) => {
      expect(visible(CommercialClassification.PRO_ACTIVE, [stateAfter(days)])).toBe(expected);
    });

    it('G. paying before day 20 keeps it listed throughout', () => {
      // Recovery puts the subscription back to ACTIVE (onInvoicePaid), and the
      // pharmacy was never delisted on the way.
      expect(visible(CommercialClassification.PRO_ACTIVE, [paid])).toBe(true);
    });
  });

  it('H. a cancelled subscription at end of term is not listed', () => {
    expect(visible(CommercialClassification.VERIFIED_NETWORK_CORE, [cancelled])).toBe(false);
  });

  it('I. paying does not buy a pharmacy past verification', () => {
    expect(
      visible(CommercialClassification.PRO_ACTIVE, [paid], {
        verificationStatus: VerificationStatus.SUSPENDED,
      }),
    ).toBe(false);
  });

  it('J. paying does not buy a pharmacy past leaving the network', () => {
    expect(
      visible(CommercialClassification.PRO_ACTIVE, [paid], { isParticipating: false }),
    ).toBe(false);
  });

  it('K. a suspended pharmacy is not listed however well it pays', () => {
    expect(
      visible(CommercialClassification.SUSPENDED_COMPLIANCE, [paid]),
    ).toBe(false);
  });

  it('paying does not buy a pharmacy past having nobody running it', () => {
    expect(
      visible(CommercialClassification.PRO_ACTIVE, [paid], { hasActiveManager: false }),
    ).toBe(false);
  });
});

describe('commercial eligibility, on its own', () => {
  it('reads the trial end date rather than the classification string', () => {
    expect(subscriptionEntitlesVisibility(liveTrial, NOW)).toBe(true);
    expect(subscriptionEntitlesVisibility(lapsedTrial, NOW)).toBe(false);
  });

  it('treats an evaluation with no end date as covering nothing', () => {
    // A row that cannot say when it ends cannot say it has not.
    expect(
      subscriptionEntitlesVisibility(
        { state: SubscriptionState.EVALUATION, evaluationEndsAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it('covers an Order Form and a pilot, which hold no self-serve subscription', () => {
    for (const c of [
      CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
      CommercialClassification.PILOT_NON_BILLABLE,
    ]) {
      expect(
        isCommerciallyEligibleForVisibility({
          commercialClassification: c,
          subscriptions: [],
          now: NOW,
        }),
      ).toBe(true);
    }
  });

  it('takes any one covering subscription, whatever the row order', () => {
    // The defect this closes: a stale cancelled row ahead of the live one.
    expect(
      isCommerciallyEligibleForVisibility({
        commercialClassification: CommercialClassification.PRO_ACTIVE,
        subscriptions: [cancelled, paid],
        now: NOW,
      }),
    ).toBe(true);
  });

  it('never lets an ELIGIBILITY_RESTRICTED subscription list a pharmacy', () => {
    expect(
      subscriptionEntitlesVisibility(
        { state: SubscriptionState.ELIGIBILITY_RESTRICTED, evaluationEndsAt: null },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('the lifecycle sweep is wired up and runs', () => {
  const config = (env: Record<string, string> = {}) =>
    ({ get: (k: string, d = '') => (env[k] !== undefined ? env[k] : d) }) as unknown as ConfigService;

  const subs = () =>
    ({
      expireEvaluations: jest.fn().mockResolvedValue({ expired: 2 }),
      advanceDelinquency: jest.fn().mockResolvedValue({ transitioned: 1 }),
      // S-B4: stops charging pharmacies the platform has switched off.
      restrictIneligibleSubscriptions: jest.fn().mockResolvedValue({ restricted: 3, failed: 0 }),
    }) as unknown as SubscriptionService;

  it('drives all three jobs — the whole point, since none had a caller', () => {
    const s = subs();
    return new CommercialLifecycleScheduler(config(), s).tick(NOW).then((r) => {
      expect(s.expireEvaluations).toHaveBeenCalledWith(NOW);
      expect(s.advanceDelinquency).toHaveBeenCalledWith(NOW);
      // No clock: eligibility is about the pharmacy's standing now, not elapsed time.
      expect(s.restrictIneligibleSubscriptions).toHaveBeenCalledWith();
      expect(r).toEqual({ expired: 2, transitioned: 1, restricted: 3, failed: 0 });
    });
  });

  it('survives a failing sweep rather than taking the process down', async () => {
    const failing = {
      expireEvaluations: jest.fn().mockRejectedValue(new Error('db down')),
      advanceDelinquency: jest.fn(),
      restrictIneligibleSubscriptions: jest.fn(),
    } as unknown as SubscriptionService;
    const scheduler = new CommercialLifecycleScheduler(config(), failing);
    jest.spyOn((scheduler as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(scheduler.tick(NOW)).resolves.toEqual({
      expired: 0,
      transitioned: 0,
      restricted: 0,
      failed: 0,
    });
  });

  it('starts a timer that cannot hold the process open', () => {
    const scheduler = new CommercialLifecycleScheduler(
      config({ COMMERCIAL_LIFECYCLE_ENABLED: 'true' }),
      subs(),
    );
    scheduler.onModuleInit();
    const timer = (scheduler as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timer).not.toBeNull();
    // unref'd: a sweep timer that keeps the event loop alive turns shutdown
    // into a hang and every suite importing this module into a wait.
    expect((timer as unknown as { hasRef?: () => boolean }).hasRef?.()).toBe(false);
    scheduler.onModuleDestroy();
  });

  it('is off under test and on everywhere else unless switched off', () => {
    const started = (env: Record<string, string>) => {
      const s = new CommercialLifecycleScheduler(config(env), subs());
      jest.spyOn((s as unknown as { logger: { warn: () => void; log: () => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      jest.spyOn((s as unknown as { logger: { warn: () => void; log: () => void } }).logger, 'log')
        .mockImplementation(() => undefined);
      s.onModuleInit();
      const on = (s as unknown as { timer: NodeJS.Timeout | null }).timer !== null;
      s.onModuleDestroy();
      return on;
    };

    expect(started({ NODE_ENV: 'test' })).toBe(false);
    expect(started({ NODE_ENV: 'production' })).toBe(true);
    expect(started({ NODE_ENV: 'development' })).toBe(true);
    // An explicit switch beats the NODE_ENV default, both ways.
    expect(started({ NODE_ENV: 'test', COMMERCIAL_LIFECYCLE_ENABLED: 'true' })).toBe(true);
    expect(started({ NODE_ENV: 'production', COMMERCIAL_LIFECYCLE_ENABLED: 'false' })).toBe(false);
  });
});
