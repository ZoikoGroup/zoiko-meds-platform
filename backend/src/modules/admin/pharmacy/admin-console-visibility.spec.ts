import { CommercialClassification, UserRole, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../audit.writer';
import { PharmacyAdminService } from './pharmacy-admin.service';

/**
 * What the Super Admin console says about a pharmacy patients cannot find.
 *
 * The console showed "Listed to patients" from `isParticipating` — one of the
 * four gates the patient queries actually apply. So a record could read
 * Networked and Listed while every patient search dropped it, which is how the
 * reported confusion arose: the console said the pharmacy was live, the
 * pharmacy's own portal said "you're all set", and patients could not find it.
 *
 * The console now reports the shared rule's own answer, and says which gate is
 * closed in a reviewer's voice rather than an operator's.
 */

const PHARMACY = {
  id: 'ph_1',
  name: 'Corner Chemist',
  licenseNumber: 'LIC-CORNER',
  addressLine1: 'Main Road',
  addressLine2: null,
  city: 'Hyderabad',
  region: 'Telangana',
  postalCode: '500043',
  country: 'IN',
  phone: '+91 96663 44441',
  latitude: 17.4,
  longitude: 78.5,
  locationPrecision: 'EXACT',
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
  reliabilityScore: 0.9,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  jurisdiction: { code: 'IN', name: 'India' },
  users: [{ id: 'user_manager' }],
};

function buildService(row: Record<string, any>) {
  const prisma: any = {
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue(row),
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const service = new PharmacyAdminService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    {} as unknown as NearbyPharmacyService,
  );
  return { service, prisma };
}

const dtoFor = (over: Record<string, any> = {}) =>
  buildService({ ...PHARMACY, ...over }).service.get('ph_1');

describe('a pharmacy patients can find', () => {
  it('reports it as visible', async () => {
    expect((await dtoFor()).patientVisible).toBe(true);
  });

  it('raises nothing that is holding it back', async () => {
    expect((await dtoFor()).listingBlockedReason).toBeNull();
  });

  it('says an account is linked', async () => {
    expect((await dtoFor()).hasActiveManager).toBe(true);
  });
});

describe('F. a pharmacy with no pharmacy account linked to it', () => {
  // Every column on the record still reads "in the network". The only thing
  // that changed is that nobody is signed in to answer for the stock.
  const unmanaged = () => dtoFor({ users: [] });

  it('is not reported as visible, however healthy the row looks', async () => {
    const dto = await unmanaged();

    expect(dto.status).toBe(VerificationStatus.VERIFIED);
    expect(dto.isParticipating).toBe(true);
    expect(dto.commercialClassification).toBe(CommercialClassification.VERIFIED_NETWORK_CORE);
    expect(dto.patientVisible).toBe(false);
  });

  it('names the gate that is closed', async () => {
    expect((await unmanaged()).listingBlockedReason).toMatch(
      /no active pharmacy account is linked/i,
    );
  });

  it('tells the reviewer the record and its inventory are intact', async () => {
    // The reviewer's next question is whether anything was lost. Nothing was.
    expect((await unmanaged()).listingBlockedReason).toMatch(/details and inventory are intact/i);
  });

  it('says what would list it again', async () => {
    expect((await unmanaged()).listingBlockedReason).toMatch(/linking a pharmacy account/i);
  });

  it('reports the missing account as its own fact', async () => {
    expect((await unmanaged()).hasActiveManager).toBe(false);
  });
});

describe('the other closed gates, each named', () => {
  it('an unclaimed classification', async () => {
    const dto = await dtoFor({
      commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
    });

    expect(dto.patientVisible).toBe(false);
    expect(dto.listingBlockedReason).toMatch(/commercial standing is DIRECTORY_UNCLAIMED/i);
  });

  it('having left the network', async () => {
    const dto = await dtoFor({ isParticipating: false });

    expect(dto.patientVisible).toBe(false);
    expect(dto.listingBlockedReason).toMatch(/not currently taking part/i);
  });

  it('no map location — the reason that was already reported, unchanged', async () => {
    const dto = await dtoFor({ latitude: null, longitude: null, isParticipating: false });

    expect(dto.patientVisible).toBe(false);
    expect(dto.listingBlockedReason).toMatch(/no map location/i);
  });

  it.each([
    VerificationStatus.PENDING,
    VerificationStatus.REJECTED,
    VerificationStatus.SUSPENDED,
    VerificationStatus.UNVERIFIED,
  ])('%s is not visible, and needs no second notice', async (status) => {
    // The queue already says where an unapproved pharmacy stands; repeating it
    // as a listing problem reads as a separate thing to fix.
    const dto = await dtoFor({ verificationStatus: status });

    expect(dto.patientVisible).toBe(false);
    expect(dto.listingBlockedReason).toBeNull();
  });
});

describe('the query the console runs', () => {
  it('asks for active operator accounts, one row being enough', async () => {
    const { service, prisma } = buildService(PHARMACY);

    await service.list({} as never);
    const [args] = prisma.pharmacy.findMany.mock.calls[0];

    expect(args.include.users).toEqual({
      where: { isActive: true, role: { in: [UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF] } },
      select: { id: true },
      take: 1,
    });
  });

  it('selects no field of the account beyond its id', async () => {
    // The console is answering "is there anybody", not "who". A reviewer's list
    // query has no business carrying operator identities.
    const { service, prisma } = buildService(PHARMACY);

    await service.list({} as never);
    const [args] = prisma.pharmacy.findMany.mock.calls[0];

    expect(Object.keys(args.include.users.select)).toEqual(['id']);
  });

  it('reports the same answer on the list as on the detail', async () => {
    const { service } = buildService({ ...PHARMACY, users: [] });

    const listed = await service.list({} as never);
    const detail = await service.get('ph_1');

    expect(listed.items[0].patientVisible).toBe(false);
    expect(detail.patientVisible).toBe(false);
    expect(listed.items[0].listingBlockedReason).toBe(detail.listingBlockedReason);
  });
});
