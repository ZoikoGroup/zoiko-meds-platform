import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { PUBLIC_PHARMACY_WHERE, signalAgeMinutes } from './availability.visibility';

/**
 * ZoikoAvail™ public availability lookup.
 *
 * The pharmacy portal writes AvailabilitySignal rows and every patient surface
 * reads them, so this asserts what "readable" means: looked up by MediBase
 * identity id, from a verified and participating pharmacy, never suppressed,
 * and never carrying a quantity.
 */
describe('AvailabilityService.getAvailability', () => {
  let service: AvailabilityService;
  let prisma: { availabilitySignal: { findMany: jest.Mock } };

  const signal = (over: Record<string, unknown> = {}) => ({
    confidence: 'HIGH',
    freshnessMinutes: null,
    requiresConfirmation: false,
    computedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    pharmacy: {
      id: 'ph_1',
      name: 'Zoiko Meds Pharmacy',
      city: 'Hyderabad',
      region: 'Telangana',
      latitude: 17.5878,
      longitude: 78.4236,
    },
    ...over,
  });

  beforeEach(() => {
    prisma = { availabilitySignal: { findMany: jest.fn().mockResolvedValue([signal()]) } };
    service = new AvailabilityService(prisma as unknown as PrismaService);
  });

  it('looks the medicine up by its MediBase identity id', async () => {
    await service.getAvailability('med_1');

    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];
    expect(args.where.medicineId).toBe('med_1');
  });

  it('excludes suppressed signals and pharmacies outside the verified network', async () => {
    await service.getAvailability('med_1');

    const [args] = prisma.availabilitySignal.findMany.mock.calls[0];
    expect(args.where.confidence).toEqual({ not: 'SUPPRESSED' });
    expect(args.where.pharmacy).toEqual(PUBLIC_PHARMACY_WHERE);
    expect(args.where.pharmacy).toMatchObject({
      verificationStatus: 'VERIFIED',
      isParticipating: true,
    });
  });

  it('quotes the signal age even when no snapshot was stored', async () => {
    // freshnessMinutes is an optional stored snapshot; computedAt always exists.
    // Reporting null here made the medicine detail page say "No recent signal"
    // for a signal the pharmacy portal showed as updated 2 hours ago.
    const [row] = await service.getAvailability('med_1');

    expect(row.freshnessMinutes).toBe(120);
  });

  it('never exposes a stock quantity', async () => {
    const [row] = await service.getAvailability('med_1');

    expect(Object.keys(row)).toEqual([
      'pharmacy',
      'confidence',
      'freshnessMinutes',
      'requiresConfirmation',
      'computedAt',
    ]);
  });
});

describe('signalAgeMinutes', () => {
  it('prefers the stored snapshot when there is one', () => {
    expect(signalAgeMinutes(7, new Date(Date.now() - 60 * 60 * 1000))).toBe(7);
  });

  it('derives the age from computedAt otherwise', () => {
    expect(signalAgeMinutes(null, new Date(Date.now() - 30 * 60 * 1000))).toBe(30);
  });

  it('never reports a negative age for a clock-skewed timestamp', () => {
    expect(signalAgeMinutes(null, new Date(Date.now() + 60 * 60 * 1000))).toBe(0);
  });
});
