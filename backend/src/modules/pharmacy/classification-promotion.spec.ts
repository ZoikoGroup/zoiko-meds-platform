import {
  CommercialClassification,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';
import {
  PATIENT_VISIBLE_CLASSIFICATIONS,
  VISIBLE_SIGNAL_WHERE,
} from '../availability/availability.visibility';

/**
 * A directory record becoming a claimed pharmacy (MSA-54).
 *
 * A preloaded record stays DIRECTORY_UNCLAIMED through verification on purpose:
 * approving a licence says the pharmacy exists, not that anybody has taken
 * responsibility for what it reports. Reporting stock is that act, so the first
 * patient-visible signal is what earns the network classification — and until
 * then the patient-visibility allowlist keeps the record hidden.
 *
 * The promotion is a single conditional updateMany. Every precondition lives in
 * its `where`, which is what makes it idempotent, unable to downgrade anything,
 * and unable to fire on a failed or empty import.
 */

const PHARMACY = 'ph_1';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: PHARMACY,
};

const MEDICINE = {
  id: 'med_1',
  canonicalName: 'Dolo 650',
  genericName: 'Paracetamol',
  strength: '650 mg',
  dosageForm: 'Tablet',
  brandNames: [],
  jurisdictionId: 'jur_in',
};

function buildService() {
  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'tester6',
        jurisdictionId: 'jur_in',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    medicineEntity: {
      findFirst: jest.fn().mockResolvedValue(MEDICINE),
      findMany: jest.fn().mockResolvedValue([MEDICINE]),
      create: jest.fn().mockResolvedValue(MEDICINE),
      update: jest.fn().mockResolvedValue(MEDICINE),
    },
    inventorySignal: { create: jest.fn().mockResolvedValue({}) },
    availabilitySignal: {
      upsert: jest.fn().mockResolvedValue({ id: 'sig_1', medicine: MEDICINE }),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = { write: jest.fn() };
  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {
      inventoryBecameAvailable: jest.fn(),
      inventoryBecameUnavailable: jest.fn(),
      bulkUploadCompleted: jest.fn(),
    } as unknown as PharmacyNotificationService,
    {
      get: jest.fn(),
      allows: jest.fn().mockResolvedValue(true),
      allowedCategories: jest.fn(),
    } as unknown as NotificationPreferencesService,
    { geocode: jest.fn() } as unknown as NearbyPharmacyService,
  );
  return { service, prisma, audit };
}

/** The conditional promotion write, if one was attempted. */
const promotion = (prisma: { pharmacy: { updateMany: jest.Mock } }) =>
  prisma.pharmacy.updateMany.mock.calls.find(
    ([args]) =>
      (args?.data as Record<string, unknown>)?.commercialClassification ===
      CommercialClassification.VERIFIED_NETWORK_CORE,
  )?.[0] as { where: Prisma.PharmacyWhereInput; data: Record<string, unknown> } | undefined;

const addStock = (service: PharmacyService) =>
  service.addInventoryItem(
    PHARMACY,
    { name: 'Dolo 650', strength: '650 mg', dosageForm: 'Tablet', status: 'available' } as never,
    USER,
    '10.0.0.1',
  );

describe('what the promotion requires', () => {
  it('is attempted once stock has been reported', async () => {
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)).toBeDefined();
  });

  it('promotes only a record nobody has claimed', async () => {
    // The one classification in the where, so nothing else can be rewritten.
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)!.where.commercialClassification).toBe(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
  });

  it('promotes only a verified, participating pharmacy', async () => {
    const { service, prisma } = buildService();

    await addStock(service);

    const { where } = promotion(prisma)!;
    expect(where.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(where.isParticipating).toBe(true);
  });

  it('promotes only when a patient-visible signal actually exists', async () => {
    // Not "the caller said it worked" — the row has to be there. A failed
    // upload, an empty CSV or a feed that never synced leaves nothing to match.
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)!.where.availabilitySignals).toEqual({
      some: VISIBLE_SIGNAL_WHERE,
    });
  });

  it('promotes to exactly the network classification', async () => {
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)!.data).toEqual({
      commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    });
  });

  it('scopes the write to the one pharmacy', async () => {
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)!.where.id).toBe(PHARMACY);
  });
});

describe('what it must never do', () => {
  it('names no other classification, so none can be downgraded', async () => {
    // CLAIMED_PENDING, PRO_*, ENTERPRISE_*, PILOT_*, the sandboxes, suspended,
    // rejected and closed are all outside the where and cannot be rewritten.
    const { service, prisma } = buildService();

    await addStock(service);

    const serialised = JSON.stringify(promotion(prisma));
    for (const untouchable of [
      CommercialClassification.CLAIMED_PENDING,
      CommercialClassification.VERIFICATION_IN_REVIEW,
      CommercialClassification.PRO_EVALUATION,
      CommercialClassification.PRO_ACTIVE,
      CommercialClassification.ENTERPRISE_CONTRACT_ACTIVE,
      CommercialClassification.PILOT_NON_BILLABLE,
      CommercialClassification.INTERNAL,
      CommercialClassification.DEMO,
      CommercialClassification.QA,
      CommercialClassification.STAGING,
      CommercialClassification.PARTNER_SANDBOX,
      CommercialClassification.SUSPENDED_COMPLIANCE,
      CommercialClassification.REJECTED,
      CommercialClassification.CLOSED,
    ]) {
      expect(serialised).not.toContain(untouchable);
    }
  });

  it('is idempotent — a second report matches nothing', async () => {
    // Once promoted the classification no longer satisfies the where, so the
    // update is a no-op however many times inventory is reported.
    const { service, prisma } = buildService();
    prisma.pharmacy.updateMany.mockResolvedValue({ count: 0 });

    await addStock(service);
    await addStock(service);

    const attempts = prisma.pharmacy.updateMany.mock.calls.filter(
      ([a]: [{ data?: Record<string, unknown> }]) =>
        a?.data?.commercialClassification ===
        CommercialClassification.VERIFIED_NETWORK_CORE,
    );
    expect(attempts).toHaveLength(2);
    // Neither changed anything, so nothing was audited as a promotion.
    expect(attempts.every(([a]: [{ where: Prisma.PharmacyWhereInput }]) =>
      a.where.commercialClassification === CommercialClassification.DIRECTORY_UNCLAIMED,
    )).toBe(true);
  });

  it('records nothing when it promoted nothing', async () => {
    const { service, prisma, audit } = buildService();
    prisma.pharmacy.updateMany.mockResolvedValue({ count: 0 });

    await addStock(service);

    expect(
      audit.write.mock.calls.some(([, action]) => action === 'pharmacy.classification.promote'),
    ).toBe(false);
  });

  it('records the change when it did promote', async () => {
    const { service, audit } = buildService();

    await addStock(service);

    const entry = audit.write.mock.calls.find(
      ([, action]) => action === 'pharmacy.classification.promote',
    );
    expect(entry).toBeDefined();
    expect(entry![4]).toMatchObject({
      from: CommercialClassification.DIRECTORY_UNCLAIMED,
      to: CommercialClassification.VERIFIED_NETWORK_CORE,
    });
  });
});

describe('every path that can first make a pharmacy reportable', () => {
  it('promotes after a manual inventory add', async () => {
    const { service, prisma } = buildService();

    await addStock(service);

    expect(promotion(prisma)).toBeDefined();
  });

  it('promotes after a CSV import — the path integration feeds also use', async () => {
    // PharmacyIntegrationService.importRows calls importCsv, so the feed sync
    // and the Uploads tab share this one point.
    const { service, prisma } = buildService();

    await service.importCsv(
      PHARMACY,
      [{ name: 'Dolo 650', strength: '650 mg', dosageform: 'Tablet', status: 'available' }],
      'merge',
      USER,
      '10.0.0.1',
    );

    expect(promotion(prisma)).toBeDefined();
  });
});

describe('the allowlist is still the authority on visibility', () => {
  it('never lists an unclaimed record as patient-visible', async () => {
    expect(PATIENT_VISIBLE_CLASSIFICATIONS).not.toContain(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
  });

  it('lists the classification the promotion targets', async () => {
    // The two halves meet: promotion writes what the filter admits.
    expect(PATIENT_VISIBLE_CLASSIFICATIONS).toContain(
      CommercialClassification.VERIFIED_NETWORK_CORE,
    );
  });

  it('still excludes CLAIMED_PENDING', async () => {
    expect(PATIENT_VISIBLE_CLASSIFICATIONS).not.toContain(
      CommercialClassification.CLAIMED_PENDING,
    );
  });
});
