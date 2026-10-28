import { AvailabilityService } from './availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { SignalIngestService } from '../signal/signal-ingest.service';
import { MeService } from '../me/me.service';
import { PatientSignalService } from '../me/signal/patient-signal.service';
import { NotificationPreferencesService } from '../pharmacy/notification-preferences.service';
import { PharmacyNotificationService } from '../pharmacy/notifications/pharmacy-notification.service';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import {
  ACTIVE_PHARMACY_MANAGER_WHERE,
  PUBLIC_PHARMACY_WHERE,
  publicPharmacyWhere,
  publicSignalsInclude,
  publicSignalWhere,
} from './availability.visibility';

/**
 * Two builds of the shared rule, compared.
 *
 * The rule now carries the instant it was built — a trial is live until its own
 * end date, so the clause is `evaluationEndsAt > <now>` — and two calls a
 * millisecond apart therefore differ in exactly one value and nowhere else.
 * That single value is normalised away here; everything else still has to match
 * exactly, which is the whole point of these tests. Identity (`toBe`) stopped
 * being the right question once the rule became a function rather than a frozen
 * object.
 */
const sameRule = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? null), (key: string, v: unknown) =>
    key === 'gt' ? '<built-at>' : v,
  );

/**
 * Every patient-facing query asks the same visibility question.
 *
 * The rule lives in one object, but that only helps if every surface reads it.
 * The two ways this has actually gone wrong here are worth stating, because
 * this spec exists to catch both:
 *
 *   - A surface restates the rule locally. `GET /pharmacies` did: it asked for
 *     verification and participation and stopped there, so an unclaimed
 *     pharmacy was listed on a public route while search correctly hid it.
 *   - A gate is added to the shared rule and one surface is left behind. The
 *     active-operator clause is the newest, and a delinked pharmacy hidden from
 *     search but still returned by saved-medicine alerts would be the same
 *     class of bug wearing different clothes.
 *
 * So each surface is called for real and the filter it hands Prisma is compared
 * against the shared object — not against a copy of its contents, which is what
 * lets two statements of one rule drift apart. Adding a patient surface without
 * adding it here is the gap this cannot close; adding a gate without updating a
 * surface is the one it can.
 */

/** The clause added most recently, and the one a stale surface would lack. */
const OPERATOR_CLAUSE = ACTIVE_PHARMACY_MANAGER_WHERE.users;

function pharmacyService(prisma: any) {
  return new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {} as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    {} as unknown as NearbyPharmacyService,
  );
}

function meService(prisma: any) {
  return new MeService(
    prisma as unknown as PrismaService,
    {
      resolveOrigin: jest.fn().mockResolvedValue(null),
      // Search also offers internet pharmacies alongside the local ones; that
      // provider is not the subject here, so it returns nothing.
      findNearby: jest.fn().mockResolvedValue([]),
    } as unknown as NearbyPharmacyService,
    {
      recordSearch: jest.fn(),
      recordZeroResult: jest.fn(),
    } as unknown as SignalIngestService,
  );
}

function signalService(prisma: any) {
  return new PatientSignalService(
    prisma as unknown as PrismaService,
    { resolveOrigin: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );
}

describe('/availability — medicine availability', () => {
  it('filters signals through the shared rule', async () => {
    const prisma: any = {
      // Covered by an active plan, so these specs keep testing the gate
      // they are about rather than the billing one. See commercial-visibility.spec.ts
      // for the tests that exercise this gate directly.
      subscriptionLocation: {
        findMany: jest.fn().mockResolvedValue([
          { subscription: { state: 'ACTIVE', evaluationEndsAt: null } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      availabilitySignal: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await new AvailabilityService(prisma as unknown as PrismaService).getAvailability('med_1');
    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];

    expect(sameRule(args.where.pharmacy)).toEqual(sameRule(publicPharmacyWhere()));
    expect(args.where.confidence).toEqual(publicSignalWhere().confidence);
  });

  it('carries the operator clause with it', async () => {
    const prisma: any = {
      // Covered by an active plan, so these specs keep testing the gate
      // they are about rather than the billing one. See commercial-visibility.spec.ts
      // for the tests that exercise this gate directly.
      subscriptionLocation: {
        findMany: jest.fn().mockResolvedValue([
          { subscription: { state: 'ACTIVE', evaluationEndsAt: null } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      availabilitySignal: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await new AvailabilityService(prisma as unknown as PrismaService).getAvailability('med_1');
    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];

    expect(args.where.pharmacy.users).toEqual(OPERATOR_CLAUSE);
  });
});

describe('/me/search — patient medicine search', () => {
  it('nests the shared include on the signals it reads', async () => {
    const prisma: any = {
      // Covered by an active plan, so these specs keep testing the gate
      // they are about rather than the billing one. See commercial-visibility.spec.ts
      // for the tests that exercise this gate directly.
      subscriptionLocation: {
        findMany: jest.fn().mockResolvedValue([
          { subscription: { state: 'ACTIVE', evaluationEndsAt: null } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      searchHistory: { create: jest.fn() },
      medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await meService(prisma).search('user_1', { q: 'paracetamol' } as never);
    const [args] = prisma.medicineEntity.findMany.mock.calls[0];

    expect(sameRule(args.include.availabilitySignals)).toEqual(sameRule(publicSignalsInclude()));
    expect(args.include.availabilitySignals.where.pharmacy.users).toEqual(OPERATOR_CLAUSE);
  });
});

describe('/me/pharmacies — the nearby pharmacy list', () => {
  it('spreads the shared rule into its query', async () => {
    const prisma: any = { pharmacy: { findMany: jest.fn().mockResolvedValue([]) } };

    await meService(prisma).pharmacies();
    const [args] = prisma.pharmacy.findMany.mock.calls[0];

    // Spread rather than referenced, because this query adds a medicine clause
    // of its own — so the fields are compared instead of the object identity.
    expect(args.where).toMatchObject(PUBLIC_PHARMACY_WHERE);
    expect(args.where.users).toEqual(OPERATOR_CLAUSE);
  });
});

describe('/me/saved — saved medicines', () => {
  it('nests the shared include under the saved medicine', async () => {
    const prisma: any = { savedMedicine: { findMany: jest.fn().mockResolvedValue([]) } };

    await meService(prisma).listSaved('user_1');
    const [args] = prisma.savedMedicine.findMany.mock.calls[0];

    expect(sameRule(args.include.medicine.include.availabilitySignals)).toEqual(
      sameRule(publicSignalsInclude()),
    );
    expect(
      args.include.medicine.include.availabilitySignals.where.pharmacy.users,
    ).toEqual(OPERATOR_CLAUSE);
  });
});

describe('ZoikoSignal — the alerts a saved medicine drives', () => {
  it('reads signals through the shared include', async () => {
    // The private loader is called directly: the public read surface runs a
    // regeneration pass first, and the subject here is the query that decides
    // which pharmacies may drive an alert at all.
    const prisma: any = { savedMedicine: { findMany: jest.fn().mockResolvedValue([]) } };

    await (signalService(prisma) as any).loadSavedWithSignals('user_1');
    const [args] = prisma.savedMedicine.findMany.mock.calls[0];

    expect(sameRule(args.include.medicine.include.availabilitySignals)).toEqual(
      sameRule(publicSignalsInclude()),
    );
    expect(
      args.include.medicine.include.availabilitySignals.where.pharmacy.users,
    ).toEqual(OPERATOR_CLAUSE);
  });
});

describe('GET /pharmacies and /pharmacies/:id — the public routes', () => {
  it('the list passes the shared rule itself', async () => {
    const prisma: any = { pharmacy: { findMany: jest.fn().mockResolvedValue([]) } };

    await pharmacyService(prisma).listVerified();
    const [args] = prisma.pharmacy.findMany.mock.calls[0];

    expect(sameRule(args.where)).toEqual(sameRule(publicPharmacyWhere()));
  });

  it('the detail route adds only the id to it', async () => {
    const prisma: any = { pharmacy: { findFirst: jest.fn().mockResolvedValue(null) } };

    await pharmacyService(prisma)
      .findById('ph_1')
      .catch(() => undefined); // 404 for a hidden pharmacy; the query is the subject.
    const [args] = prisma.pharmacy.findFirst.mock.calls[0];

    expect(sameRule(args.where)).toEqual(sameRule({ id: 'ph_1', ...publicPharmacyWhere() }));
    expect(args.where.users).toEqual(OPERATOR_CLAUSE);
  });
});

describe('the pharmacy portal reads the same rule it is judged by', () => {
  it('asks for active operator accounts before saying patients can see them', async () => {
    // The banner and the patient queries have to agree. This is the surface
    // where disagreeing is worst: it tells the operator they are live.
    const prisma: any = {
      // Covered by an active plan, so these specs keep testing the gate
      // they are about rather than the billing one. See commercial-visibility.spec.ts
      // for the tests that exercise this gate directly.
      subscriptionLocation: {
        findMany: jest.fn().mockResolvedValue([
          { subscription: { state: 'ACTIVE', evaluationEndsAt: null } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ph_1',
          name: 'Corner Chemist',
          verificationStatus: 'VERIFIED',
          isParticipating: true,
          commercialClassification: 'VERIFIED_NETWORK_CORE',
          latitude: 17.4,
          longitude: 78.5,
          reliabilityScore: 0.9,
          logoUpdatedAt: null,
        }),
      },
      verificationRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
    };

    const profile = await pharmacyService(prisma).getProfile('ph_1');

    expect(prisma.user.count).toHaveBeenCalled();
    const [args] = prisma.user.count.mock.calls[0];
    expect(args.where.role).toEqual(OPERATOR_CLAUSE!.some!.role);
    expect(args.where.isActive).toBe(true);
    // Nobody is running it, so the portal must not claim otherwise.
    expect(profile.patientVisible).toBe(false);
  });
});
