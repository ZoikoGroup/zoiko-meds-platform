import { ConflictException } from '@nestjs/common';
import {
  CommercialClassification,
  CommercialOffer,
  SubscriptionState,
  UserRole,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { isPatientVisible, publicPharmacyWhere } from '../availability/availability.visibility';
import { MeService } from '../me/me.service';
import type { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import type { SignalIngestService } from '../signal/signal-ingest.service';
import {
  PRO_EVALUATION_DAYS,
  RENEWABLE_STATES,
  isCommerciallyEligibleForVisibility,
} from './commercial.doctrine';
import {
  commercialStanding,
  grantInitialEvaluation,
  initialEvaluationBlockedReason,
} from './initial-evaluation';
import { InitialEvaluationService } from './initial-evaluation.service';
import type { PriceCatalogService } from './price-catalog.service';
import type { StripeService } from './stripe/stripe.service';
import { SubscriptionService } from './subscription.service';

/**
 * The 30-day trial a pharmacy receives on joining the network.
 *
 * The defect: nothing ever created one. A trial existed only if an
 * administrator started it by hand, so once patient visibility required a live
 * trial or a paid term, every pharmacy that had joined without that step was
 * hidden. These specs hold the fix to the rule as stated — verified, then a
 * 30-day trial, then pay to stay listed — and to the two things that make a
 * free trial safe to grant automatically: it happens once per pharmacy, ever,
 * and nothing restarts or extends it.
 *
 * Run against a small database fake rather than call-by-call mocks, because the
 * properties under test are about state: how many trials exist afterwards, and
 * whether a row was left exactly as it was. The fake honours the one thing the
 * grant relies on for concurrency — `SELECT … FOR UPDATE` serialises two
 * transactions on the same pharmacy — and yields between statements, so two
 * transactions that are NOT serialised really do interleave. The control case
 * below proves it: with the lock switched off, the same race makes duplicates.
 */

const NOW = new Date('2026-10-28T09:00:00Z');
const DAY = 86_400_000;
const OPERATOR_ROLES: UserRole[] = [UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF];

interface PharmacyRow {
  id: string;
  name: string;
  country: string | null;
  addressLine1: string | null;
  city: string | null;
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  users: Array<{ email: string; role: UserRole; isActive: boolean }>;
}

/** A verified, located, operated pharmacy that has just joined the network. */
const joined = (id: string, overrides: Partial<PharmacyRow> = {}): PharmacyRow => ({
  id,
  name: `Pharmacy ${id}`,
  country: 'India',
  addressLine1: 'Kompally Main Rd',
  city: 'Hyderabad',
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
  users: [{ email: `Owner.${id}@Zoiko.in`, role: UserRole.PHARMACY_ADMIN, isActive: true }],
  ...overrides,
});

function fakeDb(options: { locking?: boolean } = {}) {
  const locking = options.locking ?? true;
  const pharmacies = new Map<string, PharmacyRow>();
  const subscriptions: any[] = [];
  const links: any[] = [];
  const billingProfiles: any[] = [];
  const locks = new Map<string, Promise<void>>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;
  // Let any other transaction run between two statements of this one.
  const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

  const subscriptionOf = (link: any) => subscriptions.find((s) => s.id === link.subscriptionId);
  const project = (p: PharmacyRow) => ({
    id: p.id,
    name: p.name,
    country: p.country,
    addressLine1: p.addressLine1,
    addressLine2: null,
    city: p.city,
    region: null,
    postalCode: null,
    verificationStatus: p.verificationStatus,
    isParticipating: p.isParticipating,
    commercialClassification: p.commercialClassification,
    users: p.users
      .filter((u) => u.isActive && OPERATOR_ROLES.includes(u.role))
      .map((u) => ({ email: u.email, role: u.role })),
    subscriptionLocations: links
      .filter((l) => l.pharmacyId === p.id)
      .map((l) => {
        const s = subscriptionOf(l);
        return {
          releasedAt: l.releasedAt,
          subscription: { offer: s.offer, state: s.state, evaluationEndsAt: s.evaluationEndsAt },
        };
      }),
  });

  function client(held: Array<() => void> | null): any {
    const write = <T>(fn: () => T) => {
      // Every write the grant makes has to be inside its transaction, or the
      // lock protects nothing and a failure half-way leaves half a trial.
      if (!held) throw new Error('write outside a transaction');
      return fn();
    };
    return {
      $queryRaw: async (_sql: TemplateStringsArray, pharmacyId: string) => {
        if (locking && held) {
          while (locks.has(pharmacyId)) await locks.get(pharmacyId);
          let release!: () => void;
          locks.set(pharmacyId, new Promise<void>((resolve) => (release = resolve)));
          held.push(() => {
            locks.delete(pharmacyId);
            release();
          });
        }
        await yieldTurn();
        return [{ id: pharmacyId }];
      },
      pharmacy: {
        findUnique: async ({ where }: any) => {
          await yieldTurn();
          const p = pharmacies.get(where.id);
          return p ? project(p) : null;
        },
        findMany: async ({ where }: any = {}) =>
          [...pharmacies.values()]
            .filter((p) => !where?.verificationStatus || p.verificationStatus === where.verificationStatus)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(project),
        update: async ({ where, data }: any) => {
          await yieldTurn();
          return write(() => Object.assign(pharmacies.get(where.id)!, data));
        },
      },
      billingProfile: {
        create: async ({ data }: any) => {
          await yieldTurn();
          return write(() => {
            const row = { id: nextId('bp'), ...data };
            billingProfiles.push(row);
            return row;
          });
        },
      },
      subscription: {
        create: async ({ data }: any) => {
          await yieldTurn();
          return write(() => {
            const row = { id: nextId('sub'), providerSubscriptionId: null, ...data };
            subscriptions.push(row);
            return row;
          });
        },
      },
      subscriptionLocation: {
        create: async ({ data }: any) => {
          await yieldTurn();
          return write(() => {
            const row = { id: nextId('link'), releasedAt: null, ...data };
            links.push(row);
            return row;
          });
        },
        // The shape startEvaluation's guard asks: a running trial on this pharmacy.
        findFirst: async ({ where }: any) => {
          await yieldTurn();
          const running = links.find((l) => {
            const s = subscriptionOf(l);
            return (
              l.pharmacyId === where.pharmacyId &&
              l.releasedAt === null &&
              s.state === where.subscription.state &&
              s.evaluationEndsAt > where.subscription.evaluationEndsAt.gt
            );
          });
          return running
            ? { subscription: { evaluationEndsAt: subscriptionOf(running).evaluationEndsAt } }
            : null;
        },
      },
    };
  }

  const prisma: any = {
    ...client(null),
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const held: Array<() => void> = [];
      try {
        return await fn(client(held));
      } finally {
        held.forEach((release) => release());
      }
    },
  };

  const seed = (row: PharmacyRow) => pharmacies.set(row.id, row);
  /** A subscription the pharmacy already holds, in any state. */
  const seedPlan = (
    pharmacyId: string,
    plan: {
      state: SubscriptionState;
      evaluationEndsAt?: Date | null;
      releasedAt?: Date | null;
      offer?: CommercialOffer;
    },
  ) => {
    const sub = {
      id: nextId('sub'),
      billingProfileId: 'bp_existing',
      offer: plan.offer ?? CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      state: plan.state,
      evaluationEndsAt: plan.evaluationEndsAt ?? null,
      providerSubscriptionId: null,
    };
    subscriptions.push(sub);
    links.push({
      id: nextId('link'),
      subscriptionId: sub.id,
      pharmacyId,
      releasedAt: plan.releasedAt ?? null,
    });
    return sub;
  };
  const snapshot = () =>
    JSON.stringify({ p: [...pharmacies.values()], subscriptions, links, billingProfiles });
  /** Listed right now, by the same predicate the operator's portal uses. */
  const listed = (pharmacyId: string, at: Date = NOW) => {
    const row = project(pharmacies.get(pharmacyId)!);
    return isPatientVisible({
      verificationStatus: row.verificationStatus,
      isParticipating: row.isParticipating,
      commercialClassification: row.commercialClassification,
      hasActiveManager: row.users.length > 0,
      commerciallyEligible: isCommerciallyEligibleForVisibility({
        commercialClassification: row.commercialClassification,
        subscriptions: row.subscriptionLocations
          .filter((l) => l.releasedAt === null)
          .map((l) => l.subscription),
        now: at,
      }),
    });
  };

  return {
    prisma: prisma as PrismaService,
    pharmacies,
    subscriptions,
    links,
    billingProfiles,
    seed,
    seedPlan,
    snapshot,
    listed,
  };
}

const auditor = () => ({ write: jest.fn().mockResolvedValue(undefined) });
const joinNetwork = (db: ReturnType<typeof fakeDb>, id: string, now: Date = NOW) =>
  grantInitialEvaluation(db.prisma, null, id, { trigger: 'network-join', now });

describe('1. a pharmacy joining the network receives its trial', () => {
  it('starts exactly one 30-day evaluation, with no price and no card', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));

    const outcome = await joinNetwork(db, 'ph_1');

    expect(outcome).toEqual({
      granted: true,
      subscriptionId: expect.any(String),
      evaluationEndsAt: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(PRO_EVALUATION_DAYS).toBe(30);
    expect(db.subscriptions).toHaveLength(1);
    expect(db.subscriptions[0]).toMatchObject({
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      state: SubscriptionState.EVALUATION,
      priceCatalogEntryId: null,
      providerSubscriptionId: null,
      commercialEffectiveAt: NOW,
      evaluationEndsAt: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(db.links).toEqual([
      expect.objectContaining({ pharmacyId: 'ph_1', releasedAt: null }),
    ]);
    expect(db.pharmacies.get('ph_1')!.commercialClassification).toBe(
      CommercialClassification.PRO_EVALUATION,
    );
  });

  it('lists the pharmacy for the trial, and not after it, unless it pays', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    expect(db.listed('ph_1')).toBe(false); // the bug: joined, and hidden

    await joinNetwork(db, 'ph_1');

    expect(db.listed('ph_1', NOW)).toBe(true);
    expect(db.listed('ph_1', new Date(NOW.getTime() + 29 * DAY))).toBe(true);
    expect(db.listed('ph_1', new Date(NOW.getTime() + 30 * DAY))).toBe(false);
  });

  it('builds the billing profile the way checkout does, from the pharmacy and its operator', async () => {
    const db = fakeDb();
    db.seed(
      joined('ph_1', {
        name: '  Zoiko Meds Pharmacy ',
        users: [
          { email: 'staff@zoiko.in', role: UserRole.PHARMACY_STAFF, isActive: true },
          { email: 'Owner@Zoiko.in', role: UserRole.PHARMACY_ADMIN, isActive: true },
        ],
      }),
    );

    await joinNetwork(db, 'ph_1');

    expect(db.billingProfiles).toEqual([
      expect.objectContaining({
        legalName: 'Zoiko Meds Pharmacy',
        // The administrator is the billing contact when there is one.
        billingEmail: 'owner@zoiko.in',
        // Stored as alpha-2, as BillingProfileService stores it.
        country: 'IN',
      }),
    ]);
    expect(db.subscriptions[0].billingProfileId).toBe(db.billingProfiles[0].id);
  });

  it('records the trial as automatic, and why it started', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    const audit = auditor();

    await grantInitialEvaluation(db.prisma, audit, 'ph_1', {
      trigger: 'network-join',
      actorId: 'admin_1',
      ipAddress: '10.0.0.1',
      now: NOW,
    });

    const start = audit.write.mock.calls.find(
      ([, action]) => action === 'commercial.subscription.evaluation_start',
    );
    expect(start).toEqual([
      'admin_1',
      'commercial.subscription.evaluation_start',
      'Subscription',
      db.subscriptions[0].id,
      {
        pharmacyId: 'ph_1',
        evaluationEndsAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
        autoConverts: false,
        automatic: true,
        trigger: 'network-join',
      },
      '10.0.0.1',
    ]);
  });

  it('never throws into the write that triggered it, and says what went wrong', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    const failing: any = {
      $transaction: async () => {
        throw new Error('connection reset');
      },
    };

    await expect(
      grantInitialEvaluation(failing, null, 'ph_1', { trigger: 'network-join', now: NOW }),
    ).resolves.toEqual({ granted: false, reason: 'error' });
  });
});

describe('2 and 10. repeated and concurrent requests start one trial, and never move it', () => {
  it('a second grant — a retry, a duplicate event — finds the first and changes nothing', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    await joinNetwork(db, 'ph_1');
    const before = db.snapshot();

    const again = await joinNetwork(db, 'ph_1', new Date(NOW.getTime() + 10 * DAY));

    expect(again).toEqual({ granted: false, reason: 'already-had-plan' });
    // Not a second trial, and not the first one pushed back ten days.
    expect(db.snapshot()).toBe(before);
  });

  it('five concurrent requests for one pharmacy create exactly one trial', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => joinNetwork(db, 'ph_1')),
    );

    expect(outcomes.filter((o) => o.granted)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.granted)).toEqual(
      Array(4).fill({ granted: false, reason: 'already-had-plan' }),
    );
    expect(db.subscriptions).toHaveLength(1);
    expect(db.links).toHaveLength(1);
    expect(db.billingProfiles).toHaveLength(1);
  });

  it('(control) without the row lock the same race does make duplicates', async () => {
    // Proves the test above can fail: what stops the duplicates is the lock,
    // not the fake happening to run one request at a time.
    const db = fakeDb({ locking: false });
    db.seed(joined('ph_1'));

    await Promise.all(Array.from({ length: 5 }, () => joinNetwork(db, 'ph_1')));

    expect(db.subscriptions.length).toBeGreaterThan(1);
  });

  it('concurrent grants for different pharmacies do not block each other out', async () => {
    const db = fakeDb();
    ['ph_1', 'ph_2', 'ph_3'].forEach((id) => db.seed(joined(id)));

    const outcomes = await Promise.all(['ph_1', 'ph_2', 'ph_3'].map((id) => joinNetwork(db, id)));

    expect(outcomes.every((o) => o.granted)).toBe(true);
    expect(db.subscriptions).toHaveLength(3);
  });

  describe('the administrator path', () => {
    const subscriptionsService = (db: ReturnType<typeof fakeDb>) =>
      new SubscriptionService(
        db.prisma,
        auditor() as unknown as AuditWriter,
        {} as PriceCatalogService,
        {} as StripeService,
      );

    it('refuses a second evaluation while one is running — a double-submitted request', async () => {
      const db = fakeDb();
      db.seed(joined('ph_1'));
      const service = subscriptionsService(db);
      const start = () =>
        service.startEvaluation('admin_1', { billingProfileId: 'bp_1', pharmacyId: 'ph_1', now: NOW });

      const results = await Promise.allSettled([start(), start()]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(ConflictException);
      expect(db.subscriptions).toHaveLength(1);
    });

    it('refuses to stack a manual evaluation on the automatic one', async () => {
      const db = fakeDb();
      db.seed(joined('ph_1'));
      await joinNetwork(db, 'ph_1');

      await expect(
        subscriptionsService(db).startEvaluation('admin_1', {
          billingProfileId: 'bp_1',
          pharmacyId: 'ph_1',
          now: new Date(NOW.getTime() + DAY),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.subscriptions).toHaveLength(1);
    });

    it('still lets an administrator deliberately start one after a trial has ended', async () => {
      // A further evaluation is a person's decision, made on purpose and
      // audited as manual. What changes is that it can no longer happen twice by
      // accident, or on top of a trial still running.
      const db = fakeDb();
      db.seed(joined('ph_1'));
      db.seedPlan('ph_1', {
        state: SubscriptionState.CANCELED,
        evaluationEndsAt: new Date(NOW.getTime() - DAY),
        releasedAt: new Date(NOW.getTime() - DAY),
      });

      await subscriptionsService(db).startEvaluation('admin_1', {
        billingProfileId: 'bp_1',
        pharmacyId: 'ph_1',
        now: NOW,
      });

      expect(db.subscriptions).toHaveLength(2);
    });
  });
});

describe('3 and 12. pharmacies already in the network: report, dry run, then backfill', () => {
  const remediation = (db: ReturnType<typeof fakeDb>, audit = auditor()) =>
    new InitialEvaluationService(db.prisma, audit as unknown as AuditWriter);

  it('the report finds a network pharmacy that never had a trial, and writes nothing', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1', { name: 'Apollo Pharmacy' }));
    const before = db.snapshot();

    const report = await remediation(db).remediationReport(NOW);

    expect(report.candidates).toEqual([{ pharmacyId: 'ph_1', name: 'Apollo Pharmacy' }]);
    expect(report.totals).toMatchObject({
      verified: 1,
      visibleBefore: 1,
      visibleAfter: 0,
      hiddenByCommercialRule: 1,
      backfillCandidates: 1,
      visibleAfterBackfill: 1,
    });
    expect(db.snapshot()).toBe(before);
  });

  it('is never granted a trial by being read, or by a dry run', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    const before = db.snapshot();

    const result = await remediation(db).backfill({ actorId: 'admin_1', now: NOW });

    expect(result).toEqual({ dryRun: true, candidates: 1, attempted: 0, granted: [], skipped: [] });
    expect(db.snapshot()).toBe(before);
  });

  it('executing grants the candidates their trial, and a second run grants nothing', async () => {
    const db = fakeDb();
    ['ph_1', 'ph_2'].forEach((id) => db.seed(joined(id)));
    const service = remediation(db);

    const first = await service.backfill({ actorId: 'admin_1', dryRun: false, now: NOW });
    const afterFirst = db.snapshot();
    const second = await service.backfill({
      actorId: 'admin_1',
      dryRun: false,
      now: new Date(NOW.getTime() + DAY),
    });

    expect(first.granted.map((g) => g.pharmacyId).sort()).toEqual(['ph_1', 'ph_2']);
    expect(first.granted.every((g) => g.evaluationEndsAt === new Date(NOW.getTime() + 30 * DAY).toISOString())).toBe(true);
    expect(second).toEqual({ dryRun: false, candidates: 0, attempted: 0, granted: [], skipped: [] });
    expect(db.snapshot()).toBe(afterFirst);
    expect(db.listed('ph_1')).toBe(true);
    expect(db.listed('ph_2')).toBe(true);
  });

  it('can be staged with a limit', async () => {
    const db = fakeDb();
    ['ph_1', 'ph_2', 'ph_3'].forEach((id) => db.seed(joined(id)));

    const result = await remediation(db).backfill({
      actorId: 'admin_1',
      dryRun: false,
      limit: 2,
      now: NOW,
    });

    expect(result.candidates).toBe(3);
    expect(result.granted).toHaveLength(2);
    expect(db.subscriptions).toHaveLength(2);
  });

  it('records the run in the audit trail', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));
    const audit = auditor();

    await remediation(db, audit).backfill({ actorId: 'admin_1', dryRun: false, now: NOW });

    expect(audit.write).toHaveBeenCalledWith(
      'admin_1',
      'commercial.evaluation.backfill',
      'Pharmacy',
      null,
      { candidates: 1, attempted: 1, granted: 1, skipped: 0 },
      undefined,
    );
  });
});

describe('4–7. what neither the grant nor the backfill may touch', () => {
  /** An estate with one pharmacy in every standing that matters. */
  function estate() {
    const db = fakeDb();
    db.seed(joined('never', { name: 'A never had a plan' }));
    db.seed(joined('trial', { name: 'B live trial', commercialClassification: CommercialClassification.PRO_EVALUATION }));
    db.seedPlan('trial', { state: SubscriptionState.EVALUATION, evaluationEndsAt: new Date(NOW.getTime() + 12 * DAY) });
    db.seed(joined('expired', { name: 'C expired trial' }));
    db.seedPlan('expired', {
      state: SubscriptionState.CANCELED,
      evaluationEndsAt: new Date(NOW.getTime() - 3 * DAY),
      releasedAt: new Date(NOW.getTime() - 3 * DAY),
    });
    db.seed(joined('paid', { name: 'D paid', commercialClassification: CommercialClassification.PRO_ACTIVE }));
    db.seedPlan('paid', { state: SubscriptionState.ACTIVE });
    db.seed(joined('grace', { name: 'E payment grace', commercialClassification: CommercialClassification.PRO_ACTIVE }));
    db.seedPlan('grace', { state: SubscriptionState.PAST_DUE });
    db.seed(joined('enterprise', { name: 'F enterprise', commercialClassification: CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE }));
    db.seed(joined('pilot', { name: 'G pilot', commercialClassification: CommercialClassification.PILOT_NON_BILLABLE }));
    db.seed(joined('unlisted', { name: 'H not participating', isParticipating: false }));
    db.seed(joined('pending', { name: 'I unverified', verificationStatus: VerificationStatus.PENDING }));
    db.seed(joined('suspended', { name: 'J suspended', verificationStatus: VerificationStatus.SUSPENDED }));
    return db;
  }

  it('4. a live trial is left exactly as it is', async () => {
    const db = estate();
    const trial = JSON.stringify(db.subscriptions.find((s) => s.state === SubscriptionState.EVALUATION));

    expect(await joinNetwork(db, 'trial')).toEqual({ granted: false, reason: 'already-had-plan' });
    await new InitialEvaluationService(db.prisma, auditor() as never).backfill({
      actorId: 'admin_1',
      dryRun: false,
      now: NOW,
    });

    expect(JSON.stringify(db.subscriptions.find((s) => s.state === SubscriptionState.EVALUATION && s.billingProfileId === 'bp_existing'))).toBe(trial);
    expect(db.listed('trial')).toBe(true);
  });

  it('5. an expired trial is not restarted, by the grant or by the backfill', async () => {
    const db = estate();

    expect(await joinNetwork(db, 'expired')).toEqual({ granted: false, reason: 'already-had-plan' });
    const report = await new InitialEvaluationService(db.prisma, auditor() as never).remediationReport(NOW);

    expect(report.candidates.map((c) => c.pharmacyId)).not.toContain('expired');
    // Hidden, and listed for a person to decide on rather than quietly re-trialled.
    expect(report.hiddenWithoutBackfill).toContainEqual(
      expect.objectContaining({ pharmacyId: 'expired', standing: 'expired-trial', reason: 'already-had-plan' }),
    );
    expect(db.listed('expired')).toBe(false);
  });

  it('6. paid, grace-period, enterprise and pilot pharmacies keep their own rules', async () => {
    const db = estate();
    const report = await new InitialEvaluationService(db.prisma, auditor() as never).remediationReport(NOW);
    const standing = (id: string) =>
      commercialStanding(
        db.pharmacies.get(id)!.commercialClassification,
        db.links
          .filter((l) => l.pharmacyId === id)
          .map((l) => ({ releasedAt: l.releasedAt, subscription: db.subscriptions.find((s) => s.id === l.subscriptionId) })),
        NOW,
      );

    expect(standing('paid')).toBe('paid');
    expect(standing('grace')).toBe('grace');
    expect(standing('enterprise')).toBe('authorised-classification');
    expect(standing('pilot')).toBe('authorised-classification');
    for (const id of ['paid', 'grace', 'enterprise', 'pilot']) {
      expect(db.listed(id)).toBe(true);
      expect(report.candidates.map((c) => c.pharmacyId)).not.toContain(id);
    }
  });

  it('7. unverified, suspended and non-participating pharmacies are never trialled or listed', async () => {
    const db = estate();

    expect(await joinNetwork(db, 'pending')).toEqual({ granted: false, reason: 'not-verified' });
    expect(await joinNetwork(db, 'suspended')).toEqual({ granted: false, reason: 'not-verified' });
    expect(await joinNetwork(db, 'unlisted')).toEqual({ granted: false, reason: 'not-participating' });
    for (const id of ['pending', 'suspended', 'unlisted']) expect(db.listed(id)).toBe(false);

    const report = await new InitialEvaluationService(db.prisma, auditor() as never).remediationReport(NOW);
    // The report is of verified pharmacies; the other two are not in it at all.
    const reported = [...report.candidates, ...report.hiddenWithoutBackfill].map((r) => r.pharmacyId);
    expect(reported).not.toContain('pending');
    expect(reported).not.toContain('suspended');
    expect(report.totals.verified).toBe(8);
  });

  it('the whole estate: only the pharmacy that never had a plan is a candidate', async () => {
    const db = estate();
    const before = new Map(db.subscriptions.map((s) => [s.id, JSON.stringify(s)]));

    const result = await new InitialEvaluationService(db.prisma, auditor() as never).backfill({
      actorId: 'admin_1',
      dryRun: false,
      now: NOW,
    });

    expect(result.granted.map((g) => g.pharmacyId)).toEqual(['never']);
    // Every subscription that existed before is byte-for-byte unchanged.
    for (const [id, row] of before) {
      expect(JSON.stringify(db.subscriptions.find((s) => s.id === id))).toBe(row);
    }
  });

  it('the report counts before and after for the estate', async () => {
    const db = estate();
    const { totals } = await new InitialEvaluationService(db.prisma, auditor() as never).remediationReport(NOW);

    expect(totals).toEqual({
      verified: 8, // never, trial, expired, paid, grace, enterprise, pilot, unlisted
      verifiedParticipating: 7,
      // Safety gates alone listed everyone verified and participating.
      visibleBefore: 7,
      // Commercial eligibility drops the two with no live plan.
      visibleAfter: 5,
      hiddenByCommercialRule: 2,
      backfillCandidates: 1,
      // The backfill restores the one that never had a trial, not the one whose
      // trial already ran.
      visibleAfterBackfill: 6,
    });
  });
});

describe('the eligibility rule, on its own', () => {
  const subject = (overrides: Partial<Parameters<typeof initialEvaluationBlockedReason>[0]> = {}) => ({
    verificationStatus: VerificationStatus.VERIFIED,
    isParticipating: true,
    commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    country: 'IN',
    users: [{ email: 'owner@zoiko.in', role: UserRole.PHARMACY_ADMIN }],
    subscriptionLocations: [],
    ...overrides,
  });

  it('admits a verified, listable, operated network pharmacy with no plan history', () => {
    expect(initialEvaluationBlockedReason(subject())).toBeNull();
  });

  it.each([
    ['DIRECTORY_UNCLAIMED', 'not-network-core'],
    ['CLAIMED_PENDING', 'not-network-core'],
    ['ENTERPRISE_CONTRACT_ACTIVE', 'not-network-core'],
    ['PILOT_NON_BILLABLE', 'not-network-core'],
    ['DEMO', 'not-network-core'],
    ['SUSPENDED_COMPLIANCE', 'not-network-core'],
  ])('refuses %s (%s)', (classification, reason) => {
    expect(
      initialEvaluationBlockedReason(
        subject({ commercialClassification: classification as CommercialClassification }),
      ),
    ).toBe(reason);
  });

  it('refuses any Pro history, even a released link to a cancelled term', () => {
    expect(
      initialEvaluationBlockedReason(
        subject({
          subscriptionLocations: [
            {
              releasedAt: NOW,
              subscription: {
                offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
                state: SubscriptionState.CANCELED,
                evaluationEndsAt: null,
              },
            },
          ],
        }),
      ),
    ).toBe('already-had-plan');
  });

  it('refuses a pharmacy nobody operates, and one with no billing country', () => {
    expect(initialEvaluationBlockedReason(subject({ users: [] }))).toBe('no-active-operator');
    expect(initialEvaluationBlockedReason(subject({ country: null }))).toBe('no-billing-country');
    expect(initialEvaluationBlockedReason(subject({ country: 'Atlantis' }))).toBe('no-billing-country');
  });
});

describe('8 and 11. one visibility rule, the dashboard count included', () => {
  /** Dates compared as "built at the time", not as instants. */
  const sameRule = (value: unknown) =>
    JSON.parse(JSON.stringify(value ?? null), (key: string, v: unknown) =>
      key === 'gt' ? '<built-at>' : v,
    );

  it("counts the patient dashboard's pharmacies by the search rule, not by VERIFIED alone", async () => {
    const prisma: any = {
      savedMedicine: { count: jest.fn().mockResolvedValue(0) },
      searchHistory: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      pharmacy: { count: jest.fn().mockResolvedValue(4) },
      alertPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const me = new MeService(
      prisma as PrismaService,
      {} as NearbyPharmacyService,
      {} as SignalIngestService,
    );

    const overview = await me.overview('user_1');

    expect(overview.summary.verifiedPharmacies).toBe(4);
    expect(sameRule(prisma.pharmacy.count.mock.calls[0][0].where)).toEqual(
      sameRule(publicPharmacyWhere()),
    );
  });
});

describe('9. S-B4 billing restrictions are unaffected', () => {
  it('a granted trial is not a renewable state and has nothing the provider could charge', async () => {
    const db = fakeDb();
    db.seed(joined('ph_1'));

    await joinNetwork(db, 'ph_1');

    // restrictIneligibleSubscriptions searches RENEWABLE_STATES only.
    expect(RENEWABLE_STATES).not.toContain(SubscriptionState.EVALUATION);
    expect(db.subscriptions[0].providerSubscriptionId).toBeNull();
    expect(db.subscriptions[0].priceCatalogEntryId).toBeNull();
  });
});
