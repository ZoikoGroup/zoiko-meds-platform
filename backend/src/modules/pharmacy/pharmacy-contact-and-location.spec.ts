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
    verificationRequest: {
      // The request's recorded submission facts, read before this save appends
      // to them so an earlier save's record is not lost.
      findUnique: jest.fn().mockResolvedValue({ changeKinds: [] }), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
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
      // Prisma's create returns the row it created; the submission reads the
      // new request's id from it to attach the licence document.
      create: jest.fn(async ({ data }: any) => ({ id: 'req_new', ...data })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    verificationDocument: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      upsert: jest.fn(),
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

  it('stores a city centroid, marked APPROXIMATE', async () => {
    const { service, tx, prisma } = buildService({
      neighbours: [],
      geocode: { lat: 17.385, lng: 78.4867, precise: false, granularity: 'APPROXIMATE:locality' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, BY_ADDRESS as never);

    // The centroid is not where the shop is, and storing nothing was the
    // honest way to say so — but it also made the pharmacy invisible to every
    // patient in its own city, which is the worse falsehood. It is stored and
    // labelled instead, and every surface that prints its distance says the
    // distance is rough.
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(17.385);
    expect(data.longitude).toBe(78.4867);
    expect(data.locationPrecision).toBe('APPROXIMATE');
  });

  it('marks a street-level geocode EXACT', async () => {
    const { service, tx, prisma } = buildService({
      neighbours: [],
      geocode: { lat: 17.5878172, lng: 78.4236196, precise: true, granularity: 'ROOFTOP:premise' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, BY_ADDRESS as never);

    expect(tx.pharmacy.create.mock.calls[0][0].data.locationPrecision).toBe('EXACT');
  });

  it('keeps the operator pin over a geocode of the same place', async () => {
    const { service, tx, prisma } = buildService({
      neighbours: [],
      // The area the address names — near the pin, so the two agree.
      geocode: { lat: 17.385, lng: 78.4867, precise: false, granularity: 'APPROXIMATE:locality' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, NEW_PHARMACY as never);

    // The operator dropped this on their own branch; no address lookup beats
    // that, and it is EXACT however coarse the address behind it was.
    const { data } = tx.pharmacy.create.mock.calls[0][0];
    expect(data.latitude).toBe(NEW_PHARMACY.latitude);
    expect(data.longitude).toBe(NEW_PHARMACY.longitude);
    expect(data.locationPrecision).toBe('EXACT');
  });

  it('refuses a pin in a different city from the address beside it', async () => {
    // The defect this exists for: a pharmacy whose address read "Delhi,
    // 110006" was stored with a pin in Hyderabad. Both halves were
    // well-formed, so nothing questioned either, and because the address was
    // area-level no later geocode could overwrite the pin. Patients in Delhi
    // were told nothing was near them.
    const { service, tx, prisma } = buildService({
      neighbours: [],
      geocode: { lat: 28.6139, lng: 77.209, precise: false, granularity: 'APPROXIMATE:locality' },
    });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await expect(
      service.saveMyProfile(USER, { ...NEW_PHARMACY, city: 'Delhi' } as never),
    ).rejects.toThrow(/km from the address/i);
    // Refused outright rather than stored with one half quietly dropped: only
    // a person can say which of the two is the mistake.
    expect(tx.pharmacy.create).not.toHaveBeenCalled();
  });

  it('accepts a pin when the address cannot be geocoded at all', async () => {
    const { service, tx, prisma } = buildService({ neighbours: [], geocode: null });
    prisma.pharmacy.findUnique.mockResolvedValue(stored({ id: 'ph_new' }));

    await service.saveMyProfile(USER, NEW_PHARMACY as never);

    // Nothing to contradict it. A geocoder that is down or has never heard of
    // the street must not cost an operator their own pin.
    expect(tx.pharmacy.create.mock.calls[0][0].data.latitude).toBe(NEW_PHARMACY.latitude);
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

/**
 * Verifying a pharmacy and listing it to patients are separate answers.
 *
 * Approval no longer publishes a pharmacy that has no position, because such a
 * record is returned by no distance-bounded search however verified it is. That
 * leaves one obligation here: the operator's own save is where the missing half
 * usually arrives, so it has to be what releases them.
 */
describe('setting a location lists an already-verified pharmacy', () => {
  it('publishes the pharmacy on the save that gives it a pin', async () => {
    const { service, prisma } = buildService({
      existing: stored({
        latitude: null,
        longitude: null,
        verificationStatus: 'VERIFIED',
        isParticipating: false,
      }),
      neighbours: [],
      geocode: { lat: 17.5878172, lng: 78.4236196, precise: true, granularity: 'ROOFTOP:premise' },
    });

    await service.updateProfile('ph_1', { addressLine1: 'Plot 42, Main Road' } as never, USER);

    // Without this the operator pastes their maps link, saves, and stays
    // invisible until an admin happens to touch the row - the one step that
    // closes the loop, left to somebody else.
    const { data } = prisma.pharmacy.update.mock.calls[0][0];
    expect(data.latitude).toBe(17.5878172);
    expect(data.isParticipating).toBe(true);
  });

  it('does not list a pharmacy whose address still cannot be located', async () => {
    const { service, prisma } = buildService({
      existing: stored({
        latitude: null,
        longitude: null,
        verificationStatus: 'VERIFIED',
        isParticipating: false,
      }),
      neighbours: [],
      geocode: null,
    });

    await service.updateProfile('ph_1', { addressLine1: 'Somewhere unfindable' } as never, USER);

    const { data } = prisma.pharmacy.update.mock.calls[0][0];
    expect(data.latitude).toBeNull();
    expect(data.isParticipating).toBe(false);
  });

  it('does not list a located pharmacy that has not been verified', async () => {
    const { service, prisma } = buildService({
      existing: stored({ verificationStatus: 'PENDING', isParticipating: false }),
      neighbours: [],
    });

    await service.updateProfile('ph_1', { addressLine2: 'Near the metro' } as never, USER);

    // A pin is not an approval. Only the Verification Center grants that.
    expect(prisma.pharmacy.update.mock.calls[0][0].data.isParticipating).toBe(false);
  });
});
