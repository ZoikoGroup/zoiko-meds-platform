import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyService } from './pharmacy.service';

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

function buildService(state: { neighbours?: Record<string, unknown>[]; existing?: any } = {}) {
  const neighbours = state.neighbours ?? [];
  const tx = {
    pharmacy: { create: jest.fn(async ({ data }: any) => ({ id: 'ph_new', ...data })) },
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
  );
  return { service, prisma, tx };
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
