import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MeService } from './me.service';

/**
 * Saved medicines — persistence and per-patient authorization.
 *
 * Every query must be scoped by `userId`: one patient must never be able to
 * read, alter or delete another patient's saved list by guessing a medicine id.
 */

const USER = 'user_1';
const OTHER_USER = 'user_2';
const MEDICINE = 'med_1';

function buildService() {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    medicineEntity: {
      findUnique: jest.fn().mockResolvedValue({ id: MEDICINE, canonicalName: 'Amoxicillin 500 mg' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    searchHistory: { create: jest.fn() },
  };
  const service = new MeService(
    prisma as never,
    { findNearby: jest.fn() } as never,
    { recordSearch: jest.fn(), recordZeroResult: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('MeService — saved medicines', () => {
  describe('save — MediBase medicine', () => {
    it('persists the medicine against the calling patient, already linked', async () => {
      const { service, prisma } = buildService();

      await expect(service.save(USER, { medicineId: MEDICINE })).resolves.toMatchObject({
        saved: true,
        medicineId: MEDICINE,
      });

      const [{ data }] = prisma.savedMedicine.create.mock.calls[0];
      expect(data.userId).toBe(USER);
      expect(data.medicineId).toBe(MEDICINE);
      // The governed name wins over anything the client displayed.
      expect(data.medicineName).toBe('Amoxicillin 500 mg');
      expect(data.normalizedName).toBe('amoxicillin500mg');
      expect(data.linkedAt).toBeInstanceOf(Date);
    });

    it('rejects a medicineId that does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.medicineEntity.findUnique.mockResolvedValue(null);

      await expect(service.save(USER, { medicineId: 'nope' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.savedMedicine.create).not.toHaveBeenCalled();
    });

    it('surfaces a duplicate as a conflict rather than a 500', async () => {
      const { service, prisma } = buildService();
      prisma.savedMedicine.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.save(USER, { medicineId: MEDICINE })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('save — medicine not in MediBase', () => {
    it('saves by name with no medicine id, awaiting a pharmacy', async () => {
      const { service, prisma } = buildService();

      await expect(service.save(USER, { name: 'Volini Gel' })).resolves.toMatchObject({
        saved: true,
        medicineId: null,
        medicineName: 'Volini Gel',
      });

      const [{ data }] = prisma.savedMedicine.create.mock.calls[0];
      expect(data.medicineId).toBeNull();
      expect(data.medicineName).toBe('Volini Gel');
      expect(data.normalizedName).toBe('volinigel');
      // Not linked yet — this is what the pharmacy event later fills in.
      expect(data.linkedAt).toBeNull();
      expect(prisma.medicineEntity.findUnique).not.toHaveBeenCalled();
    });

    it('normalizes case, spacing and punctuation into one key', async () => {
      const { service, prisma } = buildService();

      await service.save(USER, { name: '  VOLINI-gel  ' });

      const [{ data }] = prisma.savedMedicine.create.mock.calls[0];
      expect(data.normalizedName).toBe('volinigel');
    });

    it('attaches the identity when the catalog already has that name', async () => {
      // The patient's client had no id, but a pharmacy added it in the meantime.
      const { service, prisma } = buildService();
      prisma.medicineEntity.findFirst.mockResolvedValue({
        id: 'med_volini',
        canonicalName: 'Volini Gel',
      });

      await service.save(USER, { name: 'volini gel' });

      const [{ data }] = prisma.savedMedicine.create.mock.calls[0];
      expect(data.medicineId).toBe('med_volini');
      expect(data.linkedAt).toBeInstanceOf(Date);
    });

    it('refuses a name with nothing matchable in it', async () => {
      const { service } = buildService();
      await expect(service.save(USER, { name: '###' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses a request carrying neither an id nor a name', async () => {
      const { service } = buildService();
      await expect(service.save(USER, {})).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unsave', () => {
    it('only ever deletes rows belonging to the calling patient', async () => {
      const { service, prisma } = buildService();

      await service.unsave(USER, MEDICINE);

      // The other patient's identical medicine id is untouched: the filter
      // carries the caller's own id, not one supplied by the request body.
      const [{ where }] = prisma.savedMedicine.deleteMany.mock.calls[0];
      expect(where.userId).toBe(USER);
      expect(where.userId).not.toBe(OTHER_USER);
      expect(where.OR).toContainEqual({ medicineId: MEDICINE });
    });

    it('removes an off-catalog save addressed by name', async () => {
      // Unlinked rows have no medicine id, so the name is the only handle —
      // and removing the row is what stops any future availability alert.
      const { service, prisma } = buildService();

      await service.unsave(USER, 'Volini Gel');

      const [{ where }] = prisma.savedMedicine.deleteMany.mock.calls[0];
      expect(where.OR).toContainEqual({ normalizedName: 'volinigel' });
    });
  });

  describe('updateSavedMedicineAlerts', () => {
    it('stores the preference for the calling patient only', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.updateSavedMedicineAlerts(USER, MEDICINE, false),
      ).resolves.toEqual({ success: true, medicineId: MEDICINE, alertsEnabled: false });

      const [args] = prisma.savedMedicine.updateMany.mock.calls[0];
      expect(args.where.userId).toBe(USER);
      expect(args.where.OR).toContainEqual({ medicineId: MEDICINE });
      expect(args.data).toEqual({ alertsEnabled: false });
    });

    it('accepts the medicine name for an off-catalog save', async () => {
      // Turning alerts off is how a patient keeps the medicine but stops the
      // "now available" notification; unlinked rows have only a name.
      const { service, prisma } = buildService();

      await service.updateSavedMedicineAlerts(USER, 'Volini Gel', false);

      const [args] = prisma.savedMedicine.updateMany.mock.calls[0];
      expect(args.where.OR).toContainEqual({ normalizedName: 'volinigel' });
    });

    it('reports a miss instead of claiming success', async () => {
      // updateMany matches nothing when the medicine is not on this patient's
      // list — including when the id belongs to someone else's saved medicine.
      const { service, prisma } = buildService();
      prisma.savedMedicine.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateSavedMedicineAlerts(USER, MEDICINE, true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listSaved', () => {
    it('reads only the calling patient rows, newest first', async () => {
      const { service, prisma } = buildService();

      await service.listSaved(USER);

      const [args] = prisma.savedMedicine.findMany.mock.calls[0];
      expect(args.where).toEqual({ userId: USER });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('returns availability confidence alongside each saved medicine', async () => {
      const { service, prisma } = buildService();
      prisma.savedMedicine.findMany.mockResolvedValue([
        {
          alertsEnabled: false,
          priority: 'HIGH',
          medicine: {
            id: MEDICINE,
            canonicalName: 'Amoxicillin 500 mg',
            genericName: 'Amoxicillin',
            brandNames: [],
            strength: '500 mg',
            dosageForm: 'Capsule',
            manufacturer: 'Acme',
            description: null,
            prescriptionCategory: 'PRESCRIPTION',
            availabilitySignals: [],
          },
        },
      ]);

      const [saved] = await service.listSaved(USER);

      expect(saved.id).toBe(MEDICINE);
      expect(saved.name).toBe('Amoxicillin 500 mg');
      // The page renders these; they must survive the mapping.
      expect(saved).toHaveProperty('confidence');
      expect(saved).toHaveProperty('pharmacy');
      expect(saved).toHaveProperty('updated');
      expect(saved.alertsEnabled).toBe(false);
      expect(saved.priority).toBe('high');
    });
  });
});
