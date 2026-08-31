import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * Notification preferences default to everything on, which is what every
 * account without a saved row gets. These specs are about other behaviour, so
 * they take the permissive stub.
 */
const allowAllPreferences = () =>
  ({
    get: async () => ({
      inventoryAlerts: true,
      verificationUpdates: true,
      uploadResults: true,
      systemMessages: true,
    }),
    allows: async () => true,
    allowedCategories: async () => new Set(['inventory', 'verification', 'upload', 'system']),
  }) as unknown as NotificationPreferencesService;


/**
 * Pharmacy onboarding: one record per physical pharmacy, each with its own
 * reachable contact number.
 *
 * Both are patient-facing guarantees. A second record for the same shop shows
 * as two cards for one place, and a card with no number cannot be acted on —
 * calling to confirm is the one thing the governance note asks a patient to do
 * before travelling.
 */

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'owner@zoiko.in',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: null,
};

const NEW_PHARMACY = {
  name: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-JHC951',
  phone: '+91 40 2345 6789',
  addressLine1: 'Gandimaisamma',
  city: 'Hyderabad',
  latitude: 17.5878172,
  longitude: 78.4236196,
};

/** A pharmacy row as the profile reader returns it. */
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'ph_1',
  name: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-JHC951',
  phone: '+91 40 2345 6789',
  addressLine1: 'Gandimaisamma',
  addressLine2: null,
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500043',
  latitude: 17.5878172,
  longitude: 78.4236196,
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  reliabilityScore: 0.9,
  commercialClassification: 'NETWORK_CORE',
  ...over,
});

function buildService(
  state: {
    neighbours?: Record<string, unknown>[];
    existing?: any;
    geocode?: { lat: number; lng: number; precise: boolean; granularity: string } | null;
  } = {},
) {
  const neighbours = state.neighbours ?? [];
  const geocode = jest.fn().mockResolvedValue(state.geocode ?? null);
  const tx = {
    pharmacy: { create: jest.fn(async ({ data }: any) => ({ id: 'ph_new', ...data })) },
    // Registering with a country resolves it to a Jurisdiction row.
    jurisdiction: { upsert: jest.fn().mockResolvedValue({ id: 'jur_in', code: 'IN' }) },
    user: { update: jest.fn() },
    verificationRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
  };

  const prisma: any = {
    pharmacy: {
      // The duplicate-location probe.
      findMany: jest.fn().mockResolvedValue(neighbours),
      findUnique: jest.fn().mockResolvedValue(state.existing ?? null),
      update: jest.fn(async ({ data }: any) => ({ ...stored(), ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ pharmacyId: null }), update: jest.fn() },
    verificationRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
    allowAllPreferences(),
    { geocode } as unknown as NearbyPharmacyService,
  );
  return { service, prisma, tx, geocode };
}

describe('registering a pharmacy — duplicate locations', () => {
  it('refuses a second registration at the same physical location', async () => {
    const { service, tx } = buildService({
      neighbours: [
        {
          id: 'ph_existing',
          name: 'Zoiko Meds Pharmacy',
          addressLine1: 'Gandimaisamma',
          city: 'Hyderabad',
          latitude: NEW_PHARMACY.latitude,
          longitude: NEW_PHARMACY.longitude,
        },
      ],
    });

    await expect(service.saveMyProfile(USER, NEW_PHARMACY as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Refused before the insert — no half-created duplicate to clean up.
    expect(tx.pharmacy.create).not.toHaveBeenCalled();
  });

  it('registers a pharmacy at a location nobody holds', async () => {
    const { service, tx, prisma } = buildService({ neighbours: [] });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, NEW_PHARMACY as never);

    expect(tx.pharmacy.create).toHaveBeenCalled();
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    // Its own coordinates, exactly as the operator's map link resolved them.
    expect(data.latitude).toBe(NEW_PHARMACY.latitude);
    expect(data.longitude).toBe(NEW_PHARMACY.longitude);
  });

  it('does not probe for neighbours when no coordinates were supplied', async () => {
    const { service, prisma } = buildService();
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(
      USER,
      { ...NEW_PHARMACY, latitude: undefined, longitude: undefined } as never,
    );

    expect(prisma.pharmacy.findMany).not.toHaveBeenCalled();
  });

  it('refuses to move an existing pharmacy onto another pharmacy\'s premises', async () => {
    const { service, prisma } = buildService({
      existing: stored(),
      neighbours: [
        {
          id: 'ph_other',
          name: 'Apollo Pharmacy',
          addressLine1: 'Prakruthi nivas',
          city: 'Gandimaisamma',
          latitude: 17.618024,
          longitude: 78.387748,
        },
      ],
    });

    await expect(
      service.updateProfile('ph_1', { latitude: 17.618024, longitude: 78.387748 } as never, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.pharmacy.update).not.toHaveBeenCalled();
  });

  it('lets a pharmacy re-save its own unchanged location', async () => {
    const { service, prisma } = buildService({ existing: stored() });

    await service.updateProfile(
      'ph_1',
      { latitude: stored().latitude, longitude: stored().longitude } as never,
      USER,
    );

    // Unchanged pin — nothing to check, and certainly not against itself.
    expect(prisma.pharmacy.findMany).not.toHaveBeenCalled();
    expect(prisma.pharmacy.update).toHaveBeenCalled();
  });

  it('excludes itself when it does move', async () => {
    const { service, prisma } = buildService({ existing: stored(), neighbours: [] });

    await service.updateProfile('ph_1', { latitude: 17.6, longitude: 78.42 } as never, USER);

    const [args] = prisma.pharmacy.findMany.mock.calls[0];
    expect(args.where.id).toEqual({ not: 'ph_1' });
  });
});

describe('registering a pharmacy — contact number', () => {
  it('requires a contact number on first submit', async () => {
    const { service, tx } = buildService();

    await expect(
      service.saveMyProfile(USER, { ...NEW_PHARMACY, phone: '' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.pharmacy.create).not.toHaveBeenCalled();
  });

  it('rejects a number too short to dial rather than storing it', async () => {
    const { service } = buildService();

    await expect(
      service.saveMyProfile(USER, { ...NEW_PHARMACY, phone: '12345' } as never),
    ).rejects.toThrow(/not a valid phone number/i);
  });

  it('stores the number in one form, however it was typed', async () => {
    // Contact and comparison both read this column, and three spellings of one
    // pharmacy's landline cannot be told apart later, so E.164 is what is stored.
    const { service, tx, prisma } = buildService();
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, NEW_PHARMACY as never);

    expect(tx.pharmacy.create.mock.calls[0][0].data.phone).toBe('+914023456789');
  });

  it('refuses to clear the number on an existing pharmacy', async () => {
    const { service, prisma } = buildService({ existing: stored() });

    await expect(
      service.updateProfile('ph_1', { phone: '' } as never, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pharmacy.update).not.toHaveBeenCalled();
  });

  it('asks a pharmacy with no number on record to add one before saving', async () => {
    const { service } = buildService({ existing: stored({ phone: null }) });

    await expect(
      service.updateProfile('ph_1', { city: 'Hyderabad' } as never, USER),
    ).rejects.toThrow(/contact number/i);
  });

  it('leaves an untouched number alone on an unrelated edit', async () => {
    const { service, prisma } = buildService({ existing: stored() });

    await service.updateProfile('ph_1', { addressLine2: 'Near the metro' } as never, USER);

    expect(prisma.pharmacy.update.mock.calls[0][0].data.phone).toBe('+91 40 2345 6789');
  });
});

/**
 * A pharmacy with no coordinates is invisible to patient search — every result
 * is distance-bounded, and a row without a pin has no distance — so the one
 * moment its address is known has to be the moment it gets located. Only the
 * admin panel used to geocode; a pharmacy that registered itself was stored
 * with a full address, no pin, and no way for a patient to ever find it.
 */
describe('registering a pharmacy — locating it from its address', () => {
  const BY_ADDRESS = {
    name: 'Zoiko Meds Pharmacy',
    licenseNumber: 'LIC-JHC951',
    phone: '+91 40 2345 6789',
    addressLine1: 'Plot 42, Gandimaisamma Main Road',
    city: 'Hyderabad',
    region: 'Telangana',
    postalCode: '500043',
    country: 'IN',
  };

  it('geocodes the street address when the operator supplied no pin', async () => {
    const { service, tx, geocode, prisma } = buildService({
      neighbours: [],
      geocode: { lat: 17.5878172, lng: 78.4236196, precise: true, granularity: 'ROOFTOP:premise' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, BY_ADDRESS as never);

    // The whole address, not [city, country] — a city geocodes to its centroid,
    // which would put every Hyderabad pharmacy on one pin.
    expect(geocode).toHaveBeenCalledWith(
      'Plot 42, Gandimaisamma Main Road, Hyderabad, Telangana, 500043, IN',
    );
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(17.5878172);
    expect(data.longitude).toBe(78.4236196);
  });

  it('stores no coordinates when the address only resolves to a city centroid', async () => {
    const { service, tx, prisma } = buildService({
      neighbours: [],
      geocode: { lat: 17.385, lng: 78.4867, precise: false, granularity: 'APPROXIMATE:locality' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, BY_ADDRESS as never);

    // "Not located yet" is true and fixable. A city centre is false, and it
    // would read on a patient's screen as this branch's own position.
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBeNull();
    expect(data.longitude).toBeNull();
  });

  it('keeps the operator pin and does not geocode when one was supplied', async () => {
    const { service, tx, geocode, prisma } = buildService({ neighbours: [] });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, NEW_PHARMACY as never);

    expect(geocode).not.toHaveBeenCalled();
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(NEW_PHARMACY.latitude);
  });

  it('registration is still accepted when geocoding fails outright', async () => {
    const { service, tx, prisma } = buildService({ neighbours: [], geocode: null });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, BY_ADDRESS as never);

    // A network failure at the geocoder must not cost the pharmacy its
    // submission; the row is written and can be located later.
    expect(tx.pharmacy.create).toHaveBeenCalled();
    expect(tx.pharmacy.create.mock.calls[0][0].data.latitude).toBeNull();
  });
});
