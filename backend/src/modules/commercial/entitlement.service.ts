import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  CommercialClassification,
  SubscriptionState,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { participatesInNetworkCore } from './commercial.doctrine';

/**
 * Feature keys the platform gates on. Deliberately coarse and named after
 * capabilities rather than plans, so a feature can be re-priced without renaming
 * the check that protects it.
 */
export enum CommercialFeature {
  // Network Core — free for every verified participating pharmacy (S-D2).
  VERIFIED_PROFILE = 'VERIFIED_PROFILE',
  AVAILABILITY_SIGNALS = 'AVAILABILITY_SIGNALS',
  MANUAL_INVENTORY_FEED = 'MANUAL_INVENTORY_FEED',
  CONFIRMATION_REQUEST_ROUTING = 'CONFIRMATION_REQUEST_ROUTING',
  VISIBILITY_CONTROLS = 'VISIBILITY_CONTROLS',
  // Intelligence Pro (S-E1).
  LOCAL_DEMAND_DASHBOARD = 'LOCAL_DEMAND_DASHBOARD',
  UNFULFILLED_SEARCH_INSIGHTS = 'UNFULFILLED_SEARCH_INSIGHTS',
  RESTOCK_SIGNAL_ANALYTICS = 'RESTOCK_SIGNAL_ANALYTICS',
  ADVANCED_REQUEST_ROUTING = 'ADVANCED_REQUEST_ROUTING',
  ANALYTICS_EXPORT = 'ANALYTICS_EXPORT',
  ADVANCED_CONNECTORS = 'ADVANCED_CONNECTORS',
  // Enterprise (S-F1).
  MULTI_LOCATION_GOVERNANCE = 'MULTI_LOCATION_GOVERNANCE',
  HEADLESS_API = 'HEADLESS_API',
  AGGREGATE_INTELLIGENCE = 'AGGREGATE_INTELLIGENCE',
  DATA_RESIDENCY = 'DATA_RESIDENCY',
}

const NETWORK_CORE_FEATURES: readonly CommercialFeature[] = [
  CommercialFeature.VERIFIED_PROFILE,
  CommercialFeature.AVAILABILITY_SIGNALS,
  CommercialFeature.MANUAL_INVENTORY_FEED,
  CommercialFeature.CONFIRMATION_REQUEST_ROUTING,
  CommercialFeature.VISIBILITY_CONTROLS,
];

const PRO_FEATURES: readonly CommercialFeature[] = [
  ...NETWORK_CORE_FEATURES,
  CommercialFeature.LOCAL_DEMAND_DASHBOARD,
  CommercialFeature.UNFULFILLED_SEARCH_INSIGHTS,
  CommercialFeature.RESTOCK_SIGNAL_ANALYTICS,
  CommercialFeature.ADVANCED_REQUEST_ROUTING,
  CommercialFeature.ANALYTICS_EXPORT,
  CommercialFeature.ADVANCED_CONNECTORS,
];

const ENTERPRISE_FEATURES: readonly CommercialFeature[] = [
  ...PRO_FEATURES,
  CommercialFeature.MULTI_LOCATION_GOVERNANCE,
  CommercialFeature.HEADLESS_API,
  CommercialFeature.AGGREGATE_INTELLIGENCE,
  CommercialFeature.DATA_RESIDENCY,
];

/**
 * Features withdrawn when paid features are restricted for non-payment (S-L1).
 * Network Core capability is deliberately untouched: a verified pharmacy must not
 * vanish from the availability network because an analytics payment failed.
 */
const RESTRICTED_ON_DELINQUENCY: readonly CommercialFeature[] = [
  CommercialFeature.ANALYTICS_EXPORT,
  CommercialFeature.LOCAL_DEMAND_DASHBOARD,
  CommercialFeature.UNFULFILLED_SEARCH_INSIGHTS,
  CommercialFeature.RESTOCK_SIGNAL_ANALYTICS,
];

export interface EntitlementResult {
  pharmacyId: string;
  classification: CommercialClassification;
  /** Commercial grant — what was purchased. */
  features: CommercialFeature[];
  /** Eligibility — whether the pharmacy may operate at all, regardless of payment. */
  eligible: boolean;
  eligibilityReason?: string;
  /** Whether the pharmacy still appears in the free availability network. */
  participatesInNetworkCore: boolean;
}

/**
 * Resolves what a pharmacy is commercially entitled to, server-side (S-2, S-B4).
 *
 * The central rule: commercial entitlement and operational eligibility are
 * different questions and are answered separately. A paid pharmacy with expired
 * credentials is entitled to Pro features and simultaneously ineligible to use
 * them; conflating the two either lets an unverified pharmacy publish availability
 * or punishes a verified one for a billing problem.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForPharmacy(pharmacyId: string): Promise<EntitlementResult> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: {
        id: true,
        verificationStatus: true,
        commercialClassification: true,
        subscriptionLocations: {
          where: { releasedAt: null },
          select: { subscription: { select: { state: true, offer: true } } },
        },
      },
    });

    if (!pharmacy) {
      return {
        pharmacyId,
        classification: CommercialClassification.DIRECTORY_UNCLAIMED,
        features: [],
        eligible: false,
        eligibilityReason: 'Pharmacy not found.',
        participatesInNetworkCore: false,
      };
    }

    const classification = pharmacy.commercialClassification;
    const subscriptionState = pharmacy.subscriptionLocations[0]?.subscription.state ?? null;

    let features = this.featuresFor(classification);

    // Delinquency withdraws paid analytics but never Network Core (S-L1).
    if (
      subscriptionState === SubscriptionState.PAID_FEATURES_RESTRICTED ||
      subscriptionState === SubscriptionState.CANCELED
    ) {
      features = features.filter((f) => !RESTRICTED_ON_DELINQUENCY.includes(f));
    }

    const eligibility = this.eligibility(pharmacy.verificationStatus, classification);

    return {
      pharmacyId: pharmacy.id,
      classification,
      features,
      eligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      participatesInNetworkCore: participatesInNetworkCore(classification),
    };
  }

  /** Commercial grant for a classification, before eligibility is considered. */
  featuresFor(classification: CommercialClassification): CommercialFeature[] {
    switch (classification) {
      case CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE:
        return [...ENTERPRISE_FEATURES];
      case CommercialClassification.PRO_ACTIVE:
      case CommercialClassification.PRO_EVALUATION:
        return [...PRO_FEATURES];
      case CommercialClassification.VERIFIED_NETWORK_CORE:
        return [...NETWORK_CORE_FEATURES];
      // Non-production entities get Network Core capability so they remain
      // testable, but can never be billed — billability is a separate allowlist.
      case CommercialClassification.INTERNAL:
      case CommercialClassification.DEMO:
      case CommercialClassification.QA:
      case CommercialClassification.STAGING:
      case CommercialClassification.PARTNER_SANDBOX:
      case CommercialClassification.PILOT_NON_BILLABLE:
        return [...NETWORK_CORE_FEATURES];
      default:
        // Directory, pending, in-review, suspended, rejected, closed.
        return [];
    }
  }

  /**
   * Eligibility: may this pharmacy operate at all? Independent of what it paid
   * for. Lapsed verification restricts professional actions pending re-verification
   * even on a fully paid subscription (S-B4).
   */
  private eligibility(
    verificationStatus: VerificationStatus,
    classification: CommercialClassification,
  ): { eligible: boolean; reason?: string } {
    if (classification === CommercialClassification.SUSPENDED_COMPLIANCE) {
      return { eligible: false, reason: 'Pharmacy is suspended pending compliance review.' };
    }
    if (classification === CommercialClassification.CLOSED) {
      return { eligible: false, reason: 'Pharmacy is closed.' };
    }
    if (classification === CommercialClassification.REJECTED) {
      return { eligible: false, reason: 'Pharmacy verification was rejected.' };
    }
    if (verificationStatus === VerificationStatus.SUSPENDED) {
      return { eligible: false, reason: 'Pharmacy verification is suspended.' };
    }
    if (verificationStatus !== VerificationStatus.VERIFIED) {
      return {
        eligible: false,
        reason: 'Pharmacy verification is not approved.',
      };
    }
    return { eligible: true };
  }

  /**
   * Throw unless the pharmacy holds the feature and is eligible to use it.
   * Both conditions are required: entitlement without eligibility is not access.
   */
  async requireFeature(pharmacyId: string, feature: CommercialFeature): Promise<void> {
    const result = await this.resolveForPharmacy(pharmacyId);

    if (!result.eligible) {
      throw new ForbiddenException(
        result.eligibilityReason ?? 'Pharmacy is not eligible for this action.',
      );
    }
    if (!result.features.includes(feature)) {
      throw new ForbiddenException(
        `Your plan does not include ${feature}. Upgrade to ZoikoMeds Intelligence Pro to enable it.`,
      );
    }
  }
}
