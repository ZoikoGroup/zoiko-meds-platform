import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * What GET /pharmacies/me says about being findable.
 *
 * The portal shows "verified and visible to users" from `patientVisible` and
 * from nothing else, so this is where that answer has to be right. It is the
 * whole patient rule — approval, participation and commercial standing — not
 * the verification status the operator can already see on the badge.
 */

const BASE = {
  id: 'ph_1',
  name: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  phone: '+91 96663 44441',
  addressLine1: 'Prakruthi nivas',
  addressLine2: null,
  city: 'Gandimaisamma',
  region: 'Telangana',
  country: 'IN',
  postalCode: '500043',
  latitude: 17.5878,
  longitude: 78.4236,
  locationPrecision: 'EXACT',
  verificationStatus: 'VERIFIED',
  isParticipating: true,
  reliabilityScore: 0.9,
  commercialClassification: 'VERIFIED_NETWORK_CORE',
  logoUpdatedAt: null,
};

function buildService(pharmacy: Record<string, unknown>) {
  const prisma: any = {
    pharmacy: { findUnique: jest.fn().mockResolvedValue(pharmacy) },
    verificationRequest: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {} as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    {} as unknown as NearbyPharmacyService,
  );
}

const profileFor = (over: Record<string, unknown> = {}) =>
  buildService({ ...BASE, ...over }).getProfile('ph_1');

describe('verified and findable', () => {
  it('reports patientVisible', async () => {
    expect((await profileFor()).patientVisible).toBe(true);
  });

  it('raises nothing that is holding it back', async () => {
    expect((await profileFor()).listingBlockedReason).toBeNull();
  });
});

describe('verified but not findable', () => {
  it('is not visible without a location', async () => {
    const profile = await profileFor({ isParticipating: false, latitude: null, longitude: null });

    expect(profile.patientVisible).toBe(false);
    expect(profile.listingBlockedReason).toMatch(/no map location/i);
  });

  it('is not visible when it has left the network', async () => {
    const profile = await profileFor({ isParticipating: false });

    expect(profile.patientVisible).toBe(false);
    expect(profile.listingBlockedReason).toMatch(/not taking part/i);
  });

  it('is not visible while the account is still being set up', async () => {
    // Verified, participating, located — and shown to nobody, because approval
    // does not promote the classification. The case that used to report
    // nothing at all.
    const profile = await profileFor({ commercialClassification: 'CLAIMED_PENDING' });

    expect(profile.patientVisible).toBe(false);
    expect(profile.listingBlockedReason).toMatch(/still being set up/i);
  });

  it('tells the operator when there is nothing for them to do', async () => {
    const profile = await profileFor({ commercialClassification: 'CLAIMED_PENDING' });

    expect(profile.listingBlockedReason).toMatch(/nothing for you to do/i);
  });
});

describe('not verified yet', () => {
  it.each(['PENDING', 'REJECTED', 'UNVERIFIED', 'SUSPENDED'])('%s is not visible', async (status) => {
    expect((await profileFor({ verificationStatus: status })).patientVisible).toBe(false);
  });

  it.each(['PENDING', 'REJECTED'])(
    '%s raises no listing warning, because the review notice covers it',
    async (status) => {
      // Two notices for one situation reads as two separate problems.
      expect((await profileFor({ verificationStatus: status })).listingBlockedReason).toBeNull();
    },
  );
});

describe('after a Super Admin approval', () => {
  it('flips to visible on the next read', async () => {
    // No state is cached between reads: the portal asks on every mount, so the
    // approval shows up on a refresh.
    const before = await profileFor({ verificationStatus: 'PENDING', isParticipating: false });
    const after = await profileFor();

    expect(before.patientVisible).toBe(false);
    expect(after.patientVisible).toBe(true);
  });
});
