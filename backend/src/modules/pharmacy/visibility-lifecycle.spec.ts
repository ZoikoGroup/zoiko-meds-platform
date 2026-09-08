import {
  AvailabilityConfidence,
  CommercialClassification,
  UserRole,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { VerificationService } from '../admin/verification/verification.service';
import {
  PATIENT_VISIBLE_CLASSIFICATIONS,
  PHARMACY_OPERATOR_ROLES,
  PUBLIC_PHARMACY_WHERE,
  isPatientVisible,
} from '../availability/availability.visibility';

/**
 * What happens to a pharmacy's patient visibility when its verification is
 * approved — and specifically, whether stock it reported *before* approval
 * becomes searchable without being uploaded again.
 *
 * The reported symptom: verification completes, the Super Admin console shows
 * the pharmacy as networked, the pharmacy's own profile says "you're all set",
 * and patients still cannot find it. Re-uploading the same inventory makes it
 * searchable immediately.
 *
 * Three gates decide whether patients see a pharmacy, and only one of them can
 * be moved by an inventory write:
 *
 *   verificationStatus  approval sets it
 *   isParticipating     approval recomputes it from the coordinates
 *   classification      DIRECTORY_UNCLAIMED is not patient-visible, and the
 *                       promotion out of it requires all three conditions —
 *                       approved, listable, and reporting stock
 *
 * So if re-uploading fixes visibility, the pharmacy was still
 * DIRECTORY_UNCLAIMED after approval and the upload promoted it. This runs the
 * real VerificationService against an in-memory database that honours the
 * where-clauses, so the answer comes from the code rather than from reasoning
 * about it.
 */

const PHARMACY_ID = 'ph_1';
const REQUEST_ID = 'req_1';
const OWNER_ID = 'user_owner';

type Row = Record<string, any>;

/**
 * An in-memory Prisma faithful to the clauses this flow depends on.
 *
 * The relation filter matters most: `promotableWhere` asks for a pharmacy with
 * `availabilitySignals: { some: { confidence: { not: SUPPRESSED } } }`, and a
 * stub that ignored it would report a promotion that the real database would
 * refuse — exactly the bug under investigation.
 */
function buildWorld({
  pharmacy,
  signals = [],
  accounts,
}: {
  pharmacy: Row;
  signals?: Row[];
  /**
   * The accounts linked to this pharmacy.
   *
   * Defaults to one active admin, because a pharmacy that submitted a
   * verification request and uploaded stock did both through an account. The
   * tests that care pass an empty list.
   */
  accounts?: Row[];
}) {
  const pharmacies: Row[] = [{ ...pharmacy }];
  const availabilitySignals: Row[] = signals.map((s) => ({ ...s }));
  const requests: Row[] = [
    {
      id: REQUEST_ID,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      licenseNumber: pharmacy.licenseNumber,
      submittedBy: 'Owner (owner@pharmacy.test)',
      status: VerificationRequestStatus.PENDING,
      reviewer: null,
      notes: null,
      docName: null,
      docUrl: null,
      previousDocName: null,
      changeKinds: [],
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    },
  ];
  const users: Row[] = (
    accounts ?? [
      {
        id: OWNER_ID,
        email: 'owner@pharmacy.test',
        fullName: 'Owner',
        pharmacyId: pharmacy.id,
        role: UserRole.PHARMACY_ADMIN,
        isActive: true,
      },
    ]
  ).map((u) => ({ ...u }));
  const notifications: Row[] = [];

  const signalsFor = (pharmacyId: string) =>
    availabilitySignals.filter((s) => s.pharmacyId === pharmacyId);

  /** Is an active operator account linked? The patient rule's fourth gate. */
  const hasActiveManager = (pharmacyId: string) =>
    users.some(
      (u) =>
        u.pharmacyId === pharmacyId &&
        u.isActive === true &&
        PHARMACY_OPERATOR_ROLES.includes(u.role),
    );

  const matchesPharmacy = (row: Row, where: any = {}): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.name?.equals !== undefined) {
      if (String(row.name).toLowerCase() !== String(where.name.equals).toLowerCase()) return false;
    }
    if (where.licenseNumber !== undefined && row.licenseNumber !== where.licenseNumber) return false;
    if (where.verificationStatus !== undefined && row.verificationStatus !== where.verificationStatus)
      return false;
    if (where.isParticipating !== undefined && row.isParticipating !== where.isParticipating)
      return false;
    if (where.commercialClassification !== undefined) {
      const clause = where.commercialClassification;
      if (typeof clause === 'string') {
        if (row.commercialClassification !== clause) return false;
      } else if (clause?.in && !clause.in.includes(row.commercialClassification)) {
        return false;
      }
    }
    // The relation filter the patient rule turns on: an active operator.
    if (where.users?.some !== undefined) {
      const some = where.users.some ?? {};
      const ok = users.some((u) => {
        if (u.pharmacyId !== row.id) return false;
        if (some.isActive !== undefined && u.isActive !== some.isActive) return false;
        if (some.role?.in && !some.role.in.includes(u.role)) return false;
        return true;
      });
      if (!ok) return false;
    }
    // The relation filter the promotion turns on.
    if (where.availabilitySignals?.some !== undefined) {
      const some = where.availabilitySignals.some ?? {};
      const ok = signalsFor(row.id).some((signal) => {
        if (some.confidence?.not !== undefined && signal.confidence === some.confidence.not) {
          return false;
        }
        return true;
      });
      if (!ok) return false;
    }
    return true;
  };

  const db: any = {
    pharmacy: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = pharmacies.find((p) => p.id === where.id);
        return row ? { ...row } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const row = pharmacies.find((p) => matchesPharmacy(p, where));
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        pharmacies.filter((p) => matchesPharmacy(p, where)).map((p) => ({ ...p })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = pharmacies.find((p) => p.id === where.id);
        if (!row) throw new Error('no such pharmacy');
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = pharmacies.filter((p) => matchesPharmacy(p, where));
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ph_${pharmacies.length + 1}`, ...data };
        pharmacies.push(row);
        return { ...row };
      }),
    },
    availabilitySignal: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        availabilitySignals
          .filter((s) => (where?.pharmacyId ? s.pharmacyId === where.pharmacyId : true))
          .map((s) => ({ ...s })),
      ),
      count: jest.fn(async ({ where }: any = {}) => signalsFor(where?.pharmacyId).length),
    },
    verificationRequest: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) return null;
        const pharmacy = pharmacies.find((p) => p.id === row.pharmacyId);
        return { ...row, pharmacy: pharmacy ? { ...pharmacy } : null, document: null };
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        requests
          .filter((r) => {
            if (where?.pharmacyId?.in && !where.pharmacyId.in.includes(r.pharmacyId)) return false;
            if (where?.status !== undefined && r.status !== where.status) return false;
            return true;
          })
          .map((r) => ({ ...r })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = requests.find((r) => r.id === where.id);
        Object.assign(row!, data);
        const pharmacy = pharmacies.find((p) => p.id === row!.pharmacyId);
        return { ...row!, pharmacy: pharmacy ? { ...pharmacy } : null, document: null };
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = users.find((u) => u.id === where.id);
        return row ? { ...row } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const wanted = String(where?.email?.equals ?? '').toLowerCase();
        const row = users.find((u) => u.email.toLowerCase() === wanted);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async () => users.map((u) => ({ ...u }))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = users.find((u) => u.id === where.id);
        Object.assign(row!, data);
        return { ...row! };
      }),
    },
    pharmacyNotificationPreference: {
      findUnique: jest.fn(async () => null),
    },
    signalNotification: {
      create: jest.fn(async ({ data }: any) => {
        notifications.push(data);
        return data;
      }),
    },
  };
  db.$transaction = jest.fn(async (cb: any) => cb(db));

  const service = new VerificationService(
    db as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );

  return {
    service,
    db,
    /** The pharmacy row as it now stands. */
    row: () => ({ ...pharmacies.find((p) => p.id === pharmacy.id)! }),
    /**
     * The shared patient-visibility rule, asked of the current row.
     *
     * `hasActiveManager` is read out of the in-memory user table rather than
     * hardcoded, so a test that unlinks an account gets the answer the database
     * would give.
     */
    visible: () =>
      isPatientVisible({
        ...(pharmacies.find((p) => p.id === pharmacy.id)! as any),
        hasActiveManager: hasActiveManager(pharmacy.id),
      }),
    signals: () => availabilitySignals.map((s) => ({ ...s })),
    /** Unlink every account from the pharmacy, the way a Super Admin can. */
    unlinkAllAccounts: () => {
      for (const u of users) if (u.pharmacyId === pharmacy.id) u.pharmacyId = null;
    },
    /** Link one back. */
    relinkAccount: (role: UserRole = UserRole.PHARMACY_ADMIN) => {
      users.push({
        id: `user_${users.length + 1}`,
        email: `staff${users.length + 1}@pharmacy.test`,
        fullName: 'Relinked operator',
        pharmacyId: pharmacy.id,
        role,
        isActive: true,
      });
    },
    /** Which pharmacies a patient query would return right now. */
    patientQuery: (where: Row) =>
      pharmacies.filter((p) => matchesPharmacy(p, where)).map((p) => ({ ...p })),
  };
}

/** A pharmacy that has done everything except be approved. */
const awaitingApproval = (over: Row = {}): Row => ({
  id: PHARMACY_ID,
  name: 'Corner Chemist',
  licenseNumber: 'LIC-CORNER',
  verificationStatus: VerificationStatus.PENDING,
  isParticipating: false,
  // Every new pharmacy starts here — it is the schema default.
  commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
  latitude: 17.4,
  longitude: 78.5,
  reliabilityScore: 0,
  ...over,
});

/** Stock the pharmacy reported before anyone approved it. */
const reportedStock = (count = 3) =>
  Array.from({ length: count }, (_, index) => ({
    id: `sig_${index}`,
    pharmacyId: PHARMACY_ID,
    medicineId: `med_${index}`,
    confidence: AvailabilityConfidence.HIGH,
  }));

const approve = (service: VerificationService) =>
  service.update('admin_1', REQUEST_ID, { status: VerificationRequestStatus.APPROVED } as never);

describe('H. inventory reported before verification', () => {
  it('is not visible to patients while the pharmacy is unapproved', async () => {
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: reportedStock() });

    expect(world.visible()).toBe(false);
  });

  it('becomes visible on approval, with no second upload', async () => {
    // The reported defect, stated as a test. If this fails, approval left the
    // pharmacy in a state only an inventory write could complete.
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: reportedStock() });

    await approve(world.service);

    expect(world.visible()).toBe(true);
  });

  it('passes all three gates after approval', async () => {
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: reportedStock() });

    await approve(world.service);
    const row = world.row();

    expect(row.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(row.isParticipating).toBe(true);
    expect(PATIENT_VISIBLE_CLASSIFICATIONS).toContain(row.commercialClassification);
  });

  it('duplicates no inventory and changes no stock', async () => {
    const before = reportedStock();
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: before });

    await approve(world.service);

    expect(world.signals()).toHaveLength(before.length);
    expect(world.signals()).toEqual(before);
  });
});

describe('approval alone does not publish a pharmacy that fails another gate', () => {
  it('leaves an unlocated pharmacy unpublished', async () => {
    // No coordinates means no distance-bounded search can return it, so
    // approval verifies the licence without listing the record.
    const world = buildWorld({
      pharmacy: awaitingApproval({ latitude: null, longitude: null }),
      signals: reportedStock(),
    });

    await approve(world.service);

    expect(world.row().verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(world.row().isParticipating).toBe(false);
    expect(world.visible()).toBe(false);
  });

  it('does not promote a pharmacy that has reported nothing', async () => {
    // Approval says the licence is real; it does not say anybody is standing
    // behind the stock levels, and with no stock reported nobody is.
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: [] });

    await approve(world.service);

    expect(world.row().commercialClassification).toBe(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
    expect(world.visible()).toBe(false);
  });

  it('does not promote on the strength of a suppressed signal', async () => {
    // SUPPRESSED is the governed "do not publish this" state. A pharmacy whose
    // only stock is withheld has reported nothing a patient could be shown.
    const world = buildWorld({
      pharmacy: awaitingApproval(),
      signals: [{ ...reportedStock(1)[0], confidence: AvailabilityConfidence.SUPPRESSED }],
    });

    await approve(world.service);

    expect(world.row().commercialClassification).toBe(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
  });

  it('E. leaves a classification patients are not shown exactly as it was', async () => {
    // CLAIMED_PENDING is not DIRECTORY_UNCLAIMED, so the promotion may never
    // rewrite it — approval must not quietly advance a claim nobody proved.
    const world = buildWorld({
      pharmacy: awaitingApproval({
        commercialClassification: CommercialClassification.CLAIMED_PENDING,
      }),
      signals: reportedStock(),
    });

    await approve(world.service);

    expect(world.row().commercialClassification).toBe(CommercialClassification.CLAIMED_PENDING);
    expect(world.visible()).toBe(false);
  });

  it('never downgrades a pharmacy already in the network', async () => {
    const world = buildWorld({
      pharmacy: awaitingApproval({
        commercialClassification: CommercialClassification.PRO_ACTIVE,
      }),
      signals: reportedStock(),
    });

    await approve(world.service);

    expect(world.row().commercialClassification).toBe(CommercialClassification.PRO_ACTIVE);
  });
});

describe('B, C, D. decisions other than approval keep the pharmacy hidden', () => {
  it.each([
    ['rejected', VerificationRequestStatus.REJECTED, VerificationStatus.REJECTED],
    ['sent back for information', VerificationRequestStatus.REQUEST_INFO, VerificationStatus.INFO_REQUESTED],
  ])('a %s request publishes nothing', async (_label, decision, expected) => {
    const world = buildWorld({ pharmacy: awaitingApproval(), signals: reportedStock() });

    await world.service.update('admin_1', REQUEST_ID, { status: decision } as never);

    expect(world.row().verificationStatus).toBe(expected);
    expect(world.row().isParticipating).toBe(false);
    expect(world.visible()).toBe(false);
  });

  it('a suspended pharmacy stays hidden even with stock and a network classification', async () => {
    const world = buildWorld({
      pharmacy: awaitingApproval({
        verificationStatus: VerificationStatus.SUSPENDED,
        isParticipating: false,
        commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
      }),
      signals: reportedStock(),
    });

    expect(world.visible()).toBe(false);
  });
});

/**
 * The other half of the lifecycle: what happens to a published pharmacy when
 * the accounts running it go away.
 *
 * A pharmacy is promoted to VERIFIED_NETWORK_CORE once and keeps that
 * classification for good — the field records that somebody claimed it, and it
 * has no way to say that they left. So unlinking the last account left the
 * pharmacy, and every medicine it had reported, in patient search with nobody
 * answering for any of it.
 *
 * The `PUBLIC_PHARMACY_WHERE` query is run against the in-memory database here
 * rather than the predicate alone, because the query is what a patient search
 * actually executes and the two used to be able to drift.
 */
const published = (over: Row = {}): Row =>
  awaitingApproval({
    verificationStatus: VerificationStatus.VERIFIED,
    isParticipating: true,
    commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    ...over,
  });

describe('F. a pharmacy that loses its last linked account', () => {
  const withStock = () => buildWorld({ pharmacy: published(), signals: reportedStock() });

  it('was visible while an account was linked', async () => {
    const world = withStock();

    expect(world.visible()).toBe(true);
    expect(world.patientQuery(PUBLIC_PHARMACY_WHERE as Row)).toHaveLength(1);
  });

  it('drops out of patient search once the last account is unlinked', async () => {
    const world = withStock();

    world.unlinkAllAccounts();

    expect(world.visible()).toBe(false);
    expect(world.patientQuery(PUBLIC_PHARMACY_WHERE as Row)).toHaveLength(0);
  });

  it('keeps the pharmacy record — this is not a deletion', async () => {
    const world = withStock();

    world.unlinkAllAccounts();

    expect(world.row().name).toBe('Corner Chemist');
    expect(world.row().licenseNumber).toBe('LIC-CORNER');
  });

  it('keeps the inventory it reported', async () => {
    const before = reportedStock();
    const world = buildWorld({ pharmacy: published(), signals: before });

    world.unlinkAllAccounts();

    expect(world.signals()).toEqual(before);
  });

  it('keeps the verification history — losing an account is not a rejection', async () => {
    const world = withStock();

    world.unlinkAllAccounts();

    expect(world.row().verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('keeps the commercial classification it earned', async () => {
    // Nothing demotes the record. Being claimed is a fact about the past and
    // stays true; visibility asks about now, and asks the relation instead.
    const world = withStock();

    world.unlinkAllAccounts();

    expect(world.row().commercialClassification).toBe(
      CommercialClassification.VERIFIED_NETWORK_CORE,
    );
  });

  it('stays visible while one account of several remains', async () => {
    const world = buildWorld({
      pharmacy: published(),
      signals: reportedStock(),
      accounts: [
        { id: 'u_gone', email: 'gone@pharmacy.test', pharmacyId: null, role: UserRole.PHARMACY_ADMIN, isActive: true },
        { id: 'u_here', email: 'here@pharmacy.test', pharmacyId: PHARMACY_ID, role: UserRole.PHARMACY_STAFF, isActive: true },
      ],
    });

    expect(world.visible()).toBe(true);
    expect(world.patientQuery(PUBLIC_PHARMACY_WHERE as Row)).toHaveLength(1);
  });

  it('is hidden when its only account is deactivated rather than unlinked', async () => {
    // Both routes end in the same place: nobody can sign in to answer for the
    // stock, so patients are not shown it.
    const world = buildWorld({
      pharmacy: published(),
      signals: reportedStock(),
      accounts: [
        { id: 'u_off', email: 'off@pharmacy.test', pharmacyId: PHARMACY_ID, role: UserRole.PHARMACY_ADMIN, isActive: false },
      ],
    });

    expect(world.visible()).toBe(false);
  });

  it('is hidden when the only linked account is not an operator', async () => {
    const world = buildWorld({
      pharmacy: published(),
      signals: reportedStock(),
      accounts: [
        { id: 'u_pat', email: 'patient@example.test', pharmacyId: PHARMACY_ID, role: UserRole.PUBLIC, isActive: true },
      ],
    });

    expect(world.visible()).toBe(false);
  });
});

describe('G. relinking an account', () => {
  it('restores patient visibility with no inventory re-upload', async () => {
    const before = reportedStock();
    const world = buildWorld({ pharmacy: published(), signals: before });

    world.unlinkAllAccounts();
    const whileDelinked = world.visible();
    world.relinkAccount();

    expect(whileDelinked).toBe(false);
    expect(world.visible()).toBe(true);
    expect(world.patientQuery(PUBLIC_PHARMACY_WHERE as Row)).toHaveLength(1);
    // The point of the whole exercise: the same signals, never touched.
    expect(world.signals()).toEqual(before);
  });

  it('is restored by a staff account too, not only an admin', async () => {
    const world = buildWorld({ pharmacy: published(), signals: reportedStock() });

    world.unlinkAllAccounts();
    world.relinkAccount(UserRole.PHARMACY_STAFF);

    expect(world.visible()).toBe(true);
  });

  it('needs no reclassification, because nothing was demoted', async () => {
    const world = buildWorld({ pharmacy: published(), signals: reportedStock() });

    world.unlinkAllAccounts();
    world.relinkAccount();

    expect(world.row().commercialClassification).toBe(
      CommercialClassification.VERIFIED_NETWORK_CORE,
    );
  });
});
