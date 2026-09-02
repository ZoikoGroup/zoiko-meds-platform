import {
  CommercialClassification,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import {
  PATIENT_VISIBLE_CLASSIFICATIONS,
  PUBLIC_PHARMACY_WHERE,
  PUBLIC_SIGNAL_WHERE,
  PUBLIC_SIGNALS_INCLUDE,
  VISIBLE_SIGNAL_WHERE,
} from './availability.visibility';

/**
 * Which pharmacies a patient may be shown (MSA-54).
 *
 * The rule checked verification and participation and nothing else, so a
 * preloaded directory record that a reviewer had approved appeared in patient
 * search as though its operator were standing behind the stock levels — while
 * Pharmacy Management showed it as Directory (unclaimed), because nobody had
 * claimed it.
 *
 * Claiming and verification answer different questions. Approving a licence says
 * the pharmacy is real; it does not say anyone has taken responsibility for what
 * it reports. Both are now required.
 */

/** A pharmacy row, as the visibility rule sees one. */
const pharmacy = (over: Partial<Record<string, unknown>> = {}) => ({
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
  ...over,
});

/**
 * Apply the rule to a row.
 *
 * Interprets only the two clause forms this rule uses — equality and `{ in }` —
 * which is what keeps it a fair stand-in for Prisma rather than a reimplementation
 * of it. If the rule ever grows a form this cannot read, the guard below fails
 * rather than quietly passing everything.
 */
function wouldBeVisible(row: Record<string, unknown>): boolean {
  return Object.entries(PUBLIC_PHARMACY_WHERE as Record<string, unknown>).every(
    ([field, clause]) => {
      const actual = row[field];
      if (clause !== null && typeof clause === 'object') {
        const { in: allowed } = clause as { in?: unknown[] };
        if (!Array.isArray(allowed)) {
          throw new Error(`Unsupported clause on ${field}: ${JSON.stringify(clause)}`);
        }
        return allowed.includes(actual);
      }
      return actual === clause;
    },
  );
}

describe('the clauses the rule is made of', () => {
  it('requires verification, participation and a claimed classification', () => {
    expect(Object.keys(PUBLIC_PHARMACY_WHERE).sort()).toEqual([
      'commercialClassification',
      'isParticipating',
      'verificationStatus',
    ]);
  });

  it('reads every clause it declares — no rule slips past this spec', () => {
    // Guards the helper above: an unrecognised clause form throws rather than
    // being treated as satisfied.
    expect(() => wouldBeVisible(pharmacy())).not.toThrow();
  });
});

describe('an unclaimed directory record', () => {
  it('is hidden even when verified and participating — the reported case', () => {
    expect(
      wouldBeVisible(
        pharmacy({ commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED }),
      ),
    ).toBe(false);
  });

  it('is still hidden after a reviewer has approved it', () => {
    // Approval sets VERIFIED and isParticipating and deliberately leaves the
    // classification alone, which is exactly the state tester6 was in.
    expect(
      wouldBeVisible({
        verificationStatus: VerificationStatus.VERIFIED,
        isParticipating: true,
        commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
      }),
    ).toBe(false);
  });

  it('is not in the allowlist at all', () => {
    expect(PATIENT_VISIBLE_CLASSIFICATIONS).not.toContain(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
  });
});

describe('a claimed pharmacy in the network', () => {
  it.each(PATIENT_VISIBLE_CLASSIFICATIONS)(
    'is visible when %s, verified and participating',
    (classification) => {
      expect(wouldBeVisible(pharmacy({ commercialClassification: classification }))).toBe(true);
    },
  );

  it('is hidden while it is unverified', () => {
    expect(
      wouldBeVisible(pharmacy({ verificationStatus: VerificationStatus.UNVERIFIED })),
    ).toBe(false);
  });

  it('is hidden once it stops participating', () => {
    // Its rows are kept — it may come back — but its last signal must not read
    // as current.
    expect(wouldBeVisible(pharmacy({ isParticipating: false }))).toBe(false);
  });

  it('needs all three: any one of them missing hides it', () => {
    expect(
      wouldBeVisible(
        pharmacy({
          verificationStatus: VerificationStatus.VERIFIED,
          isParticipating: true,
          commercialClassification: CommercialClassification.CLAIMED_PENDING,
        }),
      ),
    ).toBe(false);
  });
});

describe('classifications that must never reach a patient', () => {
  it.each([
    [CommercialClassification.DIRECTORY_UNCLAIMED, 'nobody has claimed it'],
    [CommercialClassification.CLAIMED_PENDING, 'the claimant is unproven'],
    [CommercialClassification.VERIFICATION_IN_REVIEW, 'still being decided'],
    [CommercialClassification.SUSPENDED_COMPLIANCE, 'suspended'],
    [CommercialClassification.REJECTED, 'rejected'],
    [CommercialClassification.CLOSED, 'closed'],
    [CommercialClassification.INTERNAL, 'not a real pharmacy'],
    [CommercialClassification.DEMO, 'not a real pharmacy'],
    [CommercialClassification.QA, 'not a real pharmacy'],
    [CommercialClassification.STAGING, 'not a real pharmacy'],
    [CommercialClassification.PARTNER_SANDBOX, 'not a real pharmacy'],
  ])('hides %s — %s', (classification, _why) => {
    expect(wouldBeVisible(pharmacy({ commercialClassification: classification }))).toBe(false);
  });

  it('is an allowlist, so a new enum value is hidden until it is named', () => {
    // The property that matters more than any single row above: adding another
    // sandbox or billing state to the enum must not publish it by default.
    const everyValue = Object.values(CommercialClassification);
    const allowed = everyValue.filter((c) =>
      wouldBeVisible(pharmacy({ commercialClassification: c })),
    );

    expect(allowed.sort()).toEqual([...PATIENT_VISIBLE_CLASSIFICATIONS].sort());
    expect(allowed.length).toBeLessThan(everyValue.length);
  });
});

describe('a signal is judged on its own standing too', () => {
  it('suppresses a SUPPRESSED band whatever the pharmacy is', () => {
    expect(VISIBLE_SIGNAL_WHERE.confidence).toEqual({ not: 'SUPPRESSED' });
  });

  it('carries the pharmacy rule with it, so a signal cannot escape it', () => {
    expect(PUBLIC_SIGNAL_WHERE.pharmacy).toEqual(PUBLIC_PHARMACY_WHERE);
  });
});

describe('every patient surface uses this one rule', () => {
  // The reason the fix is a single edit: /availability, /me/search, saved
  // medicines and ZoikoSignal all read the same object. Per-service filtering
  // is what let them drift apart in the first place.
  it('the include used by saved medicines and ZoikoSignal nests it', () => {
    expect(PUBLIC_SIGNALS_INCLUDE.where).toEqual(PUBLIC_SIGNAL_WHERE);
    expect(
      (PUBLIC_SIGNALS_INCLUDE.where as Prisma.AvailabilitySignalWhereInput).pharmacy,
    ).toEqual(PUBLIC_PHARMACY_WHERE);
  });

  it('the classification restriction is present in the nested form as well', () => {
    const nested = (PUBLIC_SIGNALS_INCLUDE.where as Prisma.AvailabilitySignalWhereInput)
      .pharmacy as Prisma.PharmacyWhereInput;

    expect(nested.commercialClassification).toEqual({
      in: PATIENT_VISIBLE_CLASSIFICATIONS,
    });
  });
});
