import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingChannel,
  BillingInterval,
  CommercialClassification,
  CommercialOffer,
  Subscription,
  SubscriptionState,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { PriceCatalogService } from './price-catalog.service';
import { StripeService } from './stripe/stripe.service';
import {
  PRO_DELINQUENCY_DAYS,
  PRO_EVALUATION_DAYS,
  RENEWABLE_STATES,
  operatingEligibility,
  isNonProductionClassification,
  proDelinquencyState,
  reasonsConversionBlocked,
  billingPeriodEnd,
} from './commercial.doctrine';

const MS_PER_DAY = 86_400_000;

/**
 * Subscription lifecycle for Intelligence Pro and Enterprise
 * (ZM-COM-BILL-001 S-C, S-E, S-L).
 *
 * Every state change is explicit and audited. Nothing here infers a commercial
 * outcome from operational telemetry: adding a location, failing a payment and
 * losing verification are separate transitions with separate rules.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly priceCatalog: PriceCatalogService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Start a Pro evaluation: 30 days, verified location only, no card, and no
   * auto-conversion at expiry (S-E3).
   */
  async startEvaluation(
    actorId: string,
    input: { billingProfileId: string; pharmacyId: string; now?: Date },
  ): Promise<Subscription> {
    const now = input.now ?? new Date();
    const pharmacy = await this.requirePharmacy(input.pharmacyId);

    if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Only a verified pharmacy location may start an Intelligence Pro evaluation.',
      );
    }
    if (isNonProductionClassification(pharmacy.commercialClassification)) {
      throw new ForbiddenException(
        `${pharmacy.commercialClassification} is a non-production entity and cannot hold a commercial subscription.`,
      );
    }

    const subscription = await this.prisma.$transaction(async (tx) => {
      // A double-submitted request, or two administrators at once, must not
      // leave two overlapping trials. Serialise on the pharmacy row, then
      // refuse while a trial is still running — including the one granted
      // automatically on joining the network. Starting a further evaluation
      // after one has ended remains a deliberate administrator decision.
      await tx.$queryRaw`SELECT id FROM "Pharmacy" WHERE id = ${input.pharmacyId} FOR UPDATE`;
      const running = await tx.subscriptionLocation.findFirst({
        where: {
          pharmacyId: input.pharmacyId,
          releasedAt: null,
          subscription: { state: SubscriptionState.EVALUATION, evaluationEndsAt: { gt: now } },
        },
        select: { subscription: { select: { evaluationEndsAt: true } } },
      });
      if (running) {
        throw new ConflictException(
          'This pharmacy already has an Intelligence Pro evaluation running until ' +
            `${running.subscription.evaluationEndsAt?.toISOString()}.`,
        );
      }

      const created = await tx.subscription.create({
        data: {
          billingProfileId: input.billingProfileId,
          offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
          state: SubscriptionState.EVALUATION,
          channel: BillingChannel.WEB_SELF_SERVE,
          // No price is attached: an evaluation is not a charge, and attaching one
          // would make it look like a priced term in finance reporting.
          priceCatalogEntryId: null,
          quantity: 1,
          commercialEffectiveAt: now,
          evaluationEndsAt: new Date(now.getTime() + PRO_EVALUATION_DAYS * MS_PER_DAY),
        },
      });

      await tx.subscriptionLocation.create({
        data: { subscriptionId: created.id, pharmacyId: input.pharmacyId },
      });

      await tx.pharmacy.update({
        where: { id: input.pharmacyId },
        data: { commercialClassification: CommercialClassification.PRO_EVALUATION },
      });

      return created;
    });

    await this.audit.write(actorId, 'commercial.subscription.evaluation_start', 'Subscription', subscription.id, {
      pharmacyId: input.pharmacyId,
      evaluationEndsAt: subscription.evaluationEndsAt?.toISOString(),
      autoConverts: false,
    });

    return subscription;
  }

  /**
   * Convert to paid Pro. Every precondition in S-Q3 is checked before a live
   * charge can exist, and the resolved catalog price is recorded on the
   * subscription so the invoice is reproducible.
   */
  async activatePro(
    actorId: string,
    input: {
      billingProfileId: string;
      pharmacyId: string;
      market: string;
      currency: string;
      interval?: BillingInterval;
      channel?: BillingChannel;
      hasAuthorizedPayer: boolean;
      hasTaxDetermination: boolean;
      termsAccepted: boolean;
      now?: Date;
    },
  ): Promise<Subscription> {
    const now = input.now ?? new Date();
    const pharmacy = await this.requirePharmacy(input.pharmacyId);
    const interval = input.interval ?? BillingInterval.MONTH;
    const channel = input.channel ?? BillingChannel.WEB_SELF_SERVE;

    // Fails closed when no approved price exists for this market (S-E2, S-M2).
    const price = await this.priceCatalog.requirePrice({
      offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
      market: input.market,
      currency: input.currency,
      interval,
      channel,
      at: now,
    });

    const profile = await this.prisma.billingProfile.findUnique({
      where: { id: input.billingProfileId },
    });

    const blocked = reasonsConversionBlocked({
      verificationStatus: pharmacy.verificationStatus,
      classification: pharmacy.commercialClassification,
      hasAuthorizedPayer: input.hasAuthorizedPayer,
      hasApprovedCatalogPrice: true,
      hasBillingProfile: !!profile,
      hasTaxDetermination: input.hasTaxDetermination,
      termsAccepted: input.termsAccepted,
    });
    if (blocked.length > 0) {
      throw new ForbiddenException(
        `Commercial conversion blocked: ${blocked.join(' ')}`,
      );
    }

    // A self-serve paid plan must be chargeable before it activates. Without this
    // the pharmacy would land on PRO_ACTIVE with no provider subscription behind
    // it — entitled to paid intelligence that nobody is ever billed for.
    //
    // Sales contracts are exempt: an Order Form may be Finance-invoiced rather
    // than collected through the provider (S-N1), so they legitimately have no
    // provider subscription.
    const financeInvoiced = channel === BillingChannel.SALES_CONTRACT;
    if (!financeInvoiced) {
      const chargingBlocked = this.stripe.chargingBlockedReason();
      if (chargingBlocked) {
        throw new ForbiddenException(
          `Cannot activate a paid plan that cannot be charged: ${chargingBlocked} ` +
            'Use a SALES_CONTRACT channel for a Finance-invoiced agreement.',
        );
      }
      // Also fails closed when the catalog record has no provider price yet.
      this.stripe.assertPriceUsableFor(price, pharmacy.commercialClassification);
    }

    const subscription = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          billingProfileId: input.billingProfileId,
          offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
          state: SubscriptionState.ACTIVE,
          channel,
          priceCatalogEntryId: price.id,
          quantity: 1,
          // Obligation starts now; nothing earlier is billable (S-Q2).
          commercialEffectiveAt: now,
          currentPeriodStart: now,
          currentPeriodEnd: this.periodEnd(now, interval),
        },
      });

      await tx.subscriptionLocation.upsert({
        where: {
          subscriptionId_pharmacyId: {
            subscriptionId: created.id,
            pharmacyId: input.pharmacyId,
          },
        },
        create: { subscriptionId: created.id, pharmacyId: input.pharmacyId },
        update: { releasedAt: null },
      });

      await tx.pharmacy.update({
        where: { id: input.pharmacyId },
        data: { commercialClassification: CommercialClassification.PRO_ACTIVE },
      });

      return created;
    });

    // The price is now referenced by a live commercial term and must not change.
    await this.priceCatalog.lock(price.id, actorId);

    // Create the provider subscription so the charge actually exists. If this
    // fails the local record is rolled back to an unbilled state rather than left
    // as PRO_ACTIVE with nothing behind it — a pharmacy must never hold paid
    // entitlement the platform cannot bill.
    let providerSubscriptionId: string | null = null;
    if (!financeInvoiced) {
      try {
        providerSubscriptionId = await this.stripe.createSubscription({
          subscriptionId: subscription.id,
          billingProfileId: input.billingProfileId,
          providerPriceId: price.providerPriceId as string,
          quantity: 1,
          classification: CommercialClassification.PRO_ACTIVE,
        });
      } catch (err) {
        await this.rollbackFailedActivation(subscription.id, input.pharmacyId);
        const detail = err instanceof Error ? err.message : String(err);
        throw new ForbiddenException(
          `Payment provider rejected the subscription, so the plan was not activated: ${detail}`,
        );
      }
    }

    await this.audit.write(actorId, 'commercial.subscription.pro_activate', 'Subscription', subscription.id, {
      pharmacyId: input.pharmacyId,
      priceCatalogEntryId: price.id,
      amountMinor: price.amountMinor,
      currency: price.currency,
      market: price.market,
      catalogVersion: price.catalogVersion,
      commercialEffectiveAt: subscription.commercialEffectiveAt.toISOString(),
      providerSubscriptionId,
      financeInvoiced,
    });

    return this.prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
  }

  /**
   * Undo a local activation whose provider subscription could not be created.
   * Reverts the pharmacy to free participation instead of leaving it entitled to
   * paid features with no billing behind them.
   */
  private async rollbackFailedActivation(subscriptionId: string, pharmacyId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { state: SubscriptionState.CANCELED, canceledAt: new Date() },
      });
      await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE },
      });
    });
    await this.audit.write(null, 'commercial.subscription.activation_rolled_back', 'Subscription', subscriptionId, {
      pharmacyId,
      reason: 'Provider subscription creation failed; paid entitlement withdrawn.',
    });
  }

  /**
   * Add a verified location to an existing paid subscription. Activates
   * immediately and prorates to the renewal anchor (S-C2). Blocked while the
   * account is delinquent past day 7 (S-L1).
   */
  async addLocation(
    actorId: string,
    input: { subscriptionId: string; pharmacyId: string; now?: Date },
  ): Promise<{ subscription: Subscription; prorationAmountMinor: number }> {
    const now = input.now ?? new Date();
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      include: { priceCatalogEntry: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    if (
      subscription.state === SubscriptionState.EXPANSION_BLOCKED ||
      subscription.state === SubscriptionState.PAID_FEATURES_RESTRICTED ||
      subscription.state === SubscriptionState.CANCELED
    ) {
      throw new ForbiddenException(
        'Paid location expansion is blocked while the account has an unresolved payment failure.',
      );
    }

    const pharmacy = await this.requirePharmacy(input.pharmacyId);
    if (pharmacy.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ForbiddenException('Only a verified location may be added to a paid subscription.');
    }

    const prorationAmountMinor = this.prorate(
      subscription.priceCatalogEntry?.amountMinor ?? 0,
      now,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionLocation.upsert({
        where: {
          subscriptionId_pharmacyId: {
            subscriptionId: subscription.id,
            pharmacyId: input.pharmacyId,
          },
        },
        create: {
          subscriptionId: subscription.id,
          pharmacyId: input.pharmacyId,
          prorationAmountMinor,
        },
        update: { releasedAt: null, prorationAmountMinor },
      });

      // Quantity is always recomputed from active locations, never incremented
      // blindly, so it can be reconciled against real locations (S-C1).
      const activeCount = await tx.subscriptionLocation.count({
        where: { subscriptionId: subscription.id, releasedAt: null },
      });

      const sub = await tx.subscription.update({
        where: { id: subscription.id },
        data: { quantity: activeCount },
      });

      await tx.pharmacy.update({
        where: { id: input.pharmacyId },
        data: { commercialClassification: CommercialClassification.PRO_ACTIVE },
      });

      return sub;
    });

    // Keep the provider quantity in step so the next invoice bills the right
    // number of locations. Additions prorate to the renewal anchor (S-C2).
    await this.stripe.updateQuantity(subscription.id, updated.quantity).catch((err) => {
      this.logger.error(
        `Provider quantity sync failed for subscription ${subscription.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    await this.audit.write(actorId, 'commercial.subscription.location_activate', 'Subscription', subscription.id, {
      pharmacyId: input.pharmacyId,
      quantity: updated.quantity,
      prorationAmountMinor,
    });

    return { subscription: updated, prorationAmountMinor };
  }

  /**
   * Release a location. Operational capacity frees immediately; the billed
   * quantity reduces at renewal and no automatic refund is issued (S-C3).
   */
  async releaseLocation(
    actorId: string,
    input: { subscriptionId: string; pharmacyId: string; now?: Date },
  ): Promise<{ activeLocations: number; refundIssued: false }> {
    const now = input.now ?? new Date();

    const activeLocations = await this.prisma.$transaction(async (tx) => {
      const link = await tx.subscriptionLocation.findUnique({
        where: {
          subscriptionId_pharmacyId: {
            subscriptionId: input.subscriptionId,
            pharmacyId: input.pharmacyId,
          },
        },
      });
      if (!link) throw new NotFoundException('Location is not part of this subscription');

      await tx.subscriptionLocation.update({
        where: { id: link.id },
        data: { releasedAt: now },
      });

      // Falls back to free participation rather than losing network presence.
      await tx.pharmacy.update({
        where: { id: input.pharmacyId },
        data: { commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE },
      });

      return tx.subscriptionLocation.count({
        where: { subscriptionId: input.subscriptionId, releasedAt: null },
      });
    });

    // Reduce the billed quantity going forward. No refund is issued for the
    // remainder of the paid term (S-C3).
    await this.stripe.updateQuantity(input.subscriptionId, activeLocations).catch((err) => {
      this.logger.error(
        `Provider quantity sync failed for subscription ${input.subscriptionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    await this.audit.write(actorId, 'commercial.subscription.location_release', 'Subscription', input.subscriptionId, {
      pharmacyId: input.pharmacyId,
      activeLocations,
      // Recorded explicitly so nobody later assumes release implies a refund.
      automaticRefund: false,
      note: 'Billed quantity reduces at renewal; refunds require an approved exception.',
    });

    return { activeLocations, refundIssued: false };
  }

  /** Record a payment failure and enter the recovery timeline (S-L1). */
  async recordPaymentFailure(
    actorId: string | null,
    subscriptionId: string,
    now = new Date(),
  ): Promise<Subscription> {
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { state: SubscriptionState.PAST_DUE, paymentFailedAt: now },
    });
    await this.audit.write(actorId, 'commercial.subscription.payment_failed', 'Subscription', subscriptionId, {
      at: now.toISOString(),
    });
    return updated;
  }

  /**
   * Advance the delinquency timeline. Intended to run on a schedule.
   *
   * Two rules matter: Enterprise is skipped entirely because its cure periods are
   * contractual (S-L3), and downgrading never touches Network Core participation —
   * the pharmacy drops to the free tier rather than out of the network (S-L1).
   */
  async advanceDelinquency(now = new Date()): Promise<{ transitioned: number }> {
    const delinquent = await this.prisma.subscription.findMany({
      where: {
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        paymentFailedAt: { not: null },
        state: {
          in: [
            SubscriptionState.PAST_DUE,
            SubscriptionState.EXPANSION_BLOCKED,
            SubscriptionState.PAID_FEATURES_RESTRICTED,
          ],
        },
      },
      include: { locations: { where: { releasedAt: null } } },
    });

    let transitioned = 0;

    for (const sub of delinquent) {
      const days = Math.floor((now.getTime() - sub.paymentFailedAt!.getTime()) / MS_PER_DAY);
      const target = proDelinquencyState(days);
      if (target === sub.state) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            state: target,
            canceledAt: target === SubscriptionState.CANCELED ? now : null,
          },
        });

        if (target === SubscriptionState.CANCELED) {
          // Same reason as expireEvaluations: a cancelled term stops covering
          // its locations, and saying so here keeps the "which subscription
          // governs this pharmacy" question answerable.
          await tx.subscriptionLocation.updateMany({
            where: { subscriptionId: sub.id, releasedAt: null },
            data: { releasedAt: now },
          });
          for (const loc of sub.locations) {
            const pharmacy = await tx.pharmacy.findUnique({
              where: { id: loc.pharmacyId },
              select: { verificationStatus: true },
            });
            // Only an eligible pharmacy keeps free participation; an ineligible
            // one is left to the verification workflow rather than promoted here.
            await tx.pharmacy.update({
              where: { id: loc.pharmacyId },
              data: {
                commercialClassification:
                  pharmacy?.verificationStatus === VerificationStatus.VERIFIED
                    ? CommercialClassification.VERIFIED_NETWORK_CORE
                    : CommercialClassification.VERIFICATION_IN_REVIEW,
              },
            });
          }
        }
      });

      await this.audit.write(null, 'commercial.subscription.delinquency_advance', 'Subscription', sub.id, {
        daysSinceFailure: days,
        from: sub.state,
        to: target,
        networkCorePreserved: true,
      });
      transitioned += 1;
    }

    return { transitioned };
  }

  /**
   * Expire evaluations. Reverts to Network Core — never converts to paid, because
   * an evaluation carries no payment authorization (S-E3).
   */
  async expireEvaluations(now = new Date()): Promise<{ expired: number }> {
    const due = await this.prisma.subscription.findMany({
      where: {
        state: SubscriptionState.EVALUATION,
        evaluationEndsAt: { lte: now },
      },
      include: { locations: { where: { releasedAt: null } } },
    });

    for (const sub of due) {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { state: SubscriptionState.CANCELED, canceledAt: now },
        });
        // Release them. A location left unreleased keeps claiming to be covered
        // by a subscription that has ended, and every later reader that asks
        // "which subscription governs this pharmacy" has to pick between a dead
        // row and a live one. Releasing here is what makes that question have a
        // single answer.
        await tx.subscriptionLocation.updateMany({
          where: { subscriptionId: sub.id, releasedAt: null },
          data: { releasedAt: now },
        });
        for (const loc of sub.locations) {
          await tx.pharmacy.update({
            where: { id: loc.pharmacyId },
            data: { commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE },
          });
        }
      });

      await this.audit.write(null, 'commercial.subscription.evaluation_expired', 'Subscription', sub.id, {
        revertedTo: CommercialClassification.VERIFIED_NETWORK_CORE,
        autoConverted: false,
      });
    }

    return { expired: due.length };
  }

  /**
   * Verification lapsed: restrict paid intelligence and prevent renewal into a new
   * paid term, without creating new charges while ZoikoMeds policy blocks the
   * service (S-B4).
   */
  async restrictForEligibility(
    actorId: string | null,
    subscriptionId: string,
  ): Promise<Subscription> {
    // The provider call comes FIRST, and the local state only follows if it
    // succeeded.
    //
    // This method used to write ELIGIBILITY_RESTRICTED and stop, which recorded
    // "renewal blocked" without blocking any renewal: Stripe had never been
    // told, so the next period was charged anyway. Writing the row first would
    // reproduce that in a subtler way — a failed provider call leaving a
    // database that says billing is stopped while the money keeps moving. If
    // the call throws, nothing is persisted, the subscription stays in a
    // renewable state, and the next sweep retries it.
    //
    // Nothing is lost by ordering it this way: patient visibility and paid
    // features are already denied live by the eligibility rule, so the window
    // between the two is a billing window only.
    await this.stripe.cancelSubscription(subscriptionId);

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { state: SubscriptionState.ELIGIBILITY_RESTRICTED },
    });
    await this.audit.write(actorId, 'commercial.subscription.eligibility_restricted', 'Subscription', subscriptionId, {
      reason: 'Verification or credential lapsed; renewal blocked pending re-verification.',
      // Named so an operator reading the log knows the paid term was honoured
      // rather than cut short — no refund, no forfeited time.
      providerAction: 'cancel_at_period_end',
    });
    return updated;
  }

  /**
   * Stop billing every pharmacy that policy has switched off (S-B4).
   *
   * The sweep half of `restrictForEligibility`, which takes one subscription id
   * and therefore could never be scheduled. Without it the rule existed only on
   * paper: a pharmacy whose verification lapsed was hidden from patients and
   * denied every paid feature, and went on being charged monthly for it.
   *
   * Scoped tightly on purpose. Only Intelligence Pro — an Order Form's cure
   * periods are contractual and must never inherit this schedule (S-L3), the
   * same reason `advanceDelinquency` filters the offer. Only states the
   * provider can still raise a charge from, so the query does not walk years of
   * cancelled history every hour. Only subscriptions whose locations are still
   * unreleased, because a released location is one this subscription no longer
   * covers.
   *
   * Safe to run repeatedly: a subscription that has already been restricted is
   * no longer in RENEWABLE_STATES, so the next pass does not select it, and the
   * provider call underneath is an idempotent update rather than a create.
   */
  async restrictIneligibleSubscriptions(): Promise<{ restricted: number; failed: number }> {
    // No `now` parameter, unlike its two siblings: eligibility is a question
    // about the pharmacy's current standing, not about elapsed time, so there
    // is no clock to inject or to freeze in a test.
    const candidates = await this.prisma.subscription.findMany({
      where: {
        offer: CommercialOffer.PHARMACY_INTELLIGENCE_PRO,
        state: { in: [...RENEWABLE_STATES] },
        locations: { some: { releasedAt: null } },
      },
      select: {
        id: true,
        locations: {
          where: { releasedAt: null },
          select: {
            pharmacy: {
              select: { id: true, verificationStatus: true, commercialClassification: true },
            },
          },
        },
      },
    });

    let restricted = 0;
    let failed = 0;

    for (const subscription of candidates) {
      // Every location this subscription still covers has to be ineligible
      // before its billing stops. A multi-location subscription with one good
      // branch is still owed the service it pays for, and cutting it off
      // because a sibling lapsed would be the platform's mistake, not the
      // pharmacy's.
      const pharmacies = subscription.locations.map((l) => l.pharmacy);
      if (pharmacies.length === 0) continue;
      const allIneligible = pharmacies.every(
        (p) => !operatingEligibility(p.verificationStatus, p.commercialClassification).eligible,
      );
      if (!allIneligible) continue;

      try {
        await this.restrictForEligibility(null, subscription.id);
        restricted += 1;
      } catch (err) {
        // One pharmacy's provider failure must not abandon the rest of the
        // sweep, and it must not be recorded as success. The subscription stays
        // in a renewable state, so the next run selects it again.
        failed += 1;
        this.logger.error(
          `Could not stop billing for subscription ${subscription.id}: ` +
            `${err instanceof Error ? err.message : 'unknown provider error'}`,
        );
      }
    }

    return { restricted, failed };
  }

  private periodEnd(start: Date, interval: BillingInterval): Date {
    // Delegated, not duplicated: the webhook path creates paid terms too, and
    // two copies of this arithmetic is two renewal dates for the same plan.
    return billingPeriodEnd(start, interval);
  }

  /**
   * Straight-line proration of one unit across the remaining period. Rounded up so
   * the platform never under-charges by a fraction of a cent, and clamped to the
   * full amount.
   */
  private prorate(
    unitAmountMinor: number,
    now: Date,
    periodStart: Date | null,
    periodEnd: Date | null,
  ): number {
    if (!periodStart || !periodEnd || unitAmountMinor <= 0) return 0;
    const total = periodEnd.getTime() - periodStart.getTime();
    if (total <= 0) return 0;
    const remaining = Math.max(0, periodEnd.getTime() - now.getTime());
    return Math.min(unitAmountMinor, Math.ceil((remaining / total) * unitAmountMinor));
  }

  private async requirePharmacy(pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: {
        id: true,
        verificationStatus: true,
        commercialClassification: true,
      },
    });
    if (!pharmacy) throw new BadRequestException('Pharmacy not found');
    return pharmacy;
  }
}
