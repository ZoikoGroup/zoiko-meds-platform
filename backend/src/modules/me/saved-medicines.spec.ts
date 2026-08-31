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

function buildService(origin: { lat: number; lng: number } | null = null) {
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
    { findNearby: jest.fn(), resolveOrigin: jest.fn().mockResolvedValue(origin) } as never,
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

  /**
   * A saved medicine answers "can I get this near me?", so it has to name every
   * verified pharmacy near the patient that reports it — not the single
   * strongest signal, which is all this list used to carry. A patient with
   * three pharmacies down the road saw one name and no way to reach the others.
   */
  describe('listSaved — the pharmacies behind each medicine', () => {
    const HERE = { lat: 17.5561, lng: 78.4181 };

    const pharmacy = (over: Record<string, unknown> = {}) => ({
      id: 'ph_near',
      name: 'Zoiko Meds Pharmacy',
      addressLine1: 'Gandimaisamma',
      addressLine2: null,
      city: 'Hyderabad',
      region: 'Telangana',
      postalCode: '500043',
      phone: '+914023456789',
      latitude: 17.5578,
      longitude: 78.4199,
      ...over,
    });

    const signal = (over: Record<string, unknown> = {}) => ({
      confidence: 'HIGH',
      computedAt: new Date(),
      pharmacy: pharmacy(),
      ...over,
    });

    const savedRow = (signals: unknown[]) => ({
      id: 'saved_1',
      alertsEnabled: true,
      priority: 'MEDIUM',
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
        availabilitySignals: signals,
      },
    });

    it('lists every pharmacy in range, nearest first', async () => {
      const { service, prisma } = buildService(HERE);
      prisma.savedMedicine.findMany.mockResolvedValue([
        savedRow([
          signal({
            confidence: 'HIGH',
            pharmacy: pharmacy({ id: 'ph_far', name: 'Apollo', latitude: 17.62, longitude: 78.49 }),
          }),
          signal({ confidence: 'MODERATE' }),
        ]),
      ]);

      const [saved] = await service.listSaved(USER, { lat: HERE.lat, lng: HERE.lng });

      expect(saved.pharmacies.map((p: { name: string }) => p.name)).toEqual([
        'Zoiko Meds Pharmacy',
        'Apollo',
      ]);
      expect(saved.pharmacies[0].distance!).toBeLessThan(saved.pharmacies[1].distance!);
      // The number to ring, and where to go — both straight off the record.
      expect(saved.pharmacies[0].phone).toBe('+914023456789');
      expect(saved.pharmacies[0].address).toBe(
        'Gandimaisamma, Hyderabad, Telangana, 500043',
      );
    });

    it('drops a pharmacy outside the requested radius', async () => {
      const { service, prisma } = buildService(HERE);
      prisma.savedMedicine.findMany.mockResolvedValue([
        savedRow([
          signal(),
          signal({
            pharmacy: pharmacy({ id: 'ph_mumbai', name: 'Wellness', latitude: 19.076, longitude: 72.877 }),
          }),
        ]),
      ]);

      const [saved] = await service.listSaved(USER, { lat: HERE.lat, lng: HERE.lng, maxDistance: 5 });

      expect(saved.pharmacies.map((p: { name: string }) => p.name)).toEqual(['Zoiko Meds Pharmacy']);
    });

    it('collapses repeat signals from one pharmacy to its freshest', async () => {
      const { service, prisma } = buildService(HERE);
      const fresh = new Date();
      const stale = new Date(Date.now() - 6 * 60 * 60 * 1000);
      prisma.savedMedicine.findMany.mockResolvedValue([
        savedRow([
          signal({ confidence: 'LOW', computedAt: stale }),
          signal({ confidence: 'HIGH', computedAt: fresh }),
        ]),
      ]);

      const [saved] = await service.listSaved(USER, { lat: HERE.lat, lng: HERE.lng });

      // One shop, one card — reporting twice is not two pharmacies.
      expect(saved.pharmacies).toHaveLength(1);
      expect(saved.pharmacies[0].confidence).toBe('high');
    });

    it('names every stocking pharmacy, without distances, when no location was given', async () => {
      const { service, prisma } = buildService(null);
      prisma.savedMedicine.findMany.mockResolvedValue([
        savedRow([
          signal(),
          signal({
            pharmacy: pharmacy({ id: 'ph_mumbai', name: 'Wellness', latitude: 19.076, longitude: 72.877 }),
          }),
        ]),
      ]);

      const [saved] = await service.listSaved(USER);

      // Nothing to measure from, so nothing is bounded and no distance is
      // invented — the list used to be measured from a fixed demo address.
      expect(saved.pharmacies).toHaveLength(2);
      expect(saved.pharmacies.every((p: { distance: number | null }) => p.distance === null)).toBe(true);
    });

    it('leaves an unlocated pharmacy out of a list that has a location to measure from', async () => {
      const { service, prisma } = buildService(HERE);
      prisma.savedMedicine.findMany.mockResolvedValue([
        savedRow([
          signal(),
          signal({
            pharmacy: pharmacy({ id: 'ph_nopin', name: 'Unlocated', latitude: null, longitude: null }),
          }),
        ]),
      ]);

      const [saved] = await service.listSaved(USER, { lat: HERE.lat, lng: HERE.lng });

      // It cannot be shown as nearby when nobody knows where it is.
      expect(saved.pharmacies.map((p: { name: string }) => p.name)).toEqual(['Zoiko Meds Pharmacy']);
    });
  });
});
