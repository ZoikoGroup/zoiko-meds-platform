import { AvailabilityConfidence, CommercialClassification, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { PATIENT_VISIBLE_CLASSIFICATIONS } from './availability.visibility';

/**
 * Inventory is stored while a pharmacy is under review, and published when it
 * is approved.
 *
 * A pharmacy waiting on verification can still do the work: fill in its
 * profile, upload a licence, import a stock CSV. None of that may reach a
 * patient, because the pharmacy is not part of the verified network yet — and
 * none of it may be thrown away either, or approval would hand the operator an
 * empty catalogue and ask them to upload it a second time.
 *
 * So publication is a read rule and nothing else. The rows sit in the database
 * untouched through PENDING and REJECTED, and the day the last gate opens the
 * same rows answer a patient query. This walks that lifecycle against the real
 * service, with a store that applies the nested pharmacy filter the way the
 * database would.
 */

const MEDICINE = 'med_amox_500';

/** A pharmacy mid-review, with stock already imported. */
const pharmacyAt = (over: Record<string, unknown> = {}) => ({
  id: 'ph_1',
  name: 'Zoiko Meds',
  city: 'Hyderabad',
  region: 'Telangana',
  phone: '+91 96663 44441',
  latitude: 17.5878,
  longitude: 78.4236,
  logoUpdatedAt: null,
  verificationStatus: VerificationStatus.PENDING,
  isParticipating: false,
  commercialClassification: CommercialClassification.CLAIMED_PENDING,
  ...over,
});

/** Approved, participating, claimed — every gate open. */
const APPROVED = {
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
};

/**
 * One imported stock row, kept in a store the pharmacy's state can be changed
 * on — the point being that the signal itself never changes.
 */
function buildService(pharmacy: Record<string, any>) {
  const signal = {
    medicineId: MEDICINE,
    confidence: AvailabilityConfidence.HIGH as AvailabilityConfidence,
    freshnessMinutes: 30,
    requiresConfirmation: false,
    computedAt: new Date('2026-09-04T09:00:00Z'),
    pharmacy,
  };
  const store = { signals: [signal] };

  const matchesPharmacy = (row: any, where: any = {}) => {
    if (where.verificationStatus !== undefined && row.verificationStatus !== where.verificationStatus)
      return false;
    if (where.isParticipating !== undefined && row.isParticipating !== where.isParticipating)
      return false;
    if (
      where.commercialClassification?.in &&
      !where.commercialClassification.in.includes(row.commercialClassification)
    ) {
      return false;
    }
    return true;
  };

  const prisma: any = {
    availabilitySignal: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        store.signals.filter((s) => {
          if (where.medicineId && s.medicineId !== where.medicineId) return false;
          if (where.confidence?.not && s.confidence === where.confidence.not) return false;
          if (where.pharmacy && !matchesPharmacy(s.pharmacy, where.pharmacy)) return false;
          return true;
        }),
      ),
    },
  };

  return {
    service: new AvailabilityService(prisma as unknown as PrismaService),
    store,
    signal,
  };
}

describe('while the pharmacy is under review', () => {
  it('the inventory is stored', async () => {
    // Nothing about being unverified removes a row.
    const { store } = buildService(pharmacyAt());

    expect(store.signals).toHaveLength(1);
    expect(store.signals[0].medicineId).toBe(MEDICINE);
  });

  it('a patient asking for that medicine is told nothing', async () => {
    const { service } = buildService(pharmacyAt());

    expect(await service.getAvailability(MEDICINE)).toEqual([]);
  });

  it('the record is still there after the patient query', async () => {
    // A read rule, not a purge.
    const { service, store } = buildService(pharmacyAt());

    await service.getAvailability(MEDICINE);

    expect(store.signals).toHaveLength(1);
  });
});

describe('while the pharmacy is rejected', () => {
  const REJECTED = { verificationStatus: VerificationStatus.REJECTED };

  it('the inventory is still stored', () => {
    const { store } = buildService(pharmacyAt(REJECTED));

    expect(store.signals).toHaveLength(1);
  });

  it('and still reaches no patient', async () => {
    const { service } = buildService(pharmacyAt(REJECTED));

    expect(await service.getAvailability(MEDICINE)).toEqual([]);
  });
});

describe('after approval', () => {
  it('the same stored row becomes visible, with no re-upload', async () => {
    // The whole point of keeping it. The signal object is never rewritten here
    // — only the pharmacy's standing changes — so anything the patient now sees
    // is the row the operator imported while they were waiting.
    const pharmacy = pharmacyAt();
    const { service, signal } = buildService(pharmacy);
    expect(await service.getAvailability(MEDICINE)).toEqual([]);
    const before = { ...signal };

    Object.assign(pharmacy, APPROVED);
    const results = await service.getAvailability(MEDICINE);

    expect(results).toHaveLength(1);
    expect(results[0].pharmacy.id).toBe('ph_1');
    expect(signal.medicineId).toBe(before.medicineId);
    expect(signal.computedAt).toBe(before.computedAt);
  });

  it('publishes the confidence the pharmacy reported, unchanged', async () => {
    const pharmacy = pharmacyAt(APPROVED);
    const { service } = buildService(pharmacy);

    const [row]: any = await service.getAvailability(MEDICINE);

    expect(row.confidence).toBe(AvailabilityConfidence.HIGH);
  });

  it('still exposes no exact stock', async () => {
    const pharmacy = pharmacyAt(APPROVED);
    const { service } = buildService(pharmacy);

    const [row]: any = await service.getAvailability(MEDICINE);

    expect(row.quantity).toBeUndefined();
    expect(row.stock).toBeUndefined();
  });
});

describe('approval alone is not publication', () => {
  it.each([
    ['not participating', { ...APPROVED, isParticipating: false }],
    [
      'claim still unproven',
      { ...APPROVED, commercialClassification: CommercialClassification.CLAIMED_PENDING },
    ],
    [
      'unclaimed directory record',
      { ...APPROVED, commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED },
    ],
    ['suspended after approval', { ...APPROVED, verificationStatus: VerificationStatus.SUSPENDED }],
  ])('stays unpublished when %s', async (_label, state) => {
    const { service } = buildService(pharmacyAt(state));

    expect(await service.getAvailability(MEDICINE)).toEqual([]);
  });

  it.each(PATIENT_VISIBLE_CLASSIFICATIONS)(
    'publishes under %s once verified and participating',
    async (commercialClassification) => {
      const { service } = buildService(
        pharmacyAt({ ...APPROVED, commercialClassification }),
      );

      expect(await service.getAvailability(MEDICINE)).toHaveLength(1);
    },
  );
});

describe('a suppressed signal is withheld whatever the pharmacy is', () => {
  it('is not published even from a fully eligible pharmacy', async () => {
    // SUPPRESSED is the governed "do not publish this" state, and it outranks
    // the pharmacy's standing rather than being outranked by it.
    const { service, store } = buildService(pharmacyAt(APPROVED));
    store.signals[0].confidence = AvailabilityConfidence.SUPPRESSED;

    expect(await service.getAvailability(MEDICINE)).toEqual([]);
  });
});
