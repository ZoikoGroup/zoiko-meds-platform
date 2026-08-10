import { BillingCapability, CommercialClassification, CommercialOffer, SubscriptionState, UserRole, VerificationStatus } from '@prisma/client';
import {
  PRO_DELINQUENCY_DAYS,
  assertRankingNeutral,
  defaultCapabilitiesFor,
  hasCapability,
  isBillableClassification,
  isNeverBillableEvent,
  isNonProductionClassification,
  isSuperAdmin,
  isZeroCostOffer,
  participatesInNetworkCore,
  proDelinquencyState,
  reasonsConversionBlocked,
  violatesSeparationOfDuties,
} from './commercial.doctrine';

/**
 * These are the commercial invariants of ZM-COM-BILL-001. They are written to be
 * exhaustive over the enums rather than sampling a few cases: the failure mode
 * being guarded against is someone adding a classification or capability later and
 * quietly making it billable or over-privileged.
 */
describe('ZM-COM-BILL-001 commercial invariants', () => {
  describe('billability (S-B1, S-Q1)', () => {
    it('permits a live charge for exactly two classifications', () => {
      const billable = Object.values(CommercialClassification).filter(isBillableClassification);
      expect(billable.sort()).toEqual(
        [
          CommercialClassification.PRO_ACTIVE,
          CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
        ].sort(),
      );
    });

    it('never bills a pre-commercial, internal, demo, QA, staging, sandbox or pilot entity', () => {
      const nonProduction = [
        CommercialClassification.DIRECTORY_UNCLAIMED,
        CommercialClassification.CLAIMED_PENDING,
        CommercialClassification.VERIFICATION_IN_REVIEW,
        CommercialClassification.PILOT_NON_BILLABLE,
        CommercialClassification.INTERNAL,
        CommercialClassification.DEMO,
        CommercialClassification.QA,
        CommercialClassification.STAGING,
        CommercialClassification.PARTNER_SANDBOX,
        CommercialClassification.SUSPENDED_COMPLIANCE,
        CommercialClassification.REJECTED,
        CommercialClassification.CLOSED,
      ];
      for (const c of nonProduction) {
        expect(isBillableClassification(c)).toBe(false);
      }
    });

    it('never bills free participation or a no-card evaluation (S-D1, S-E3)', () => {
      expect(isBillableClassification(CommercialClassification.VERIFIED_NETWORK_CORE)).toBe(false);
      expect(isBillableClassification(CommercialClassification.PRO_EVALUATION)).toBe(false);
    });

    it('keeps patient access and Network Core as zero-cost offers (S-A1, S-D1)', () => {
      expect(isZeroCostOffer(CommercialOffer.PATIENT_CAREGIVER_ACCESS)).toBe(true);
      expect(isZeroCostOffer(CommercialOffer.PHARMACY_NETWORK_CORE)).toBe(true);
      expect(isZeroCostOffer(CommercialOffer.PHARMACY_INTELLIGENCE_PRO)).toBe(false);
      expect(isZeroCostOffer(CommercialOffer.ENTERPRISE_API_DATA)).toBe(false);
    });
  });

  describe('network participation survives billing failure (S-L1)', () => {
    it('keeps a verified pharmacy in Network Core across every paid state', () => {
      for (const c of [
        CommercialClassification.VERIFIED_NETWORK_CORE,
        CommercialClassification.PRO_EVALUATION,
        CommercialClassification.PRO_ACTIVE,
        CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
      ]) {
        expect(participatesInNetworkCore(c)).toBe(true);
      }
    });

    it('excludes only enforcement and pre-verification states', () => {
      for (const c of [
        CommercialClassification.DIRECTORY_UNCLAIMED,
        CommercialClassification.CLAIMED_PENDING,
        CommercialClassification.VERIFICATION_IN_REVIEW,
        CommercialClassification.SUSPENDED_COMPLIANCE,
        CommercialClassification.REJECTED,
        CommercialClassification.CLOSED,
      ]) {
        expect(participatesInNetworkCore(c)).toBe(false);
      }
    });
  });

  describe('commercial conversion preconditions (S-B1, S-B2, S-Q3)', () => {
    const satisfied = {
      verificationStatus: VerificationStatus.VERIFIED,
      classification: CommercialClassification.VERIFIED_NETWORK_CORE,
      hasAuthorizedPayer: true,
      hasApprovedCatalogPrice: true,
      hasBillingProfile: true,
      hasTaxDetermination: true,
      termsAccepted: true,
    };

    it('allows conversion when every precondition holds', () => {
      expect(reasonsConversionBlocked(satisfied)).toEqual([]);
    });

    it('blocks conversion before verification is approved', () => {
      for (const status of [
        VerificationStatus.UNVERIFIED,
        VerificationStatus.PENDING,
        VerificationStatus.INFO_REQUESTED,
        VerificationStatus.REJECTED,
        VerificationStatus.SUSPENDED,
      ]) {
        const reasons = reasonsConversionBlocked({ ...satisfied, verificationStatus: status });
        expect(reasons.join(' ')).toMatch(/verification is not approved/i);
      }
    });

    it('blocks conversion without an approved catalog price, naming the range trap', () => {
      const reasons = reasonsConversionBlocked({ ...satisfied, hasApprovedCatalogPrice: false });
      expect(reasons.join(' ')).toMatch(/price range is not an executable price/i);
    });

    it('blocks conversion of a non-production entity even when otherwise perfect', () => {
      for (const c of [
        CommercialClassification.DEMO,
        CommercialClassification.QA,
        CommercialClassification.INTERNAL,
        CommercialClassification.STAGING,
        CommercialClassification.PARTNER_SANDBOX,
        CommercialClassification.PILOT_NON_BILLABLE,
      ]) {
        const reasons = reasonsConversionBlocked({ ...satisfied, classification: c });
        expect(reasons.join(' ')).toMatch(/never be billed/i);
      }
    });

    it('blocks conversion without an authorized payer, profile, tax or terms', () => {
      expect(reasonsConversionBlocked({ ...satisfied, hasAuthorizedPayer: false })).not.toEqual([]);
      expect(reasonsConversionBlocked({ ...satisfied, hasBillingProfile: false })).not.toEqual([]);
      expect(reasonsConversionBlocked({ ...satisfied, hasTaxDetermination: false })).not.toEqual([]);
      expect(reasonsConversionBlocked({ ...satisfied, termsAccepted: false })).not.toEqual([]);
    });

    it('reports every blocking reason at once rather than one per attempt', () => {
      const reasons = reasonsConversionBlocked({
        verificationStatus: VerificationStatus.PENDING,
        classification: CommercialClassification.CLAIMED_PENDING,
        hasAuthorizedPayer: false,
        hasApprovedCatalogPrice: false,
        hasBillingProfile: false,
        hasTaxDetermination: false,
        termsAccepted: false,
      });
      expect(reasons.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('delinquency timeline (S-L1)', () => {
    it('follows notify, block expansion, restrict features, downgrade', () => {
      expect(proDelinquencyState(0)).toBe(SubscriptionState.PAST_DUE);
      expect(proDelinquencyState(6)).toBe(SubscriptionState.PAST_DUE);
      expect(proDelinquencyState(PRO_DELINQUENCY_DAYS.BLOCK_EXPANSION)).toBe(
        SubscriptionState.EXPANSION_BLOCKED,
      );
      expect(proDelinquencyState(PRO_DELINQUENCY_DAYS.RESTRICT_PAID_FEATURES)).toBe(
        SubscriptionState.PAID_FEATURES_RESTRICTED,
      );
      expect(proDelinquencyState(PRO_DELINQUENCY_DAYS.DOWNGRADE)).toBe(SubscriptionState.CANCELED);
      expect(proDelinquencyState(90)).toBe(SubscriptionState.CANCELED);
    });

    it('uses the documented day boundaries', () => {
      expect(PRO_DELINQUENCY_DAYS).toEqual({
        BLOCK_EXPANSION: 7,
        RESTRICT_PAID_FEATURES: 14,
        DOWNGRADE: 20,
      });
    });
  });

  describe('search ranking neutrality (S-G2, S-G3, S-D3)', () => {
    it('accepts a ranking feature set built only from relevance signals', () => {
      expect(() =>
        assertRankingNeutral([
          'medicineMatch',
          'distanceKm',
          'signalConfidence',
          'freshness',
          'openNow',
          'policyEligibility',
        ]),
      ).not.toThrow();
    });

    it('rejects any commercial signal in organic ranking', () => {
      for (const signal of [
        'plan',
        'planCode',
        'isPro',
        'isPaid',
        'subscriptionState',
        'commercialClassification',
        'sponsored',
        'sponsorshipWeight',
        'revenue',
        'spend',
      ]) {
        expect(() => assertRankingNeutral(['distanceKm', signal])).toThrow(/neutrality violated/i);
      }
    });

    it('rejects commercial signals however they are spelled', () => {
      expect(() => assertRankingNeutral(['plan_code'])).toThrow(/neutrality violated/i);
      expect(() => assertRankingNeutral(['is_paid'])).toThrow(/neutrality violated/i);
    });
  });

  describe('events that can never be billable (S-A3, S-G4, S-H1, S-I1)', () => {
    it('never bills patient search, routing or account creation', () => {
      expect(isNeverBillableEvent('patient_search')).toBe(true);
      expect(isNeverBillableEvent('patient_routed_to_pharmacy')).toBe(true);
      expect(isNeverBillableEvent('patient_account_created')).toBe(true);
    });

    it('never bills a confirmation request or its outcome', () => {
      for (const e of [
        'confirmation_request_created',
        'confirmation_request_accepted',
        'confirmation_request_declined',
        'confirmation_request_expired',
      ]) {
        expect(isNeverBillableEvent(e)).toBe(true);
      }
    });

    it('never takes a commission on a dispensing outcome', () => {
      expect(isNeverBillableEvent('dispense_success')).toBe(true);
      expect(isNeverBillableEvent('prescription_fill')).toBe(true);
      expect(isNeverBillableEvent('medicine_value')).toBe(true);
    });

    it('never bills a failed or stale inventory feed', () => {
      for (const e of ['sync_failed', 'parse_failed', 'stale_signal', 'duplicate_feed']) {
        expect(isNeverBillableEvent(e)).toBe(true);
      }
    });

    it('is case-insensitive so a differently-cased caller cannot slip past', () => {
      expect(isNeverBillableEvent('DISPENSE_SUCCESS')).toBe(true);
    });

    it('still allows a genuinely contracted metric', () => {
      expect(isNeverBillableEvent('API_REQUEST')).toBe(false);
      expect(isNeverBillableEvent('AI_OUTPUT')).toBe(false);
    });
  });

  describe('super admin authority and delegation (S-22)', () => {
    it('grants a super admin every capability without any grant rows', () => {
      for (const capability of Object.values(BillingCapability)) {
        expect(hasCapability({ role: UserRole.SUPER_ADMIN }, capability, [])).toBe(true);
      }
      expect(defaultCapabilitiesFor(UserRole.SUPER_ADMIN)).toHaveLength(
        Object.values(BillingCapability).length,
      );
      expect(isSuperAdmin(UserRole.SUPER_ADMIN)).toBe(true);
    });

    it('lets a super admin delegate capabilities, which is what GRANT_CAPABILITIES is for', () => {
      expect(
        hasCapability({ role: UserRole.SUPER_ADMIN }, BillingCapability.GRANT_CAPABILITIES, []),
      ).toBe(true);
    });

    it('gives a patient account no billing capability at all (S-A5)', () => {
      for (const capability of Object.values(BillingCapability)) {
        expect(hasCapability({ role: UserRole.PUBLIC }, capability, [])).toBe(false);
      }
    });

    it('gives pharmacy staff no billing capability', () => {
      for (const capability of Object.values(BillingCapability)) {
        expect(hasCapability({ role: UserRole.PHARMACY_STAFF }, capability, [])).toBe(false);
      }
    });

    it('honours an explicit grant for a non-super-admin role', () => {
      const grants = [
        {
          capability: BillingCapability.APPROVE_REFUND_OR_CREDIT,
          billingProfileId: null,
          revokedAt: null,
        },
      ];
      expect(
        hasCapability({ role: UserRole.ADMIN }, BillingCapability.APPROVE_REFUND_OR_CREDIT, grants),
      ).toBe(true);
    });

    it('ignores a revoked grant', () => {
      const grants = [
        {
          capability: BillingCapability.CHANGE_PLAN,
          billingProfileId: null,
          revokedAt: new Date(),
        },
      ];
      expect(hasCapability({ role: UserRole.ADMIN }, BillingCapability.CHANGE_PLAN, grants)).toBe(
        false,
      );
    });

    it('confines a scoped grant to its organization', () => {
      const grants = [
        { capability: BillingCapability.VIEW_INVOICES, billingProfileId: 'bp_1', revokedAt: null },
      ];
      expect(
        hasCapability({ role: UserRole.PHARMACY_ADMIN }, BillingCapability.VIEW_INVOICES, grants, {
          billingProfileId: 'bp_1',
        }),
      ).toBe(true);
      expect(
        hasCapability({ role: UserRole.PHARMACY_ADMIN }, BillingCapability.VIEW_INVOICES, grants, {
          billingProfileId: 'bp_2',
        }),
      ).toBe(false);
      // No scope supplied — a scoped grant must not act as platform-wide.
      expect(
        hasCapability({ role: UserRole.PHARMACY_ADMIN }, BillingCapability.VIEW_INVOICES, grants),
      ).toBe(false);
    });
  });

  describe('separation of duties (S-22)', () => {
    it('flags financial authority handed to an operational role', () => {
      expect(
        violatesSeparationOfDuties(UserRole.PHARMACY_ADMIN, [
          BillingCapability.APPROVE_REFUND_OR_CREDIT,
        ]),
      ).toBe(true);
      expect(
        violatesSeparationOfDuties(UserRole.ADMIN, [BillingCapability.MANAGE_PRICE_CATALOG]),
      ).toBe(true);
    });

    it('does not flag read-only billing visibility', () => {
      expect(
        violatesSeparationOfDuties(UserRole.PHARMACY_ADMIN, [
          BillingCapability.VIEW_PLAN_AND_USAGE,
          BillingCapability.VIEW_INVOICES,
        ]),
      ).toBe(false);
    });

    it('exempts the super admin, which is a deliberate global override', () => {
      expect(
        violatesSeparationOfDuties(UserRole.SUPER_ADMIN, Object.values(BillingCapability)),
      ).toBe(false);
    });
  });

  describe('non-production classification (S-Q4)', () => {
    it('identifies every non-production entity', () => {
      for (const c of [
        CommercialClassification.INTERNAL,
        CommercialClassification.DEMO,
        CommercialClassification.QA,
        CommercialClassification.STAGING,
        CommercialClassification.PARTNER_SANDBOX,
        CommercialClassification.PILOT_NON_BILLABLE,
      ]) {
        expect(isNonProductionClassification(c)).toBe(true);
      }
      expect(isNonProductionClassification(CommercialClassification.PRO_ACTIVE)).toBe(false);
      expect(isNonProductionClassification(CommercialClassification.VERIFIED_NETWORK_CORE)).toBe(
        false,
      );
    });
  });
});
