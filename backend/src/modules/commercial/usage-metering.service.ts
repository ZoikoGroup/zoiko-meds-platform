import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubscriptionState, UsageEvent, UsageExclusionReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isNeverBillableEvent } from './commercial.doctrine';

export interface RecordUsageInput {
  /** Guarantees at-most-once counting. Required — there is no implicit key. */
  idempotencyKey: string;
  metricCode: string;
  billingProfileId?: string | null;
  subscriptionId?: string | null;
  endpointClass?: string | null;
  requestId?: string | null;
  responseStatus?: number | null;
  /** Units the caller believes are billable; may be reduced to zero here. */
  units?: number;
  occurredAt?: Date;
}

/**
 * Usage metering for API, data and AI products
 * (ZM-COM-BILL-001 S-J3, S-K1, S-K2).
 *
 * Every attempt is written, billable or not, with an explicit exclusion reason.
 * The point is that a usage dispute can be answered from the record instead of
 * reconstructed: "why was I charged for this" and "why was this not counted" both
 * have stored answers.
 *
 * Nothing is billable unless the contract enables usage billing. Failures,
 * retries, denials and duplicates are recorded and excluded.
 */
@Injectable()
export class UsageMeteringService {
  private readonly logger = new Logger(UsageMeteringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordUsageInput): Promise<UsageEvent> {
    const occurredAt = input.occurredAt ?? new Date();
    const requestedUnits = Math.max(0, input.units ?? 1);

    const decision = await this.classify(input, requestedUnits);

    try {
      return await this.prisma.usageEvent.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          metricCode: input.metricCode,
          billingProfileId: input.billingProfileId ?? null,
          subscriptionId: input.subscriptionId ?? null,
          endpointClass: input.endpointClass ?? null,
          requestId: input.requestId ?? null,
          responseStatus: input.responseStatus ?? null,
          countableUnits: decision.countableUnits,
          exclusionReason: decision.exclusionReason,
          rateCardVersion: decision.rateCardVersion,
          occurredAt,
        },
      });
    } catch (err) {
      // Unique violation on idempotencyKey: the event already landed. Return the
      // stored row rather than counting a retry, which is the whole point of the
      // key — a client retry storm must not multiply a customer's bill.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.usageEvent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Decide whether this event is billable, and if not, why. Ordered from the most
   * absolute rule downwards so a doctrine-level exclusion can never be overridden
   * by contract configuration.
   */
  private async classify(
    input: RecordUsageInput,
    requestedUnits: number,
  ): Promise<{
    countableUnits: number;
    exclusionReason: UsageExclusionReason | null;
    rateCardVersion: string | null;
  }> {
    const exclude = (reason: UsageExclusionReason) => ({
      countableUnits: 0,
      exclusionReason: reason,
      rateCardVersion: null,
    });

    // 1. Events that can never be billable, whatever a contract says: patient
    //    routing, confirmation outcomes, dispensing results, failed feeds
    //    (S-A3, S-G4, S-H1, S-I1).
    if (isNeverBillableEvent(input.metricCode)) {
      return exclude(UsageExclusionReason.NOT_METERED);
    }

    // 2. Platform failure — the customer never received value (S-K2).
    const status = input.responseStatus ?? null;
    if (status !== null && status >= 500) {
      return exclude(UsageExclusionReason.PLATFORM_ERROR);
    }

    // 3. Customer error: rate-limit telemetry, not paid usage, by default (S-K2).
    if (status !== null && status >= 400) {
      return exclude(UsageExclusionReason.CLIENT_ERROR);
    }

    // 4. No subscription context means nothing to bill against.
    if (!input.subscriptionId) {
      return exclude(UsageExclusionReason.NOT_METERED);
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      select: {
        state: true,
        usageBillingEnabled: true,
        usageRateCardVersion: true,
        commercialEffectiveAt: true,
      },
    });
    if (!subscription) return exclude(UsageExclusionReason.NOT_METERED);

    // 5. Usage billing is opt-in per contract and cannot be switched on by
    //    configuration drift alone (S-K1, S-F4).
    if (!subscription.usageBillingEnabled) {
      return exclude(UsageExclusionReason.NOT_METERED);
    }
    // A metered contract with no rate card version is a misconfiguration; refusing
    // to count is safer than inventing a rate.
    if (!subscription.usageRateCardVersion) {
      this.logger.warn(
        `Subscription ${input.subscriptionId} has usage billing enabled but no rate card version; excluding usage.`,
      );
      return exclude(UsageExclusionReason.NOT_METERED);
    }

    // 6. Nothing before the commercial start date is billable (S-Q2).
    const at = input.occurredAt ?? new Date();
    if (at < subscription.commercialEffectiveAt) {
      return exclude(UsageExclusionReason.NOT_METERED);
    }

    // 7. Service blocked by ZoikoMeds policy creates no new usage charges (S-B4).
    if (
      subscription.state === SubscriptionState.ELIGIBILITY_RESTRICTED ||
      subscription.state === SubscriptionState.CANCELED
    ) {
      return exclude(UsageExclusionReason.DENIED_BY_POLICY);
    }

    return {
      countableUnits: requestedUnits,
      exclusionReason: null,
      rateCardVersion: subscription.usageRateCardVersion,
    };
  }

  /**
   * Billable total for a window, plus the excluded count so a customer-visible
   * usage report can show both (S-K3).
   */
  async summarize(input: {
    billingProfileId: string;
    from: Date;
    to: Date;
    metricCode?: string;
  }): Promise<{ countableUnits: number; excludedEvents: number; totalEvents: number }> {
    const where = {
      billingProfileId: input.billingProfileId,
      metricCode: input.metricCode,
      occurredAt: { gte: input.from, lte: input.to },
    };

    const [sum, excluded, total] = await Promise.all([
      this.prisma.usageEvent.aggregate({ where, _sum: { countableUnits: true } }),
      this.prisma.usageEvent.count({ where: { ...where, exclusionReason: { not: null } } }),
      this.prisma.usageEvent.count({ where }),
    ]);

    return {
      countableUnits: sum._sum.countableUnits ?? 0,
      excludedEvents: excluded,
      totalEvents: total,
    };
  }

  /**
   * Threshold notifications at 70/85/100 percent of the included allowance, so
   * spend never changes without warning (S-K3). Returns the highest threshold
   * crossed, or null.
   */
  thresholdCrossed(countableUnits: number, includedUnits: number | null): 70 | 85 | 100 | null {
    if (!includedUnits || includedUnits <= 0) return null;
    const pct = (countableUnits / includedUnits) * 100;
    if (pct >= 100) return 100;
    if (pct >= 85) return 85;
    if (pct >= 70) return 70;
    return null;
  }
}
