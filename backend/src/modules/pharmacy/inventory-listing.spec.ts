import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
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
 * Pharmacy Portal → Inventory / Availability listing.
 *
 * The portal is the writer of AvailabilitySignal and patient search is the
 * reader, so what the portal lists has to be everything the pharmacy holds:
 * scoped to its own pharmacyId, keyed on the MediBase identity id, and never
 * narrowed by confidence band. A medicine patients can see a High, Moderate or
 * Low signal for must always be listed and editable here.
 */
describe('PharmacyService.getInventory', () => {
  let service: PharmacyService;
  let prisma: { availabilitySignal: { findMany: jest.Mock } };

  const row = (over: Record<string, unknown> = {}, medicine: Record<string, unknown> = {}) => ({
    id: 'sig_1',
    medicineId: 'med_1',
    confidence: 'HIGH',
    computedAt: new Date(),
    requiresConfirmation: false,
    medicine: {
      id: 'med_1',
      canonicalName: 'Insulin Glargine',
      genericName: 'Insulin glargine',
      brandNames: ['Lantus', 'Basaglar'],
      strength: '100 U/mL',
      dosageForm: 'Injection',
      ...medicine,
    },
    ...over,
  });

  beforeEach(() => {
    prisma = { availabilitySignal: { findMany: jest.fn().mockResolvedValue([row()]) } };
    service = new PharmacyService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditWriter,
      {} as unknown as SavedMedicineLinkService,
      { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
      allowAllPreferences(),
    );
  });

  it('reads only this pharmacy\'s signals', async () => {
    await service.getInventory('ph_1');

    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];
    expect(args.where).toEqual({ pharmacyId: 'ph_1' });
  });

  it('never filters by confidence band, so every signalled medicine is listed', async () => {
    await service.getInventory('ph_1');

    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];
    // A LOW / out-of-stock signal is still the pharmacy's own record and must
    // stay editable — that is how it gets set back to available.
    expect(args.where.confidence).toBeUndefined();
  });

  it('carries the MediBase identity id and its brand names onto each row', async () => {
    const [item] = await service.getInventory('ph_1');

    // Patient search matches brand names, so the portal needs them to be able
    // to find the same medicine by the same word the patient typed.
    expect(item.medicineId).toBe('med_1');
    expect(item.name).toBe('Insulin Glargine');
    expect(item.generic).toBe('Insulin glargine');
    expect(item.brands).toEqual(['Lantus', 'Basaglar']);
  });

  it('returns an empty brand list rather than undefined for an identity with none', async () => {
    prisma.availabilitySignal.findMany.mockResolvedValue([row({}, { brandNames: [] })]);

    const [item] = await service.getInventory('ph_1');

    expect(item.brands).toEqual([]);
  });

  it('maps every confidence band to a portal status', async () => {
    prisma.availabilitySignal.findMany.mockResolvedValue([
      row({ id: 'a', confidence: 'HIGH' }),
      row({ id: 'b', confidence: 'MODERATE' }),
      row({ id: 'c', confidence: 'LOW' }),
    ]);

    const items = await service.getInventory('ph_1');

    expect(items.map((i) => i.status)).toEqual(['available', 'limited', 'out-of-stock']);
    expect(items.map((i) => i.confidence)).toEqual(['high', 'moderate', 'low']);
  });
});
