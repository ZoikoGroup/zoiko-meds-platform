import {
  BillingCapability,
  BillingInterval,
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

/**
 * Subscription states that still entitle a pharmacy to be shown to patients.
 *
 * The delinquency timeline above is the grace period, and this list is written
 * from it rather than from a second opinion about how long is fair: a payment
 * that fails buys the pharmacy until day 20 (PRO_DELINQUENCY_DAYS.DOWNGRADE) to
 * fix it, passing through PAST_DUE, EXPANSION_BLOCKED and
 * PAID_FEATURES_RESTRICTED on the way. Paid *features* switch off at day 14;
 * being findable by a patient does not, because a pharmacy that is still
 * expected to pay is still expected to be trading.
 *
 * At day 20 `advanceDelinquency` moves the subscription to CANCELED, which is
 * absent here — that is the point at which commercial eligibility ends.
 * ELIGIBILITY_RESTRICTED is absent too: verification has lapsed, and no amount
 * of paying restores a pharmacy whose authority to dispense is in question.
 */
export const VISIBILITY_ENTITLING_STATES: readonly SubscriptionState[] = [
  SubscriptionState.ACTIVE,
  SubscriptionState.PAST_DUE,
  SubscriptionState.EXPANSION_BLOCKED,
  SubscriptionState.PAID_FEATURES_RESTRICTED,
];

/**
 * Classifications that carry patient visibility without a self-serve
 * subscription row behind them.
 *
 * An Order Form is invoiced by Finance rather than collected through the
 * provider (S-N1), and a pilot is deliberately non-billable — neither should be
 * hidden for failing to hold a Stripe subscription they were never meant to
 * have. Everything else must earn visibility from a live trial or a paid term.
 */
export const COMMERCIALLY_AUTHORISED_CLASSIFICATIONS: readonly CommercialClassification[] = [
  CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
  CommercialClassification.PILOT_NON_BILLABLE,
];

/**
 * Does this one subscription, right now, entitle its locations to be shown?
 *
 * An evaluation is judged on its own end date, never on the classification
 * string. The classification is written by a background job, so between the
 * trial lapsing and that job running there is a window in which the pharmacy
 * still reads PRO_EVALUATION; trusting the string there would hand out free
 * visibility for as long as the scheduler happened to be down. The dates are
 * the fact; the classification is a cache of it.
 */
export function subscriptionEntitlesVisibility(
  subscription: { state: SubscriptionState; evaluationEndsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (subscription.state === SubscriptionState.EVALUATION) {
    return subscription.evaluationEndsAt !== null && subscription.evaluationEndsAt > now;
  }
  return VISIBILITY_ENTITLING_STATES.includes(subscription.state);
}

/**
 * Commercial eligibility for patient visibility, answered from state the
 * platform owns rather than from anything a browser said.
 *
 * Deliberately NOT sufficient on its own: `isPatientVisible` requires this AND
 * verification AND participation AND an operator account. Paying must never buy
 * a pharmacy past a safety gate.
 */
export function isCommerciallyEligibleForVisibility(input: {
  commercialClassification: CommercialClassification;
  subscriptions: readonly { state: SubscriptionState; evaluationEndsAt: Date | null }[];
  now?: Date;
}): boolean {
  if (COMMERCIALLY_AUTHORISED_CLASSIFICATIONS.includes(input.commercialClassification)) {
    return true;
  }
  const now = input.now ?? new Date();
  return input.subscriptions.some((s) => subscriptionEntitlesVisibility(s, now));
}

/**
 * End of a billing period that starts at `start`.
 *
 * Here rather than private to a service because two different paths create paid
 * terms — an administrator converting a location, and the provider webhook
 * reconciling a self-serve checkout — and a subscription whose renewal date
 * depends on which path created it is a subscription nobody can explain.
 */
export function billingPeriodEnd(start: Date, interval: BillingInterval): Date {
  const end = new Date(start);
  if (interval === BillingInterval.YEAR) end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

/**
 * May this pharmacy operate at all, regardless of what it has paid (S-B4)?
 *
 * Eligibility and entitlement are different questions and are answered
 * separately: a paid pharmacy with lapsed credentials is entitled to Pro and
 * simultaneously not permitted to use it. Lifted here from EntitlementService,
 * unchanged, because two callers now need the same answer — the entitlement
 * resolver, and the sweep that stops billing a pharmacy whose authority to
 * dispense is in question. A second copy would drift, and the direction of
 * drift is "kept charging someone we had already switched off".
 */
export function operatingEligibility(
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
    return { eligible: false, reason: 'Pharmacy verification is not approved.' };
  }
  return { eligible: true };
}

/**
 * Subscription states from which the provider can still raise another charge.
 *
 * EVALUATION is absent because a trial has no charge to prevent; CANCELED and
 * ELIGIBILITY_RESTRICTED are absent because the renewal has already been
 * stopped. This is the search space for the S-B4 sweep, and keeping it narrow
 * is what stops that sweep walking the whole subscription history every hour.
 */
export const RENEWABLE_STATES: readonly SubscriptionState[] = [
  SubscriptionState.ACTIVE,
  SubscriptionState.PAST_DUE,
  SubscriptionState.EXPANSION_BLOCKED,
  SubscriptionState.PAID_FEATURES_RESTRICTED,
];
