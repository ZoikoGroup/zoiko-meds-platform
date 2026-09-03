import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';
import { VerificationStatus } from '@prisma/client';

/**
 * A verified pharmacy cannot rename itself.
 *
 * It could. Saving the profile wrote the new name straight to the Pharmacy row,
 * so a pharmacy that changed "Zoiko Meds Pharmacy" to "Zoiko Meds" was listed
 * under the new name in Pharmacy Management, and shown under it to patients,
 * while its verification request still read Pending. Approval had nothing left
 * to apply and only moved a status; rejection could not put it back. The review
 * step decided nothing.
 *
 * The approved identity now stays on the pharmacy and the requested one goes on
 * the request, and only an approval brings them together.
 */

const PHARMACY_ID = 'ph_1';
const USER = { id: 'u_1', fullName: 'Naveen', email: 'ops@zoiko.test' } as never;

const verified = (over: Record<string, unknown> = {}) => ({
  id: PHARMACY_ID,
  name: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-OLD',
  addressLine1: 'Gandimaisamma',
  addressLine2: null,
  city: 'Hyderabad',
  region: null,
  country: 'India',
  postalCode: '500043',
  phone: '+919666344441',
  latitude: 17.5878,
  longitude: 78.4236,
  locationPrecision: 'EXACT',
  jurisdictionId: 'jur_in',
  verificationStatus: VerificationStatus.VERIFIED,
  ...over,
});

function buildService(existing = verified()) {
  const written: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];

  const prisma: any = {
    pharmacy: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest.fn(async ({ data }: any) => {
        written.push(data);
        return { ...existing, ...data };
      }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ pharmacyId: PHARMACY_ID }), update: jest.fn() },
    verificationRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => {
        requests.push(data);
        return { id: 'req_new', ...data };
      }),
      update: jest.fn(async ({ data }: any) => {
        requests.push(data);
        return { id: 'req_open', ...data };
      }),
      updateMany: jest.fn(),
    },
    verificationDocument: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {} as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );

  // getProfile re-reads the row at the end of updateProfile; the assertions here
  // are about what was written, so a stub keeps the test to one subject.
  jest.spyOn(service as never, 'getProfile' as never).mockResolvedValue({} as never);

  return { service, prisma, written, requests };
}

/** The identity fields of the write that touched the pharmacy row. */
const identityWrite = (written: Record<string, unknown>[]) =>
  written.find((w) => 'name' in w) ?? {};

describe('1 & 6. a verified pharmacy changing its identity', () => {
  it('leaves the approved name on the pharmacy row', async () => {
    const { service, written } = buildService();

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(identityWrite(written).name).toBe('Zoiko Meds Pharmacy');
  });

  it('leaves the approved licence number on the pharmacy row', async () => {
    const { service, written } = buildService();

    await service.updateProfile(PHARMACY_ID, { licenseNumber: 'LIC-JHC951' } as never, USER);

    expect(identityWrite(written).licenseNumber).toBe('LIC-OLD');
  });

  it('records the requested name on the verification request', async () => {
    const { service, requests } = buildService();

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(requests.some((r) => r.pharmacyName === 'Zoiko Meds')).toBe(true);
  });

  it('records the requested licence on the verification request', async () => {
    const { service, requests } = buildService();

    await service.updateProfile(PHARMACY_ID, { licenseNumber: 'LIC-JHC951' } as never, USER);

    expect(requests.some((r) => r.licenseNumber === 'LIC-JHC951')).toBe(true);
  });

  it('sends the pharmacy back into the review queue', async () => {
    const { service, written } = buildService();

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(written.some((w) => w.verificationStatus === VerificationStatus.PENDING)).toBe(true);
  });

  it('takes it out of patient search while the request is open', async () => {
    // Unapproved identity must not reach a patient, and the way it cannot is
    // that the pharmacy is unlisted until the review closes.
    const { service, written } = buildService();

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(written.some((w) => w.isParticipating === false)).toBe(true);
  });
});

describe('7. changes that are not identity changes', () => {
  it('still writes an ordinary address edit straight through', async () => {
    // Only name and licence are attested. Staging an address edit would leave a
    // pharmacy unable to correct its own address without a reviewer.
    const { service, written } = buildService();

    await service.updateProfile(PHARMACY_ID, { addressLine1: 'New Road' } as never, USER);

    expect(identityWrite(written).addressLine1).toBe('New Road');
    expect(identityWrite(written).name).toBe('Zoiko Meds Pharmacy');
  });

  it('does not stage a save that renames nothing', async () => {
    const { service, written } = buildService();

    await service.updateProfile(
      PHARMACY_ID,
      { name: 'Zoiko Meds Pharmacy', licenseNumber: 'LIC-OLD' } as never,
      USER,
    );

    expect(identityWrite(written).name).toBe('Zoiko Meds Pharmacy');
    expect(written.some((w) => w.verificationStatus === VerificationStatus.PENDING)).toBe(false);
  });
});

describe('10. first-time verification is unaffected', () => {
  it.each([
    VerificationStatus.UNVERIFIED,
    VerificationStatus.PENDING,
    VerificationStatus.INFO_REQUESTED,
  ])('writes the name straight through from %s', async (verificationStatus) => {
    // No approved identity exists to protect, so holding the name back would
    // leave the record blank or stale with nothing to contradict it.
    const { service, written } = buildService(verified({ verificationStatus, name: 'Draft Name' }));

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(identityWrite(written).name).toBe('Zoiko Meds');
  });

  it('writes the licence straight through for a new pharmacy', async () => {
    const { service, written } = buildService(
      verified({ verificationStatus: VerificationStatus.UNVERIFIED, licenseNumber: null }),
    );

    await service.updateProfile(PHARMACY_ID, { licenseNumber: 'LIC-JHC951' } as never, USER);

    expect(identityWrite(written).licenseNumber).toBe('LIC-JHC951');
  });
});

describe('a suspended pharmacy cannot re-enter the queue by saving', () => {
  it('stays suspended and applies the edit as an ordinary one', async () => {
    // Enforcement state: only an admin lifts it. Staging is keyed on VERIFIED,
    // so a suspended row writes through and gains no new review.
    const { service, written } = buildService(
      verified({ verificationStatus: VerificationStatus.SUSPENDED }),
    );

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    expect(written.some((w) => w.verificationStatus === VerificationStatus.PENDING)).toBe(false);
  });
});

describe('the reviewer note is no longer generated', () => {
  it('writes no system sentence into notes', async () => {
    // It said the same thing every time and was appended on each resubmit, so a
    // twice-corrected request opened with the line three times over, above the
    // reviewer's own words. The reason is derived from the diff instead.
    const { service, requests } = buildService();

    await service.updateProfile(PHARMACY_ID, { name: 'Zoiko Meds' } as never, USER);

    for (const request of requests) {
      expect(request.notes).toBeUndefined();
    }
  });
});
