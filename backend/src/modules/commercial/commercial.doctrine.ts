import {
  BillingCapability,
  CommercialClassification,
  CommercialOffer,
  SubscriptionState,
  UserRole,
  VerificationStatus,
} from '@prisma/client';

/**
 * ZM-COM-BILL-001 — the commercial invariants, in one place.
 *
 * These are the rules that must hold no matter which controller, job or admin
 * action is running, so they live as pure functions with no I/O: they can be
 * unit-tested exhaustively and cannot be bypassed by forgetting a check in a
 * service. Anything that decides "can we charge for this" must come through here.
 */

/**
 * The only classifications that may ever produce a live charge (S-B1, S-Q1).
 *
 * Everything else — directory records, pending claims, pilots, internal, demo,
 * QA, staging, partner sandboxes, suspended, rejected, closed — is non-billable
 * by construction. This is an allowlist on purpose: a new classification added
 * later is non-billable until someone deliberately adds it here.
 */
const BILLABLE_CLASSIFICATIONS: ReadonlySet<CommercialClassification> = new Set([
  CommercialClassification.PRO_ACTIVE,
  CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
]);

/** Offers that are $0 at launch and must never generate a charge (S-A1, S-D1). */
const ZERO_COST_OFFERS: ReadonlySet<CommercialOffer> = new Set([
  CommercialOffer.PATIENT_CAREGIVER_ACCESS,
  CommercialOffer.PHARMACY_NETWORK_CORE,
]);

/**
 * Classifications that represent active participation in the free availability
 * network. Used to prove that a billing failure never removes an eligible
 * pharmacy from Network Core (S-L1).
 */
const NETWORK_CORE_PARTICIPATING: ReadonlySet<CommercialClassification> = new Set([
  CommercialClassification.VERIFIED_NETWORK_CORE,
  CommercialClassification.PRO_EVALUATION,
  CommercialClassification.PRO_ACTIVE,
  CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
]);

/** True only for classifications that may generate a live charge. */
export function isBillableClassification(c: CommercialClassification): boolean {
  return BILLABLE_CLASSIFICATIONS.has(c);
}

/** True for offers that are free at launch. */
export function isZeroCostOffer(offer: CommercialOffer): boolean {
  return ZERO_COST_OFFERS.has(offer);
}

/**
 * Whether a pharmacy still participates in the free availability network.
 * Deliberately independent of subscription state: paid-intelligence delinquency
 * must not evict a verified pharmacy from Network Core (S-L1).
 */
export function participatesInNetworkCore(c: CommercialClassification): boolean {
  return NETWORK_CORE_PARTICIPATING.has(c);
}

/**
 * Commercial conversion preconditions (S-B1, S-B2, S-Q3).
 *
 * Verification approval gates live charging: claiming a record or submitting
 * credentials is not commercial acceptance. Returns the blocking reasons so the
 * caller can report all of them at once instead of one per attempt.
 */
export function reasonsConversionBlocked(input: {
  verificationStatus: VerificationStatus;
  classification: CommercialClassification;
  hasAuthorizedPayer: boolean;
  hasApprovedCatalogPrice: boolean;
  hasBillingProfile: boolean;
  hasTaxDetermination: boolean;
  termsAccepted: boolean;
}): string[] {
  const reasons: string[] = [];

  if (input.verificationStatus !== VerificationStatus.VERIFIED) {
    reasons.push(
      'Pharmacy verification is not approved. Live charging cannot begin before verification completes.',
    );
  }
  // A pharmacy under enforcement or already closed must not be converted.
  if (
    input.classification === CommercialClassification.SUSPENDED_COMPLIANCE ||
    input.classification === CommercialClassification.REJECTED ||
    input.classification === CommercialClassification.CLOSED
  ) {
    reasons.push(`Classification ${input.classification} cannot be commercially converted.`);
  }
  // Non-production entities must never reference live prices (S-Q4).
  if (isNonProductionClassification(input.classification)) {
    reasons.push(
      `Classification ${input.classification} is a non-production entity and can never be billed.`,
    );
  }
  if (!input.hasAuthorizedPayer) {
    reasons.push('No authorized payer (Organization Owner or Billing Admin) selected the offer.');
  }
  if (!input.hasApprovedCatalogPrice) {
    reasons.push(
      'No approved price catalog record for this market, currency and interval. A published price range is not an executable price.',
    );
  }
  if (!input.hasBillingProfile) reasons.push('No billing profile exists for the organization.');
  if (!input.hasTaxDetermination) reasons.push('Tax determination has not been resolved.');
  if (!input.termsAccepted) reasons.push('Commercial terms were not accepted.');

  return reasons;
}

/** Internal, demo, QA, staging and sandbox entities (S-Q1, S-Q4). */
export function isNonProductionClassification(c: CommercialClassification): boolean {
  return (
    c === CommercialClassification.INTERNAL ||
    c === CommercialClassification.DEMO ||
    c === CommercialClassification.QA ||
    c === CommercialClassification.STAGING ||
    c === CommercialClassification.PARTNER_SANDBOX ||
    c === CommercialClassification.PILOT_NON_BILLABLE
  );
}

/**
 * Delinquency timeline for self-serve Pro (S-L1). Day 0 notify, day 7 block
 * expansion, day 14 restrict paid features, day 20 downgrade to Network Core.
 *
 * Enterprise is deliberately excluded — its cure periods come from the Order
 * Form and must never inherit this schedule (S-L3).
 */
export const PRO_DELINQUENCY_DAYS = {
  BLOCK_EXPANSION: 7,
  RESTRICT_PAID_FEATURES: 14,
  DOWNGRADE: 20,
} as const;

export function proDelinquencyState(daysSinceFailure: number): SubscriptionState {
  if (daysSinceFailure >= PRO_DELINQUENCY_DAYS.DOWNGRADE) return SubscriptionState.CANCELED;
  if (daysSinceFailure >= PRO_DELINQUENCY_DAYS.RESTRICT_PAID_FEATURES) {
    return SubscriptionState.PAID_FEATURES_RESTRICTED;
  }
  if (daysSinceFailure >= PRO_DELINQUENCY_DAYS.BLOCK_EXPANSION) {
    return SubscriptionState.EXPANSION_BLOCKED;
  }
  return SubscriptionState.PAST_DUE;
}

/** Recommended Pro evaluation window: 30 days, no card, no auto-conversion (S-E3). */
export const PRO_EVALUATION_DAYS = 30;

/**
 * Ranking neutrality (S-G2, S-D3).
 *
 * Commercial standing must never influence organic medicine-search ranking or
 * availability confidence. Exported so the search/availability services can be
 * asserted against it in tests: any ranking feature set containing one of these
 * is a doctrine violation, not a tuning choice.
 */
export const RANKING_FORBIDDEN_SIGNALS: readonly string[] = [
  'plan',
  'planCode',
  'offer',
  'commercialClassification',
  'subscription',
  'subscriptionState',
  'isPaid',
  'isPro',
  'billingProfileId',
  'sponsored',
  'sponsorshipWeight',
  'revenue',
  'spend',
];

export function assertRankingNeutral(rankingSignals: readonly string[]): void {
  // Compare on a normalized form so casing and separators cannot smuggle a
  // commercial signal past the check: planCode, plan_code and PLAN CODE are all
  // the same violation.
  const normalize = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, '');
  const forbidden = new Set(RANKING_FORBIDDEN_SIGNALS.map(normalize));
  const violations = rankingSignals.filter((s) => forbidden.has(normalize(s)));
  if (violations.length > 0) {
    throw new Error(
      `Ranking neutrality violated (ZM-COM-BILL-001 S-G2): commercial signals ${violations.join(
        ', ',
      )} must never affect organic medicine-search ranking.`,
    );
  }
}

/**
 * Events that can never become billable usage, whatever the contract says
 * (S-A3, S-H1, S-I1, S-G4).
 *
 * Patient routing, confirmation outcomes, dispensing results and failed feeds are
 * analytics only. Keeping the list here means a future "monetise leads" change
 * has to delete a documented invariant rather than quietly add a meter.
 */
export const NEVER_BILLABLE_EVENTS: readonly string[] = [
  'patient_search',
  'patient_account_created',
  'patient_routed_to_pharmacy',
  'confirmation_request_created',
  'confirmation_request_accepted',
  'confirmation_request_declined',
  'confirmation_request_expired',
  'dispense_success',
  'prescription_fill',
  'medicine_value',
  'sync_failed',
  'parse_failed',
  'stale_signal',
  'duplicate_feed',
];

export function isNeverBillableEvent(eventCode: string): boolean {
  return NEVER_BILLABLE_EVENTS.includes(eventCode.toLowerCase());
}

/**
 * Default capabilities per role (S-22).
 *
 * SUPER_ADMIN is intentionally absent: it is handled as a global override in
 * `hasCapability` so it always holds every capability, including the authority to
 * grant capabilities to anyone else. Everyone else gets the least privilege their
 * role implies and must be granted anything further.
 */
const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly BillingCapability[]>> = {
  [UserRole.PUBLIC]: [],
  [UserRole.PHARMACY_STAFF]: [],
  [UserRole.PHARMACY_ADMIN]: [BillingCapability.VIEW_PLAN_AND_USAGE],
  [UserRole.ENTERPRISE]: [BillingCapability.VIEW_PLAN_AND_USAGE, BillingCapability.VIEW_INVOICES],
  [UserRole.GOVERNMENT]: [BillingCapability.VIEW_PLAN_AND_USAGE],
  // Platform administrator: operational billing support, but refunds/credits and
  // price catalog changes stay with Finance unless explicitly granted.
  [UserRole.ADMIN]: [
    BillingCapability.VIEW_PLAN_AND_USAGE,
    BillingCapability.VIEW_INVOICES,
  ],
  [UserRole.SUPER_ADMIN]: [],
};

export function isSuperAdmin(role: UserRole): boolean {
  return role === UserRole.SUPER_ADMIN;
}

/**
 * Whether a user holds a capability.
 *
 * SUPER_ADMIN is the platform owner and sits atop every role, so it short-circuits
 * to true for everything — including GRANT_CAPABILITIES, which is what lets it
 * delegate access to anyone. Every other role is the union of its role defaults
 * and its active grants, scoped to an organization when the grant is scoped.
 */
export function hasCapability(
  user: { role: UserRole },
  capability: BillingCapability,
  grants: readonly {
    capability: BillingCapability;
    billingProfileId: string | null;
    revokedAt: Date | null;
  }[] = [],
  scope?: { billingProfileId?: string | null },
): boolean {
  if (isSuperAdmin(user.role)) return true;

  if (ROLE_CAPABILITIES[user.role]?.includes(capability)) return true;

  return grants.some((g) => {
    if (g.revokedAt !== null) return false;
    if (g.capability !== capability) return false;
    // A platform-wide grant (null) applies everywhere; a scoped grant must match.
    if (g.billingProfileId === null) return true;
    return !!scope?.billingProfileId && g.billingProfileId === scope.billingProfileId;
  });
}

/** Capabilities a role holds by default, before any grants. */
export function defaultCapabilitiesFor(role: UserRole): readonly BillingCapability[] {
  if (isSuperAdmin(role)) return Object.values(BillingCapability);
  return ROLE_CAPABILITIES[role] ?? [];
}

/**
 * Separation of duties (S-22).
 *
 * Verification authority and inventory authority must not carry billing
 * authority: whoever can approve a pharmacy or edit availability must not also be
 * able to change pricing or issue refunds. SUPER_ADMIN is exempt by design — the
 * platform owner is explicitly a global override — so this reports the conflict
 * for non-owner accounts, where it is a real control weakness.
 */
export function violatesSeparationOfDuties(
  role: UserRole,
  capabilities: readonly BillingCapability[],
): boolean {
  if (isSuperAdmin(role)) return false;

  const operationalRole =
    role === UserRole.PHARMACY_STAFF ||
    role === UserRole.PHARMACY_ADMIN ||
    role === UserRole.ADMIN;

  const financialAuthority =
    capabilities.includes(BillingCapability.APPROVE_REFUND_OR_CREDIT) ||
    capabilities.includes(BillingCapability.MANAGE_PRICE_CATALOG);

  return operationalRole && financialAuthority;
}
