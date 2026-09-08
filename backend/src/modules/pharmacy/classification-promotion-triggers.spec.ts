import {
  CommercialClassification,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyAdminService } from '../admin/pharmacy/pharmacy-admin.service';
import { VerificationService } from '../admin/verification/verification.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';
import { PROMOTABLE_WHERE, promotableWhere } from './classification-promotion';
import { VISIBLE_SIGNAL_WHERE } from '../availability/availability.visibility';

/**
 * Which of the three conditions is allowed to be the last one.
 *
 * The network classification needs all of: an approved licence, a listable
 * record (verified and located — every patient search is distance-bounded), and
 * stock a patient could be shown. Whichever arrives last is what should promote.
 *
 * Only one of the three was ever wired up. `promoteClaimedByReporting` was
 * called from the inventory writes alone, so a pharmacy that reported stock
 * before it had a map pin failed the listable check and nothing re-asked the
 * question when the pin arrived. The operator pasted their Maps link, their own
 * profile said "listed to patients", the admin console said Directory
 * (unclaimed), and no patient search returned them — until they happened to
 * re-upload inventory, which is what actually made it work and is why it looked
 * like inventory was a second, undocumented step.
 *
 * These specs pin the trigger to the condition rather than to the path: every
 * write that can satisfy the last one attempts the promotion.
 */

const PHARMACY = 'ph_1';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'owner@zoiko.in',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: PHARMACY,
};

/** The promotion write, if one was attempted on this client. */
const attempt = (prisma: any) =>
  prisma.pharmacy.updateMany.mock.calls.find(
    ([args]: [any]) =>
      args?.data?.commercialClassification ===
      CommercialClassification.VERIFIED_NETWORK_CORE,
  )?.[0];

describe('the rule the promotion is guarded by', () => {
  it('requires an approved licence', () => {
    expect(PROMOTABLE_WHERE.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('requires a listable record — which is where the map location comes in', () => {
    expect(PROMOTABLE_WHERE.isParticipating).toBe(true);
  });

  it('requires stock a patient could actually be shown', () => {
    expect(PROMOTABLE_WHERE.availabilitySignals).toEqual({ some: VISIBLE_SIGNAL_WHERE });
  });

  it('can only ever match a record nobody has claimed', () => {
    expect(PROMOTABLE_WHERE.commercialClassification).toBe(
      CommercialClassification.DIRECTORY_UNCLAIMED,
    );
  });

  it('scopes to one pharmacy when asked about one', () => {
    expect(promotableWhere(PHARMACY)).toEqual({ id: PHARMACY, ...PROMOTABLE_WHERE });
  });
});

/**
 * The pharmacy's own profile save — the path the operator actually takes, and
 * the one the report was about.
 */
describe('a pharmacy adding its address and map location', () => {
  /** A verified, unclaimed record that has no pin yet. */
  const unlocated = {
    id: PHARMACY,
    name: 'Zoiko Meds Pharmacy',
    licenseNumber: 'LIC-JHC951',
    phone: '+91 40 2345 6789',
    addressLine1: 'Gandimaisamma',
    addressLine2: null,
    city: 'Hyderabad',
    region: 'Telangana',
    country: 'IN',
    postalCode: '500043',
    jurisdictionId: 'jur_in',
    latitude: null,
    longitude: null,
    locationPrecision: null,
    logoUpdatedAt: null,
    verificationStatus: VerificationStatus.VERIFIED,
    isParticipating: false,
    reliabilityScore: 0.9,
    commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
  };

  function buildService(geocoded: { lat: number; lng: number } | null) {
    const prisma: any = {
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue(unlocated),
        // The duplicate-location probe.
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }: any) => ({ ...unlocated, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ pharmacyId: PHARMACY }),
        update: jest.fn(),
      // How many active operator accounts are linked, which the patient
      // visibility rule now reads (ACTIVE_PHARMACY_MANAGER_WHERE). These
      // fixtures are pharmacies an operator is signed in to, so: one.
        count: jest.fn().mockResolvedValue(1),
      },
      verificationRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ changeKinds: [] }),
        create: jest.fn(async ({ data }: any) => ({ id: 'req_new', ...data })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      verificationDocument: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
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
      {
        geocode: jest
          .fn()
          .mockResolvedValue(
            geocoded
              ? { lat: geocoded.lat, lng: geocoded.lng, precise: true, granularity: 'ROOFTOP' }
              : null,
          ),
      } as unknown as NearbyPharmacyService,
    );
    return { service, prisma, audit };
  }

  const save = (service: PharmacyService, pin?: { latitude: number; longitude: number }) =>
    service.updateProfile(
      PHARMACY,
      { addressLine1: 'Gandimaisamma, Hyderabad', ...(pin ?? {}) } as never,
      USER,
      '10.0.0.1',
    );

  it('lists the pharmacy to patients', async () => {
    // The half that already worked, asserted here so the promotion below is
    // read as the step that was missing rather than a replacement for it.
    const { service, prisma } = buildService(null);

    await save(service, { latitude: 17.5878172, longitude: 78.4236196 });

    expect(prisma.pharmacy.update.mock.calls[0][0].data.isParticipating).toBe(true);
  });

  it('attempts the promotion in the same save', async () => {
    // Not on the next inventory upload. This is the fix: the save that supplies
    // the location is the save that promotes.
    const { service, prisma } = buildService(null);

    await save(service, { latitude: 17.5878172, longitude: 78.4236196 });

    expect(attempt(prisma)).toBeDefined();
  });

  it('promotes on a geocoded pin too, not only a pasted one', async () => {
    // An operator who types an address and never touches a map is the common
    // case; the pin is resolved for them, and it counts the same.
    const { service, prisma } = buildService({ lat: 17.5878172, lng: 78.4236196 });

    await save(service);

    expect(attempt(prisma)).toBeDefined();
  });

  it('promotes to exactly the network classification', async () => {
    const { service, prisma } = buildService({ lat: 17.5878172, lng: 78.4236196 });

    await save(service);

    expect(attempt(prisma).data).toEqual({
      commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    });
  });

  it('carries every condition in its where, so an ineligible record is untouched', async () => {
    const { service, prisma } = buildService({ lat: 17.5878172, lng: 78.4236196 });

    await save(service);

    expect(attempt(prisma).where).toEqual(promotableWhere(PHARMACY));
  });

  it('says in the audit trail that becoming listable was what unblocked it', async () => {
    const { service, audit } = buildService({ lat: 17.5878172, lng: 78.4236196 });

    await save(service);

    const entry = audit.write.mock.calls.find(
      ([, action]: any[]) => action === 'pharmacy.classification.promote',
    );
    expect(entry).toBeDefined();
    expect(entry[4].reason).toMatch(/listable/i);
  });

  it('attempts nothing when the save left the pharmacy without a location', async () => {
    // Geocoding failed and no pin was pasted: still not listable, so there is
    // nothing to promote and no write to make.
    const { service, prisma } = buildService(null);

    await save(service);

    expect(prisma.pharmacy.update.mock.calls[0][0].data.isParticipating).toBe(false);
    expect(attempt(prisma)).toBeUndefined();
  });
});

/** The admin console can supply the missing location too. */
describe('an admin locating the record from Pharmacy Management', () => {
  const existing = {
    id: PHARMACY,
    name: 'Zoiko Meds Pharmacy',
    licenseNumber: 'LIC-JHC951',
    latitude: null,
    longitude: null,
    locationPrecision: null,
    country: 'IN',
    verificationStatus: VerificationStatus.VERIFIED,
    isParticipating: false,
    reliabilityScore: 0.9,
    commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
  };

  function buildService() {
    const tx: any = {
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue(existing),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      verificationRequest: { updateMany: jest.fn() },
      jurisdiction: { upsert: jest.fn().mockResolvedValue({ id: 'jur_in', code: 'IN' }) },
    };
    const prisma: any = {
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue(existing),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new PharmacyAdminService(
      prisma as unknown as PrismaService,
      { write: jest.fn() } as unknown as AuditWriter,
      { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
    );
    return { service, prisma, tx };
  }

  it('attempts the promotion when the edit pins the pharmacy', async () => {
    const { service, prisma } = buildService();

    await service.update(
      'admin_1',
      PHARMACY,
      { latitude: 17.5878172, longitude: 78.4236196 } as never,
      '10.0.0.1',
    );

    expect(attempt(prisma)).toBeDefined();
  });

  it('attempts it per record on a bulk approval, never on a neighbour standing', async () => {
    const { service, prisma } = buildService();

    await service.bulkSetStatus('admin_1', ['ph_1', 'ph_2'], VerificationStatus.VERIFIED);

    const scoped = prisma.pharmacy.updateMany.mock.calls
      .filter(
        ([a]: [any]) =>
          a?.data?.commercialClassification ===
          CommercialClassification.VERIFIED_NETWORK_CORE,
      )
      .map(([a]: [any]) => a.where.id);
    expect(scoped).toEqual(['ph_1', 'ph_2']);
  });

  it('attempts nothing on a bulk suspension', async () => {
    // Only VERIFIED can make a record newly promotable.
    const { service, prisma } = buildService();

    await service.bulkSetStatus('admin_1', ['ph_1'], VerificationStatus.SUSPENDED);

    expect(attempt(prisma)).toBeUndefined();
  });
});

/** And so can the reviewer, by approving a pharmacy that is already reporting. */
describe('a reviewer approving a located, reporting pharmacy', () => {
  const REQUEST = {
    id: 'req_1',
    pharmacyId: PHARMACY,
    pharmacyName: 'Zoiko Meds Pharmacy',
    licenseNumber: 'LIC-JHC951',
    submittedBy: 'Keiko Tanaka (owner@zoiko.in)',
    status: 'PENDING',
    notes: null,
  };

  function buildService() {
    const tx: any = {
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(REQUEST),
        update: jest.fn(async () => ({ ...REQUEST, status: 'APPROVED' })),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'admin_1', fullName: 'Super Admin' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'user_1', pharmacyId: PHARMACY }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      pharmacy: {
        update: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          latitude: 17.5878172,
          longitude: 78.4236196,
          name: 'Zoiko Meds Pharmacy',
          licenseNumber: 'LIC-JHC951',
        }),
      },
      signalNotification: { create: jest.fn() },
      pharmacyNotificationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          inventoryAlerts: true,
          verificationUpdates: true,
          uploadResults: true,
          systemMessages: true,
        }),
      },
    };
    const prisma: any = {
      pharmacy: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      verificationRequest: {
        findUnique: jest.fn().mockResolvedValue(REQUEST),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new VerificationService(
      prisma as unknown as PrismaService,
      { write: jest.fn() } as unknown as AuditWriter,
    );
    return { service, prisma };
  }

  it('attempts the promotion as part of the approval', async () => {
    const { service, prisma } = buildService();

    await service.update(
      'admin_1',
      'req_1',
      { status: VerificationRequestStatus.APPROVED } as never,
      '10.0.0.1',
    );

    expect(attempt(prisma).where).toEqual(promotableWhere(PHARMACY));
  });

  it('attempts nothing on a rejection', async () => {
    const { service, prisma } = buildService();

    await service.update(
      'admin_1',
      'req_1',
      { status: VerificationRequestStatus.REJECTED } as never,
      '10.0.0.1',
    );

    expect(attempt(prisma)).toBeUndefined();
  });
});
