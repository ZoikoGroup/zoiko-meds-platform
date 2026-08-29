import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
 * The MediBase™ identity id as the primary medicine reference.
 *
 * A pharmacy's availability row and the medicine a patient searches are the
 * same identity or the two screens disagree. Name matching stays for the portal
 * form, which types a name — but when a caller knows the identity id, that id is
 * authoritative: nothing is matched by name and no second identity is minted
 * under the same medicine.
 */

const PHARMACY = 'ph_apollo';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: PHARMACY,
};

const DOLO = {
  id: 'med_dolo_650',
  canonicalName: 'Dolo 650',
  genericName: 'Paracetamol',
  brandNames: ['Dolo 650'],
  strength: '650 mg',
  dosageForm: 'Tablet',
  qualityState: 'NEEDS_REVIEW',
};

function buildService() {
  const state = {
    byId: null as Record<string, any> | null,
    clash: null as { id: string } | null,
    row: {
      id: 'sig_1',
      pharmacyId: PHARMACY,
      medicineId: 'med_other',
      confidence: 'LOW',
      medicine: {
        id: 'med_other',
        canonicalName: 'Crocin 500',
        genericName: 'Paracetamol',
        strength: '500 mg',
        dosageForm: 'Tablet',
        qualityState: 'NEEDS_REVIEW',
      },
    } as Record<string, any>,
  };

  const prisma: any = {
    medicineEntity: {
      findUnique: jest.fn(async () => state.byId),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'med_created', ...data })),
      update: jest.fn(),
    },
    inventorySignal: { create: jest.fn() },
    availabilitySignal: {
      upsert: jest.fn(async () => ({ id: 'sig_new' })),
      findUnique: jest.fn(async ({ where }: any) =>
        where.medicineId_pharmacyId ? state.clash : state.row,
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ data }: any) => ({
        id: 'sig_1',
        medicineId: data.medicineId,
        medicine: {
          canonicalName: DOLO.canonicalName,
          genericName: DOLO.genericName,
          brandNames: DOLO.brandNames,
          strength: DOLO.strength,
          dosageForm: DOLO.dosageForm,
        },
      })),
    },
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Apollo Pharmacy', jurisdictionId: 'jur_in' }),
    },
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn().mockResolvedValue(0) } as unknown as SavedMedicineLinkService,
    { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
    allowAllPreferences(),
  );
  return { service, prisma, state };
}

describe('adding inventory by MediBase identity id', () => {
  it('attaches the signal to that identity without matching on the name', async () => {
    const { service, prisma, state } = buildService();
    state.byId = DOLO;

    const result = await service.addInventoryItem(
      PHARMACY,
      { medicineId: DOLO.id, name: 'whatever the caller displayed' } as never,
      USER,
    );

    expect(prisma.medicineEntity.findUnique).toHaveBeenCalledWith({ where: { id: DOLO.id } });
    expect(prisma.medicineEntity.findFirst).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
    expect(result.medicineId).toBe(DOLO.id);
    // The governed name, not the one the caller happened to send.
    expect(result.name).toBe('Dolo 650');
  });

  it('scopes the availability signal to the calling pharmacy and that identity', async () => {
    const { service, prisma, state } = buildService();
    state.byId = DOLO;

    await service.addInventoryItem(
      PHARMACY,
      { medicineId: DOLO.id, name: 'Dolo 650', status: 'available' } as never,
      USER,
    );

    const [args] = prisma.availabilitySignal.upsert.mock.calls[0];
    expect(args.where.medicineId_pharmacyId).toEqual({
      medicineId: DOLO.id,
      pharmacyId: PHARMACY,
    });
    expect(args.create.pharmacyId).toBe(PHARMACY);
    expect(args.create.confidence).toBe('HIGH');
  });

  it('refuses an unknown identity id instead of minting a second identity', async () => {
    const { service, prisma, state } = buildService();
    state.byId = null;

    await expect(
      service.addInventoryItem(PHARMACY, { medicineId: 'med_nope', name: 'Dolo 650' } as never, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
    expect(prisma.availabilitySignal.upsert).not.toHaveBeenCalled();
  });

  it('still resolves by name when no id is sent', async () => {
    const { service, prisma } = buildService();

    await service.addInventoryItem(PHARMACY, { name: 'Dolo 650', strength: '650 mg' } as never, USER);

    expect(prisma.medicineEntity.findUnique).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.findFirst).toHaveBeenCalled();
  });
});

describe('re-pointing an inventory row by MediBase identity id', () => {
  const edit = (service: PharmacyService, dto: Record<string, unknown>) =>
    service.updateInventoryItem(PHARMACY, 'sig_1', dto as never, USER, '10.0.0.1');

  it('moves the row onto that identity and leaves the catalog alone', async () => {
    const { service, prisma, state } = buildService();
    state.byId = DOLO;

    const result = await edit(service, { medicineId: DOLO.id });

    expect(prisma.availabilitySignal.update.mock.calls[0][0].data.medicineId).toBe(DOLO.id);
    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.update).not.toHaveBeenCalled();
    expect(result.medicineId).toBe(DOLO.id);
    // Status was not sent, so it must not be silently restocked.
    expect(result.status).toBe('out-of-stock');
  });

  it('keeps the row where it is when the identity id is unknown', async () => {
    const { service, prisma, state } = buildService();
    state.byId = null;

    await expect(edit(service, { medicineId: 'med_nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.availabilitySignal.update).not.toHaveBeenCalled();
  });

  it('refuses to create a second row for a medicine already in the inventory', async () => {
    const { service, prisma, state } = buildService();
    state.byId = DOLO;
    state.clash = { id: 'sig_existing' };

    await expect(edit(service, { medicineId: DOLO.id })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.availabilitySignal.update).not.toHaveBeenCalled();
  });
});
