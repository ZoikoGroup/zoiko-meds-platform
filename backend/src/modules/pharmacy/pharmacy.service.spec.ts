import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyService } from './pharmacy.service';

/** Linking saved medicines is exercised in saved-medicine-link.spec.ts. */
const savedLinkStub = () =>
  ({ linkPendingSaves: jest.fn().mockResolvedValue(0) }) as unknown as SavedMedicineLinkService;

describe('PharmacyService.resolvePharmacyId', () => {
  let service: PharmacyService;
  let prisma: { pharmacy: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { pharmacy: { findFirst: jest.fn() } };
    service = new PharmacyService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditWriter,
      savedLinkStub(),
    );
  });

  it('returns the user pharmacy id when the account is linked to one', async () => {
    await expect(service.resolvePharmacyId('pharma_123')).resolves.toBe('pharma_123');
  });

  it('throws Forbidden when the account has no linked pharmacy (no fallback)', async () => {
    await expect(service.resolvePharmacyId(null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never queries for a fallback pharmacy when the link is missing', async () => {
    await expect(service.resolvePharmacyId(null)).rejects.toBeInstanceOf(ForbiddenException);
    // The old "first pharmacy in the DB" fallback is gone — no DB lookup at all.
    expect(prisma.pharmacy.findFirst).not.toHaveBeenCalled();
  });
});

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'owner@apollo.in',
  fullName: 'Asha Rao',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: null,
};

describe('PharmacyService self-service profile onboarding', () => {
  let service: PharmacyService;
  let prisma: any;
  let audit: { write: jest.Mock };

  beforeEach(() => {
    prisma = {
      pharmacy: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      signalNotification: { findMany: jest.fn().mockResolvedValue([]) },
      verificationRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    audit = { write: jest.fn() };
    service = new PharmacyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
      savedLinkStub(),
    );
  });

  describe('getMyProfile', () => {
    it('returns an empty draft instead of throwing when no pharmacy is linked', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });

      const profile = await service.getMyProfile(USER);

      expect(profile.isDraft).toBe(true);
      expect(profile.id).toBeNull();
      expect(profile.name).toBe('');
      expect(profile.licenseNumber).toBe('');
      expect(profile.verificationStatus).toBe('UNVERIFIED');
      // Email is real (from the account); nothing else is invented.
      expect(profile.email).toBe('owner@apollo.in');
    });

    it('returns the Pharmacy Management record when one is linked', async () => {
      prisma.pharmacy.findUnique.mockResolvedValue({
        id: 'ph_1',
        name: 'Apollo Kompally',
        licenseNumber: 'LIC-1',
        verificationStatus: 'VERIFIED',
        isParticipating: true,
        phone: '+91 40 111',
        addressLine1: 'Kompally Main Rd',
        addressLine2: null,
        city: 'Hyderabad',
        region: 'Telangana',
        country: 'India',
        postalCode: '500014',
        reliabilityScore: 0.9,
      });

      const profile = await service.getMyProfile({ ...USER, pharmacyId: 'ph_1' });

      expect(profile.isDraft).toBe(false);
      expect(profile.name).toBe('Apollo Kompally');
      expect(profile.city).toBe('Hyderabad');
      expect(profile.reliabilityScore).toBe(90);
    });

    it('never substitutes placeholder contact details for empty columns', async () => {
      prisma.pharmacy.findUnique.mockResolvedValue({
        id: 'ph_1',
        name: 'Blank Pharmacy',
        licenseNumber: null,
        verificationStatus: 'PENDING',
        isParticipating: false,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null,
        reliabilityScore: 0,
      });

      const profile = await service.getMyProfile({ ...USER, pharmacyId: 'ph_1' });

      expect(profile.phone).toBe('');
      expect(profile.city).toBe('');
      expect(profile).not.toHaveProperty('hours');
    });
  });

  describe('saveMyProfile — first submit', () => {
    it('creates the pharmacy, links the user, and files a PENDING verification request', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });
      prisma.pharmacy.create.mockResolvedValue({ id: 'ph_new', name: 'Apollo Kompally' });
      prisma.pharmacy.findUnique.mockResolvedValue({
        id: 'ph_new',
        name: 'Apollo Kompally',
        licenseNumber: 'LIC-9',
        verificationStatus: 'PENDING',
        isParticipating: false,
        phone: null,
        addressLine1: 'Kompally Main Rd',
        addressLine2: null,
        city: 'Hyderabad',
        region: null,
        country: 'India',
        postalCode: null,
        reliabilityScore: 0,
      });

      const result = await service.saveMyProfile(USER, {
        name: 'Apollo Kompally',
        licenseNumber: 'LIC-9',
        addressLine1: 'Kompally Main Rd',
        city: 'Hyderabad',
        country: 'India',
      });

      // Created awaiting review, and never trusted into public results on submit.
      expect(prisma.pharmacy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Apollo Kompally',
            licenseNumber: 'LIC-9',
            verificationStatus: 'PENDING',
            isParticipating: false,
          }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { pharmacyId: 'ph_new' },
      });
      expect(prisma.verificationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pharmacyId: 'ph_new',
            pharmacyName: 'Apollo Kompally',
            licenseNumber: 'LIC-9',
            submittedBy: 'Asha Rao (owner@apollo.in)',
            status: 'PENDING',
          }),
        }),
      );
      expect(result.verificationStatus).toBe('PENDING');
    });

    it('adopts the admin-provisioned request matched by submitter, filling in the real licence', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });
      prisma.pharmacy.create.mockResolvedValue({ id: 'ph_new', name: 'Apollo Kompally' });
      // AdminService.ensurePharmacyVerificationRequest leaves licenceNumber blank,
      // so licence matching alone would miss it and duplicate the row.
      prisma.verificationRequest.findFirst.mockResolvedValue({
        id: 'vr_admin',
        notes: 'Account given the Pharmacy Manager role.',
      });
      prisma.pharmacy.findUnique.mockResolvedValue({
        id: 'ph_new', name: 'Apollo Kompally', licenseNumber: 'LIC-REAL',
        verificationStatus: 'PENDING', isParticipating: false, reliabilityScore: 0,
      });

      await service.saveMyProfile(USER, {
        name: 'Apollo Kompally',
        licenseNumber: 'LIC-REAL',
      });

      expect(prisma.verificationRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vr_admin' },
          data: expect.objectContaining({
            pharmacyId: 'ph_new',
            pharmacyName: 'Apollo Kompally',
            licenseNumber: 'LIC-REAL',
            status: 'PENDING',
          }),
        }),
      );
      expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
      // The lookup must consider the submitting account, not just the licence.
      expect(prisma.verificationRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pharmacyId: null,
            OR: expect.arrayContaining([
              expect.objectContaining({
                submittedBy: { contains: 'owner@apollo.in', mode: 'insensitive' },
              }),
            ]),
          }),
        }),
      );
    });

    it('adopts an admin-raised orphan request for the same licence instead of duplicating', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });
      prisma.pharmacy.create.mockResolvedValue({ id: 'ph_new', name: 'Apollo' });
      prisma.verificationRequest.findFirst.mockResolvedValue({ id: 'vr_orphan' });
      prisma.pharmacy.findUnique.mockResolvedValue({
        id: 'ph_new', name: 'Apollo', licenseNumber: 'LIC-9',
        verificationStatus: 'PENDING', isParticipating: false, reliabilityScore: 0,
      });

      await service.saveMyProfile(USER, { name: 'Apollo', licenseNumber: 'LIC-9' });

      expect(prisma.verificationRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr_orphan' },
        data: {
          pharmacyId: 'ph_new',
          pharmacyName: 'Apollo',
          licenseNumber: 'LIC-9',
          submittedBy: 'Asha Rao (owner@apollo.in)',
          status: 'PENDING',
          notes: 'Submitted by the pharmacy from the pharmacy portal profile.',
        },
      });
      expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
    });

    it('rejects a submission with no name or licence number', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });

      await expect(
        service.saveMyProfile(USER, { city: 'Hyderabad' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pharmacy.create).not.toHaveBeenCalled();
    });
  });

  describe('participation is measured, not fixed (MP-44)', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

    const complete = { genericName: 'Paracetamol', strength: '650 mg', dosageForm: 'Tablet' };
    const incomplete = { genericName: null, strength: null, dosageForm: 'Tablet' };

    beforeEach(() => {
      prisma.pharmacy.findUnique.mockResolvedValue({
        reliabilityScore: 0.9,
        verificationStatus: 'VERIFIED',
        isParticipating: true,
      });
      prisma.availabilitySignal = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.inventorySignal = { count: jest.fn().mockResolvedValue(0) };
    });

    it('reports the stored reliability score rather than a fixture', async () => {
      // The page showed 92% for every pharmacy on the platform.
      const result = await service.getParticipation('ph_1');

      expect(result.reliabilityScore).toBe(90);
    });

    it('counts what is listed, what is current, and what is fully described', async () => {
      prisma.availabilitySignal.findMany.mockResolvedValue([
        { computedAt: hoursAgo(1), confidence: 'HIGH', medicine: complete },
        { computedAt: hoursAgo(3), confidence: 'HIGH', medicine: incomplete },
        { computedAt: hoursAgo(24 * 30), confidence: 'LOW', medicine: complete },
      ]);
      prisma.inventorySignal.count.mockResolvedValue(7);

      const result = await service.getParticipation('ph_1');

      expect(result.medicinesListed).toBe(3);
      expect(result.updatesLast7Days).toBe(7);
      // Two of the three were updated inside the window.
      expect(result.upToDateCount).toBe(2);
      expect(result.upToDatePercent).toBe(67);
      // Two of the three carry a generic name, strength and form.
      expect(result.detailsCompleteCount).toBe(2);
      expect(result.detailsCompletePercent).toBe(67);
    });

    it('averages how old the availability information actually is', async () => {
      prisma.availabilitySignal.findMany.mockResolvedValue([
        { computedAt: hoursAgo(1), confidence: 'HIGH', medicine: complete },
        { computedAt: hoursAgo(3), confidence: 'HIGH', medicine: complete },
      ]);

      const result = await service.getParticipation('ph_1');

      expect(result.freshnessHours).toBeCloseTo(2, 1);
    });

    it('reports nothing rather than zero for a pharmacy with no medicines', async () => {
      // 0% would read as a judgement on the pharmacy; a share of nothing has no
      // value at all, and the page renders a dash for it.
      const result = await service.getParticipation('ph_1');

      expect(result.medicinesListed).toBe(0);
      expect(result.upToDatePercent).toBeNull();
      expect(result.detailsCompletePercent).toBeNull();
      expect(result.freshnessHours).toBeNull();
    });

    it('refuses to invent a pharmacy that does not exist', async () => {
      prisma.pharmacy.findUnique.mockResolvedValue(null);

      await expect(service.getParticipation('ph_missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('a new medicine is matched on strength, not on name alone (MP-46)', () => {
    const linked = { ...USER, pharmacyId: 'ph_1' };

    const dto = (over: Record<string, unknown> = {}) => ({
      name: 'Dolo',
      generic: 'Paracetamol',
      strength: '650 mg',
      dosageForm: 'Tablet',
      status: 'available',
      ...over,
    });

    beforeEach(() => {
      prisma.medicineEntity = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'med_new',
          canonicalName: 'Dolo',
          genericName: 'Paracetamol',
          strength: '650 mg',
          dosageForm: 'Tablet',
        }),
      };
      prisma.inventorySignal = { create: jest.fn() };
      prisma.availabilitySignal = { upsert: jest.fn().mockResolvedValue({ id: 'av_1' }) };
      prisma.pharmacy.findUnique.mockResolvedValue({ id: 'ph_1', name: 'Apollo' });
    });

    it('looks the medicine up by name and strength together', async () => {
      // The strength used to be passed as `dto.strength || undefined`, which Prisma
      // reads as "do not filter on this" — so a request matched whichever strength
      // was stored first, and 500 mg stock was recorded against the 650 mg identity.
      await service.addInventoryItem('ph_1', dto() as never, linked);

      expect(prisma.medicineEntity.findFirst).toHaveBeenCalledWith({
        where: {
          canonicalName: { equals: 'Dolo', mode: 'insensitive' },
          strength: { equals: '650 mg', mode: 'insensitive' },
        },
      });
    });

    it('creates the catalog identity from what was supplied, with nothing defaulted', async () => {
      await service.addInventoryItem(
        'ph_1',
        dto({ name: '  Dolo  ', generic: ' Paracetamol ', strength: ' 650 mg ', dosageForm: ' Syrup ' }) as never,
        linked,
      );

      expect(prisma.medicineEntity.create).toHaveBeenCalledWith({
        data: {
          canonicalName: 'Dolo',
          genericName: 'Paracetamol',
          strength: '650 mg',
          // Not silently 'Tablet': a syrup recorded as a tablet is a different
          // medicine as far as a patient reading the result is concerned.
          dosageForm: 'Syrup',
        },
      });
    });

    it('reuses an existing identity rather than creating a second one', async () => {
      prisma.medicineEntity.findFirst.mockResolvedValue({
        id: 'med_existing',
        canonicalName: 'Dolo',
        genericName: 'Paracetamol',
        strength: '650 mg',
        dosageForm: 'Tablet',
      });

      const result = await service.addInventoryItem('ph_1', dto() as never, linked);

      expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
      expect(result.medicineId).toBe('med_existing');
    });

    it('accepts the lowercase dosageform alias when that is what arrived', async () => {
      await service.addInventoryItem(
        'ph_1',
        { name: 'Dolo', generic: 'Paracetamol', strength: '650 mg', dosageform: 'Injection' } as never,
        linked,
      );

      expect(prisma.medicineEntity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dosageForm: 'Injection' }) }),
      );
    });
  });

  describe('notification categories come from the row, not a constant (MP-24)', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'sn_1',
      dedupeKey: 'med:med_1:running-low',
      type: 'RUNNING_LOW',
      title: 'Running low',
      description: 'Paracetamol is running low nearby',
      read: false,
      createdAt: new Date(),
      ...over,
    });

    const categoriesFor = async (rows: Record<string, unknown>[]) => {
      prisma.signalNotification.findMany.mockResolvedValue(rows);
      const list = await service.getUserNotifications('user_1');
      return list.map((n: { type: string }) => n.type);
    };

    it.each([
      ['RUNNING_LOW', 'inventory'],
      ['BACK_IN_STOCK', 'inventory'],
      ['LIMITED', 'inventory'],
      ['NEARBY_RESTOCK', 'inventory'],
    ])('files a %s availability signal under inventory', async (type, expected) => {
      // Every row used to be labelled 'verification', so the Inventory filter on
      // the notifications page could never match anything.
      await expect(categoriesFor([row({ type })])).resolves.toEqual([expected]);
    });

    it('keeps a verification decision under verification', async () => {
      // The workflow reuses the SAFETY type for its own decisions, so the dedupe
      // key is the only honest way to tell the two apart.
      await expect(
        categoriesFor([row({ dedupeKey: 'verification:vr_1:approved:1', type: 'SAFETY' })]),
      ).resolves.toEqual(['verification']);
    });

    it('files a genuine safety alert under system, not verification', async () => {
      await expect(
        categoriesFor([row({ dedupeKey: 'broadcast:b_1', type: 'SAFETY' })]),
      ).resolves.toEqual(['system']);
      await expect(
        categoriesFor([row({ dedupeKey: 'broadcast:b_2', type: 'RECALL' })]),
      ).resolves.toEqual(['system']);
    });

    it('reports unread state from the stored row', async () => {
      prisma.signalNotification.findMany.mockResolvedValue([row({ read: true })]);

      const [first] = await service.getUserNotifications('user_1');

      expect(first.unread).toBe(false);
    });

    it('leaves out what the user dismissed or archived', async () => {
      prisma.signalNotification.findMany.mockResolvedValue([]);

      await service.getUserNotifications('user_1');

      expect(prisma.signalNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user_1', dismissed: false, archived: false },
        }),
      );
    });
  });

  describe('phone numbers are validated and stored in one form (MP-23)', () => {
    const linked = { ...USER, pharmacyId: 'ph_1' };

    const seed = (over: Record<string, unknown> = {}) => {
      const row = {
        id: 'ph_1',
        name: 'Apollo',
        licenseNumber: 'LIC-1',
        verificationStatus: 'VERIFIED',
        isParticipating: true,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        country: 'IN',
        postalCode: null,
        reliabilityScore: 0.9,
        ...over,
      };
      prisma.pharmacy.findUnique.mockResolvedValue(row);
      prisma.pharmacy.update.mockResolvedValue(row);
      return row;
    };

    const savedPhone = () =>
      prisma.pharmacy.update.mock.calls.at(-1)?.[0]?.data?.phone;

    it('stores a local number in international form', async () => {
      seed();

      await service.saveMyProfile(linked, { phone: '040 2345 6789' });

      expect(savedPhone()).toBe('+914023456789');
    });

    it('reads the number against the country being saved, not the stored one', async () => {
      // Correcting the country and the number together has to work: validating
      // against the old country would reject the new number.
      seed({ country: 'IN' });

      await service.saveMyProfile(linked, { country: 'United States', phone: '(415) 555-2671' });

      expect(savedPhone()).toBe('+14155552671');
    });

    it('refuses a number that is not real for the country', async () => {
      seed();

      await expect(service.saveMyProfile(linked, { phone: '12345' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.pharmacy.update).not.toHaveBeenCalled();
    });

    it('says what was typed and how to write it instead', async () => {
      seed();

      await expect(service.saveMyProfile(linked, { phone: 'call the shop' })).rejects.toThrow(
        /"call the shop" is not a valid phone number for IN.*international form/s,
      );
    });

    it('clears the number when the field is emptied', async () => {
      seed({ phone: '+914023456789' });

      await service.saveMyProfile(linked, { phone: '' });

      expect(savedPhone()).toBeNull();
    });

    it('leaves a stored number alone when the edit does not mention it', async () => {
      // A number saved before this validation existed must not block an edit to
      // the address. It is normalized the next time the field itself is touched.
      seed({ phone: '040-2345-6789 ext 4' });

      await service.saveMyProfile(linked, { city: 'Hyderabad' });

      expect(savedPhone()).toBe('040-2345-6789 ext 4');
    });

    it('normalizes on first submit too', async () => {
      prisma.user.findUnique.mockResolvedValue({ pharmacyId: null });
      prisma.pharmacy.findUnique.mockResolvedValue(null);
      prisma.pharmacy.create.mockResolvedValue({ id: 'ph_new', name: 'Apollo Kompally' });

      await service
        .saveMyProfile(USER, {
          name: 'Apollo Kompally',
          licenseNumber: 'LIC-9',
          country: 'India',
          phone: '9876543210',
        })
        .catch(() => undefined);

      expect(prisma.pharmacy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '+919876543210', country: 'IN' }),
        }),
      );
    });
  });

  describe('saveMyProfile — editing an existing pharmacy', () => {
    const linked = { ...USER, pharmacyId: 'ph_1' };

    const seed = (verificationStatus: string, over: Record<string, unknown> = {}) => {
      const row = {
        id: 'ph_1',
        name: 'Apollo',
        licenseNumber: 'LIC-1',
        verificationStatus,
        isParticipating: verificationStatus === 'VERIFIED',
        phone: null, addressLine1: null, addressLine2: null, city: null,
        region: null, country: null, postalCode: null, reliabilityScore: 0.9,
        ...over,
      };
      prisma.pharmacy.findUnique.mockResolvedValue(row);
      prisma.pharmacy.update.mockResolvedValue(row);
      return row;
    };

    it('does not re-open review when a verified pharmacy edits only its address', async () => {
      seed('VERIFIED');

      await service.saveMyProfile(linked, { city: 'Hyderabad' });

      expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
      // Status untouched — an address correction must not cost them verification.
      expect(prisma.pharmacy.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ verificationStatus: 'PENDING' }) }),
      );
    });

    it('re-opens review when a verified pharmacy changes its licence number', async () => {
      seed('VERIFIED');
      prisma.pharmacy.update.mockResolvedValue({
        id: 'ph_1', name: 'Apollo', licenseNumber: 'LIC-CHANGED',
        verificationStatus: 'VERIFIED', isParticipating: true, reliabilityScore: 0.9,
      });

      await service.saveMyProfile(linked, { licenseNumber: 'LIC-CHANGED' });

      expect(prisma.pharmacy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verificationStatus: 'PENDING', isParticipating: false }),
        }),
      );
      expect(prisma.verificationRequest.create).toHaveBeenCalled();
    });

    it('does not let a SUSPENDED pharmacy clear its own suspension by saving', async () => {
      seed('SUSPENDED');

      await service.saveMyProfile(linked, { city: 'Hyderabad' });

      // Suspension is an enforcement state — only an admin may lift it.
      expect(prisma.pharmacy.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verificationStatus: 'PENDING' }),
        }),
      );
      expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
    });

    it('resubmits an INFO_REQUESTED pharmacy by reusing the open request', async () => {
      seed('INFO_REQUESTED');
      prisma.verificationRequest.findFirst.mockResolvedValue({ id: 'vr_open', notes: 'Send licence scan' });

      await service.saveMyProfile(linked, { city: 'Hyderabad' });

      expect(prisma.verificationRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vr_open' },
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(prisma.verificationRequest.create).not.toHaveBeenCalled();
    });
  });
});
