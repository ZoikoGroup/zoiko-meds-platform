import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { PharmacyAdminService } from './pharmacy-admin.service';
import { canParticipate, participationBlockedReason } from '../../pharmacy/participation';

/**
 * Verifying a pharmacy is not the same act as listing it to patients.
 *
 * They used to be one write, and it published records nobody could be shown: a
 * verification request that arrives without a pharmacy row creates one with no
 * address and no coordinates, and approving the licence marked it
 * participating. Every distance-bounded search then dropped it for having no
 * pin, so it was part of the verified network and absent from it at once. Two
 * such pharmacies sat in the production network for weeks, looking healthy in
 * the console the whole time.
 */

const located = (over: Record<string, unknown> = {}) => ({
  id: 'ph_1',
  name: 'HealthBridge Pharmacy',
  licenseNumber: 'LC-109283',
  addressLine1: '214 W Kinzie St',
  addressLine2: null,
  city: 'Chicago',
  region: 'Illinois',
  postalCode: '60654',
  country: 'United States',
  latitude: 41.889,
  longitude: -87.6354,
  locationPrecision: 'EXACT',
  verificationStatus: VerificationStatus.PENDING,
  isParticipating: false,
  reliabilityScore: 1,
  commercialClassification: 'DIRECTORY_UNCLAIMED',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const unlocated = (over: Record<string, unknown> = {}) =>
  located({ latitude: null, longitude: null, locationPrecision: null, ...over });

function buildService(existing: Record<string, unknown>) {
  const tx: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    verificationRequest: { updateMany: jest.fn() },
    jurisdiction: { upsert: jest.fn().mockResolvedValue({ id: 'jur-us', code: 'US' }) },
  };
  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
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

/** What the write actually set, from whichever call carried it. */
const written = (tx: any) => tx.pharmacy.update.mock.calls[0][0].data;

describe('the rule itself', () => {
  it('lists a verified pharmacy that has a position', () => {
    expect(
      canParticipate({
        verificationStatus: VerificationStatus.VERIFIED,
        latitude: 41.889,
        longitude: -87.6354,
      }),
    ).toBe(true);
  });

  it('withholds a verified pharmacy with no position', () => {
    expect(
      canParticipate({
        verificationStatus: VerificationStatus.VERIFIED,
        latitude: null,
        longitude: null,
      }),
    ).toBe(false);
  });

  it('withholds a located pharmacy that is not verified', () => {
    expect(
      canParticipate({
        verificationStatus: VerificationStatus.PENDING,
        latitude: 41.889,
        longitude: -87.6354,
      }),
    ).toBe(false);
  });

  it('explains a held listing, and says nothing when nothing is held', () => {
    const base = { verificationStatus: VerificationStatus.VERIFIED };
    expect(
      participationBlockedReason({ ...base, latitude: null, longitude: null }),
    ).toMatch(/no map location/i);
    expect(
      participationBlockedReason({ ...base, latitude: 41.889, longitude: -87.6354 }),
    ).toBeNull();
    // Not verified is not a held listing — it is simply not approved, which the
    // status already says. Two messages for one state would read as two problems.
    expect(
      participationBlockedReason({
        verificationStatus: VerificationStatus.PENDING,
        latitude: null,
        longitude: null,
      }),
    ).toBeNull();
  });
});

describe('PharmacyAdminService.setStatus — verifying is not publishing', () => {
  it('lists a located pharmacy on verification', async () => {
    const { service, tx } = buildService(located());

    await service.setStatus('admin_1', 'ph_1', VerificationStatus.VERIFIED);

    expect(written(tx)).toMatchObject({
      verificationStatus: VerificationStatus.VERIFIED,
      isParticipating: true,
    });
  });

  it('approves the licence of an unlocated pharmacy but does not list it', async () => {
    const { service, tx } = buildService(unlocated());

    await service.setStatus('admin_1', 'ph_1', VerificationStatus.VERIFIED);

    // The licence judgement stands. What is withheld is the claim to patients
    // that there is somewhere to go.
    expect(written(tx)).toMatchObject({
      verificationStatus: VerificationStatus.VERIFIED,
      isParticipating: false,
    });
  });

  it('unlists on suspension however well located the pharmacy is', async () => {
    const { service, tx } = buildService(located({ isParticipating: true }));

    await service.setStatus('admin_1', 'ph_1', VerificationStatus.SUSPENDED);

    expect(written(tx)).toMatchObject({
      verificationStatus: VerificationStatus.SUSPENDED,
      isParticipating: false,
    });
  });
});

describe('PharmacyAdminService.update — the listing follows the record it leaves behind', () => {
  it('publishes an already-verified pharmacy the moment a pin is set', async () => {
    const { service, tx } = buildService(
      unlocated({ verificationStatus: VerificationStatus.VERIFIED }),
    );

    await service.update('admin_1', 'ph_1', { latitude: 41.889, longitude: -87.6354 } as never);

    // Setting the coordinates is the whole fix; requiring a second, separate
    // "verify" click to publish would strand every pharmacy that was approved
    // before it had a location.
    expect(written(tx)).toMatchObject({ isParticipating: true });
  });

  it('verifies and lists in one edit when the pin comes with it', async () => {
    const { service, tx } = buildService(unlocated());

    await service.update('admin_1', 'ph_1', {
      verificationStatus: VerificationStatus.VERIFIED,
      latitude: 41.889,
      longitude: -87.6354,
    } as never);

    expect(written(tx)).toMatchObject({
      verificationStatus: VerificationStatus.VERIFIED,
      isParticipating: true,
    });
  });

  it('leaves an unrelated edit on a listed pharmacy listed', async () => {
    const { service, tx } = buildService(
      located({ verificationStatus: VerificationStatus.VERIFIED, isParticipating: true }),
    );

    await service.update('admin_1', 'ph_1', { phone: '+1 312 555 0142' } as never);

    expect(written(tx)).toMatchObject({ isParticipating: true });
  });
});

describe('PharmacyAdminService.bulkSetStatus - one batch, per-row answers', () => {
  it('splits the batch so unlocated pharmacies are not published with located ones', async () => {
    const { service, tx } = buildService(located());

    await service.bulkSetStatus('admin_1', ['ph_1', 'ph_2'], VerificationStatus.VERIFIED);

    const calls = tx.pharmacy.updateMany.mock.calls.map((c: any[]) => c[0]);
    const listing = calls.find((c: any) => c.data.isParticipating === true);
    const holding = calls.find((c: any) => c.data.isParticipating === false);

    // Verifying forty pharmacies at once must not publish the unlocated ones
    // merely because they were selected next to located ones - which one
    // updateMany, setting a single value across the batch, could not avoid.
    expect(listing.where).toMatchObject({
      latitude: { not: null },
      longitude: { not: null },
    });
    expect(holding.where.OR).toEqual([{ latitude: null }, { longitude: null }]);
    expect(holding.data.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('needs only one write when the batch is being unlisted', async () => {
    const { service, tx } = buildService(located());

    await service.bulkSetStatus('admin_1', ['ph_1'], VerificationStatus.SUSPENDED);

    // Nothing is being published, so there is no per-row question to answer.
    expect(tx.pharmacy.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.pharmacy.updateMany.mock.calls[0][0].data.isParticipating).toBe(false);
  });
});
