import { NotFoundException } from '@nestjs/common';
import { CommercialClassification, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';
import { PUBLIC_PHARMACY_WHERE } from '../availability/availability.visibility';

/**
 * The two public pharmacy routes.
 *
 * `GET /pharmacies` and `GET /pharmacies/:id` carry no guard — they are patient
 * surfaces. Every other patient surface (/me/search, saved medicines,
 * ZoikoSignal, /availability) filters through the one shared rule in
 * availability.visibility.ts. These two did not.
 *
 * The list asked for verification and participation and stopped there, so a
 * pharmacy nobody has claimed was listed here while being correctly hidden from
 * search — the same inconsistency MSA-54 fixed everywhere else. The detail route
 * asked nothing at all: any id returned a full pharmacy row, so a pending,
 * rejected or suspended pharmacy's licence number, address, phone, reliability
 * score and commercial standing were readable by anyone who knew its id.
 *
 * A pharmacy under review is not a secret, but it is also not part of the
 * verified network, and a patient surface that answers for it presents it as
 * one. Both routes now ask the same question every other one does.
 */

const VISIBLE = {
  id: 'ph_visible',
  name: 'Zoiko Meds',
  city: 'Hyderabad',
  region: 'Telangana',
  reliabilityScore: 0.9,
  logoUpdatedAt: null,
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
};

/** Every way a pharmacy can fail the rule, as a patient query would see it. */
const HIDDEN_CASES: Array<[string, Record<string, unknown>]> = [
  ['A. pending review', { verificationStatus: VerificationStatus.PENDING }],
  ['A. under review after an info request', { verificationStatus: VerificationStatus.INFO_REQUESTED }],
  ['B. rejected', { verificationStatus: VerificationStatus.REJECTED }],
  ['E. suspended', { verificationStatus: VerificationStatus.SUSPENDED }],
  ['never submitted', { verificationStatus: VerificationStatus.UNVERIFIED }],
  ['C. verified but not participating', { isParticipating: false }],
  [
    'D. verified but unclaimed',
    { commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED },
  ],
  [
    'D. verified but claim unproven',
    { commercialClassification: CommercialClassification.CLAIMED_PENDING },
  ],
  [
    'D. verified but a sandbox record',
    { commercialClassification: CommercialClassification.PARTNER_SANDBOX },
  ],
];

/**
 * A pharmacy table that applies the where-clause it is given.
 *
 * The subject is precisely which rows a filter admits, so a findMany that
 * ignored `where` would pass whatever the service did.
 */
function buildService(rows: Array<Record<string, any>>) {
  const matches = (row: any, where: any = {}) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.verificationStatus !== undefined && row.verificationStatus !== where.verificationStatus)
      return false;
    if (where.isParticipating !== undefined && row.isParticipating !== where.isParticipating)
      return false;
    const classification = where.commercialClassification;
    if (classification?.in && !classification.in.includes(row.commercialClassification)) {
      return false;
    }
    return true;
  };

  const prisma: any = {
    pharmacy: {
      // `select` is honoured so the projection can be asserted: the real query
      // narrows the columns, and a stub returning whole rows would report a
      // leak that is not there — or hide one that is.
      findMany: jest.fn(async ({ where, select }: any = {}) =>
        rows
          .filter((row) => matches(row, where))
          .map((row) =>
            select
              ? Object.fromEntries(
                  Object.keys(select)
                    .filter((key) => select[key])
                    .map((key) => [key, row[key]]),
                )
              : { ...row },
          ),
      ),
      findUnique: jest.fn(async ({ where }: any = {}) => {
        const found = rows.find((row) => matches(row, where));
        return found ? { ...found } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const found = rows.find((row) => matches(row, where));
        return found ? { ...found } : null;
      }),
    },
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    { linkPendingSaves: jest.fn() } as unknown as SavedMedicineLinkService,
    {} as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    {} as unknown as NearbyPharmacyService,
  );
  return { service, prisma };
}

const hidden = (over: Record<string, unknown>) => ({ ...VISIBLE, id: 'ph_hidden', ...over });

describe('GET /pharmacies — the public list', () => {
  it('F. returns a pharmacy that passes every gate', async () => {
    const { service } = buildService([VISIBLE]);

    expect((await service.listVerified()).map((p: any) => p.id)).toEqual(['ph_visible']);
  });

  it.each(HIDDEN_CASES)('does not return one that is %s', async (_label, over) => {
    const { service } = buildService([hidden(over)]);

    expect(await service.listVerified()).toEqual([]);
  });

  it.each(HIDDEN_CASES)('returns only the eligible one alongside %s', async (_label, over) => {
    // The mixed case: a hidden row must not ride along with a visible one.
    const { service } = buildService([VISIBLE, hidden(over)]);

    expect((await service.listVerified()).map((p: any) => p.id)).toEqual(['ph_visible']);
  });

  it('asks the shared rule rather than a filter of its own', async () => {
    const { service, prisma } = buildService([VISIBLE]);

    await service.listVerified();

    expect(prisma.pharmacy.findMany.mock.calls[0][0].where).toEqual(PUBLIC_PHARMACY_WHERE);
  });

  it('exposes no internal standing on the rows it does return', async () => {
    // A patient list answers who and where, not how a reviewer classified them.
    const { service } = buildService([VISIBLE]);

    const [row]: any = await service.listVerified();

    expect(row.commercialClassification).toBeUndefined();
    expect(row.verificationStatus).toBeUndefined();
  });
});

describe('GET /pharmacies/:id — the public detail route', () => {
  it('F. returns a pharmacy that passes every gate', async () => {
    const { service } = buildService([VISIBLE]);

    expect((await service.findById('ph_visible')).id).toBe('ph_visible');
  });

  it.each(HIDDEN_CASES)('refuses one that is %s', async (_label, over) => {
    const { service } = buildService([hidden(over)]);

    await expect(service.findById('ph_hidden')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers a hidden pharmacy exactly as it answers one that does not exist', async () => {
    // Distinguishing the two would turn the route into a way to confirm that a
    // named pharmacy is on the platform and under review.
    const { service } = buildService([hidden({ verificationStatus: VerificationStatus.PENDING })]);

    const hiddenErr = await service.findById('ph_hidden').catch((e) => e);
    const missingErr = await service.findById('ph_nothing').catch((e) => e);

    expect(hiddenErr.message).toBe(missingErr.message);
  });

  it('leaks nothing about a pharmacy under review', async () => {
    const { service } = buildService([
      hidden({ verificationStatus: VerificationStatus.PENDING, licenseNumber: 'LIC-SECRET' }),
    ]);

    const error = await service.findById('ph_hidden').catch((e) => e);

    expect(JSON.stringify(error.message)).not.toContain('LIC-SECRET');
  });
});

describe('the record itself is untouched', () => {
  it('hiding a pharmacy does not delete or alter it', async () => {
    // Visibility is a read rule. A pharmacy under review keeps its row, its
    // inventory and its signals, and becomes visible on approval without
    // anything being re-entered.
    const { service, prisma } = buildService([
      hidden({ verificationStatus: VerificationStatus.PENDING }),
    ]);

    await service.listVerified();
    await service.findById('ph_hidden').catch(() => null);

    expect(prisma.pharmacy.update).toBeUndefined();
    expect(prisma.pharmacy.delete).toBeUndefined();
  });
});
