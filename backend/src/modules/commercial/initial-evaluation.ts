import { Logger } from '@nestjs/common';
import {
  BillingChannel,
  CommercialClassification,
  CommercialOffer,
  Prisma,
  SubscriptionState,
  UserRole,
  VerificationStatus,
} from '@prisma/client';
import { resolveCountryAlpha2 } from '../../common/countries';
import type { PrismaService } from '../../prisma/prisma.service';
import { PHARMACY_OPERATOR_ROLES } from '../availability/availability.visibility';
import {
  COMMERCIALLY_AUTHORISED_CLASSIFICATIONS,
  PRO_EVALUATION_DAYS,
  VISIBILITY_ENTITLING_STATES,
  subscriptionEntitlesVisibility,
} from './commercial.doctrine';

const MS_PER_DAY = 86_400_000;
const logger = new Logger('InitialEvaluation');

/**
 * The trial a pharmacy receives when it joins the network.
 *
 * The commercial rule is: a pharmacy is verified, receives a 30-day trial, and
 * after that stays listed only while it pays. Until now nothing implemented the
 * second step. An evaluation existed only if an administrator started one by
 * hand from the commercial console (POST /admin/commercial/subscriptions/
 * evaluation, admin-only, and it needs a billing profile id). So every pharmacy
 * that joined the network without that manual step held no subscription row at
 * all — and once patient visibility began requiring a live trial or a paid term,
 * every one of them was hidden.
 *
 * When "joins the network" happens: the promotion from DIRECTORY_UNCLAIMED to
 * VERIFIED_NETWORK_CORE (classification-promotion.ts). That is the first moment
 * a pharmacy is verified, located and reporting stock — the first moment it
 * could be shown to a patient at all. Starting the clock at bare licence approval
 * would spend trial days while the pharmacy cannot be listed, for want of a map
 * pin or a stock report.
 *
 * Exactly once, ever. A pharmacy that has ever held an Intelligence Pro
 * subscription — a trial that ran out, a paid term that ended, one still running
 * — is not eligible, released link or not. So a lapsed trial is never restarted,
 * nothing extends a trial, and a repeated promotion, verification retry or
 * double-submitted request finds the first trial and stops. An administrator can
 * still start a further evaluation deliberately; that path is separate and
 * audited as a manual decision.
 */

/** Why a pharmacy does not qualify for its initial trial right now. */
export type InitialEvaluationBlock =
  | 'not-verified'
  /** Any Intelligence Pro subscription, in any state, released or not. */
  | 'already-had-plan'
  /**
   * Still unclaimed, under review, enterprise, pilot, non-production, suspended
   * or closed. Only a pharmacy that has joined the network starts a trial here.
   */
  | 'not-network-core'
  /** Not located, so no distance-bounded search could list it during the trial. */
  | 'not-participating'
  /** Nobody operating it: it cannot be listed, and there is no billing contact. */
  | 'no-active-operator'
  /** A billing profile needs a country to exist at all (S-M3). */
  | 'no-billing-country';

/** What the eligibility rule reads about a pharmacy. */
export interface InitialEvaluationSubject {
  verificationStatus: VerificationStatus;
  isParticipating: boolean;
  commercialClassification: CommercialClassification;
  country: string | null;
  /** Active accounts in an operator role. */
  users: ReadonlyArray<{ email: string; role: UserRole }>;
  /** Every subscription link, released ones included. */
  subscriptionLocations: ReadonlyArray<{
    releasedAt: Date | null;
    subscription: {
      offer: CommercialOffer;
      state: SubscriptionState;
      evaluationEndsAt: Date | null;
    };
  }>;
}

/**
 * Whether this pharmacy qualifies for its initial trial, and if not, why.
 *
 * One function, used both by the grant and by the remediation report, so the
 * report's "would receive a trial" can never disagree with what the grant does.
 * The safety gates are the patient-visibility gates (PUBLIC_PHARMACY_WHERE):
 * a trial is only worth starting for a pharmacy that the trial would list.
 */
export function initialEvaluationBlockedReason(
  pharmacy: InitialEvaluationSubject,
): InitialEvaluationBlock | null {
  if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) return 'not-verified';
  if (
    pharmacy.subscriptionLocations.some(
      (link) => link.subscription.offer === CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
    )
  ) {
    return 'already-had-plan';
  }
  if (pharmacy.commercialClassification !== CommercialClassification.VERIFIED_NETWORK_CORE) {
    return 'not-network-core';
  }
  if (!pharmacy.isParticipating) return 'not-participating';
  if (pharmacy.users.length === 0) return 'no-active-operator';
  if (!resolveCountryAlpha2(pharmacy.country)) return 'no-billing-country';
  return null;
}

/** Where a pharmacy stands commercially, for the remediation report. */
export type CommercialStanding =
  | 'authorised-classification'
  | 'paid'
  | 'grace'
  | 'live-trial'
  | 'expired-trial'
  | 'ended-plan'
  | 'never-had-plan';

/**
 * Classify a pharmacy's commercial standing from its classification and links.
 *
 * Live states read unreleased links only, as visibility does; the history
 * states read every link, because a released link is exactly what records that
 * a trial or a term happened.
 */
export function commercialStanding(
  classification: CommercialClassification,
  links: InitialEvaluationSubject['subscriptionLocations'],
  now: Date = new Date(),
): CommercialStanding {
  if (COMMERCIALLY_AUTHORISED_CLASSIFICATIONS.includes(classification)) {
    return 'authorised-classification';
  }
  const live = links.filter((link) => link.releasedAt === null).map((link) => link.subscription);
  if (live.some((s) => s.state === SubscriptionState.ACTIVE)) return 'paid';
  if (
    live.some(
      (s) => s.state !== SubscriptionState.ACTIVE && VISIBILITY_ENTITLING_STATES.includes(s.state),
    )
  ) {
    return 'grace';
  }
  if (live.some((s) => s.state === SubscriptionState.EVALUATION && subscriptionEntitlesVisibility(s, now))) {
    return 'live-trial';
  }
  const pro = links
    .map((link) => link.subscription)
    .filter((s) => s.offer === CommercialOffer.PHARMACY_INTELLIGENCE_PRO);
  if (pro.some((s) => s.evaluationEndsAt !== null)) return 'expired-trial';
  if (pro.length > 0) return 'ended-plan';
  return 'never-had-plan';
}

/**
 * The columns the rule needs, plus what a billing profile is built from.
 * Shared by the grant and the report so both read the same facts.
 */
export const INITIAL_EVALUATION_SELECT = {
  id: true,
  name: true,
  country: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  verificationStatus: true,
  isParticipating: true,
  commercialClassification: true,
  users: {
    where: { isActive: true, role: { in: PHARMACY_OPERATOR_ROLES } },
    select: { email: true, role: true },
    orderBy: { createdAt: 'asc' },
  },
  subscriptionLocations: {
    select: {
      releasedAt: true,
      subscription: { select: { offer: true, state: true, evaluationEndsAt: true } },
    },
  },
} as const satisfies Prisma.PharmacySelect;

export type InitialEvaluationRow = Prisma.PharmacyGetPayload<{
  select: typeof INITIAL_EVALUATION_SELECT;
}>;

/** What started the grant, for the audit trail. */
export type InitialEvaluationTrigger = 'network-join' | 'backfill';

export type InitialEvaluationOutcome =
  | { granted: true; subscriptionId: string; evaluationEndsAt: Date }
  | { granted: false; reason: InitialEvaluationBlock | 'not-found' | 'error' };

/** The AuditWriter surface used here, structurally, so mocks fit. */
type Auditor = {
  write(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Prisma.InputJsonValue,
    ipAddress?: string,
  ): Promise<unknown>;
};

/**
 * Grant a pharmacy its initial trial, if it qualifies. Never throws.
 *
 * Safe to call any number of times, from any number of places at once:
 *
 *   - The pharmacy row is locked (SELECT … FOR UPDATE) before anything is read,
 *     so two concurrent grants for one pharmacy run one after the other. The
 *     second reads, under the lock, the trial the first committed, and stops.
 *     There is no unique constraint that could express "one trial per pharmacy
 *     ever", so the lock is what enforces it.
 *   - Eligibility is re-read under that lock, never trusted from the caller.
 *   - Billing profile, subscription, link and classification are written in the
 *     same transaction as the lock: all of them or none.
 *
 * Never throws because every caller is in the middle of something else — an
 * inventory write, a profile save, a verification decision — that must not fail
 * because a trial could not be started. A pharmacy left without one shows up in
 * the remediation report, and an administrator can grant it from there.
 */
export async function grantInitialEvaluation(
  prisma: PrismaService,
  audit: Auditor | null,
  pharmacyId: string,
  options: {
    trigger: InitialEvaluationTrigger;
    actorId?: string | null;
    ipAddress?: string;
    now?: Date;
  },
): Promise<InitialEvaluationOutcome> {
  const now = options.now ?? new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Pharmacy" WHERE id = ${pharmacyId} FOR UPDATE`;

      const pharmacy = await tx.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: INITIAL_EVALUATION_SELECT,
      });
      if (!pharmacy) return { granted: false as const, reason: 'not-found' as const };

      const blocked = initialEvaluationBlockedReason(pharmacy);
      if (blocked) return { granted: false as const, reason: blocked };

      // The checkout path builds a billing profile from the same facts
      // (pharmacy-checkout.controller.ts): the pharmacy as the legal name, its
      // country, an operator as the contact. The administrator account is the
      // contact when there is one; staff otherwise.
      const contact =
        pharmacy.users.find((u) => u.role === UserRole.PHARMACY_ADMIN) ?? pharmacy.users[0];
      const profile = await tx.billingProfile.create({
        data: {
          legalName: pharmacy.name.trim(),
          billingEmail: contact.email.trim().toLowerCase(),
          country: resolveCountryAlpha2(pharmacy.country),
          addressLine1: pharmacy.addressLine1,
          addressLine2: pharmacy.addressLine2,
          city: pharmacy.city,
          region: pharmacy.region,
          postalCode: pharmacy.postalCode,
        },
      });

      // Identical in shape to SubscriptionService.startEvaluation: no price, no
      // card, a fixed end date, and nothing that converts it to a charge (S-E3).
      const evaluationEndsAt = new Date(now.getTime() + PRO_EVALUATION_DAYS * MS_PER_DAY);
      const subscription = await tx.subscription.create({
        data: {
          billingProfileId: profile.id,
          offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
          state: SubscriptionState.EVALUATION,
          channel: BillingChannel.WEB_SELF_SERVE,
          priceCatalogEntryId: null,
          quantity: 1,
          commercialEffectiveAt: now,
          evaluationEndsAt,
        },
      });
      await tx.subscriptionLocation.create({
        data: { subscriptionId: subscription.id, pharmacyId },
      });
      await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { commercialClassification: CommercialClassification.PRO_EVALUATION },
      });

      return {
        granted: true as const,
        subscriptionId: subscription.id,
        evaluationEndsAt,
        billingProfileId: profile.id,
      };
    });

    if (!result.granted) return result;

    await audit?.write(
      options.actorId ?? null,
      'commercial.billing_profile.create',
      'BillingProfile',
      result.billingProfileId,
      { pharmacyId, automatic: true, trigger: options.trigger },
      options.ipAddress,
    );
    await audit?.write(
      options.actorId ?? null,
      'commercial.subscription.evaluation_start',
      'Subscription',
      result.subscriptionId,
      {
        pharmacyId,
        evaluationEndsAt: result.evaluationEndsAt.toISOString(),
        autoConverts: false,
        automatic: true,
        trigger: options.trigger,
      },
      options.ipAddress,
    );

    return {
      granted: true,
      subscriptionId: result.subscriptionId,
      evaluationEndsAt: result.evaluationEndsAt,
    };
  } catch (err) {
    // The message only: a database error can carry row contents.
    logger.error(
      `Initial evaluation for pharmacy ${pharmacyId} could not be granted: ` +
        `${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return { granted: false, reason: 'error' };
  }
}
