import { CommercialClassification, VerificationStatus } from '@prisma/client';
import {
  PATIENT_VISIBLE_CLASSIFICATIONS,
  PUBLIC_PHARMACY_WHERE,
  isPatientVisible,
} from './availability.visibility';

/**
 * The predicate and the query have to stay the same rule.
 *
 * `PUBLIC_PHARMACY_WHERE` decides which pharmacies a patient search returns.
 * `isPatientVisible` answers the same question about one row already in hand,
 * which is what the pharmacy's own portal needs before it can tell an operator
 * "patients can see you". Two statements of one rule can drift, and the drift
 * is silent and lands in the worst direction — a portal congratulating an
 * operator whose pharmacy no search returns.
 *
 * So this holds them together: same fields, same values, same allowlist.
 */

const VISIBLE = {
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
};

describe('the predicate matches the query it stands in for', () => {
  it('tests every field the query filters on, and no others', () => {
    expect(Object.keys(PUBLIC_PHARMACY_WHERE).sort()).toEqual([
      'commercialClassification',
      'isParticipating',
      'verificationStatus',
    ]);
  });

  it('agrees with the query on the verification status', () => {
    expect(PUBLIC_PHARMACY_WHERE.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(isPatientVisible(VISIBLE)).toBe(true);
    expect(
      isPatientVisible({ ...VISIBLE, verificationStatus: VerificationStatus.PENDING }),
    ).toBe(false);
  });

  it('agrees with the query on participation', () => {
    expect(PUBLIC_PHARMACY_WHERE.isParticipating).toBe(true);
    expect(isPatientVisible({ ...VISIBLE, isParticipating: false })).toBe(false);
  });

  it('reads the same allowlist the query does', () => {
    // Not a second copy of the list: a classification added to or removed from
    // the allowlist has to move both at once.
    expect((PUBLIC_PHARMACY_WHERE.commercialClassification as any).in).toBe(
      PATIENT_VISIBLE_CLASSIFICATIONS,
    );
  });
});

describe('every classification, decided the same way both times', () => {
  it.each(Object.values(CommercialClassification))('%s', (classification) => {
    const expected = PATIENT_VISIBLE_CLASSIFICATIONS.includes(classification);

    expect(isPatientVisible({ ...VISIBLE, commercialClassification: classification })).toBe(
      expected,
    );
  });

  it('excludes a claimed-but-unproven pharmacy', () => {
    // Approval says the pharmacy is real; it does not say anyone has taken
    // responsibility for the stock levels it reports. This is the case that
    // holds VERIFIED, is participating and located, and is still shown to
    // nobody — the one a status-only check would get wrong.
    expect(
      isPatientVisible({
        ...VISIBLE,
        commercialClassification: CommercialClassification.CLAIMED_PENDING,
      }),
    ).toBe(false);
  });

  it('excludes an unclaimed directory record', () => {
    expect(
      isPatientVisible({
        ...VISIBLE,
        commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
      }),
    ).toBe(false);
  });
});

describe('verification status alone decides nothing', () => {
  it('is not enough on its own', () => {
    // Stated directly, because it is the assumption the portal used to make.
    const verifiedButUnclaimed = {
      verificationStatus: VerificationStatus.VERIFIED,
      isParticipating: true,
      commercialClassification: CommercialClassification.CLAIMED_PENDING,
    };

    expect(verifiedButUnclaimed.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(isPatientVisible(verifiedButUnclaimed)).toBe(false);
  });
});
