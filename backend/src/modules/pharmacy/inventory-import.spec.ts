import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyService } from './pharmacy.service';

/**
 * Bulk CSV import: what it tells patients, and what it tells the pharmacy.
 *
 * The single-item form already linked name-only saved medicines and alerted the
 * patients waiting on them. A bulk import did not, so the same medicine raised
 * an alert when typed into the form and none when it arrived in a file — a
 * pharmacy's choice of upload method is not something a patient should be able
 * to feel. The pharmacy heard nothing either way: the portal's Uploads tab had
 * no writer at all.
 */

const PHARMACY = 'ph_apollo';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: PHARMACY,
};

function build() {
  const catalog: Record<string, any> = {
    asthalin: {
      id: 'med_asthalin',
      canonicalName: 'Asthalin',
      genericName: 'Salbutamol',
      strength: '100 mcg',
      dosageForm: 'Tablet',
    },
    dolo: {
      id: 'med_dolo',
      canonicalName: 'Dolo',
      genericName: 'Paracetamol',
      strength: '650 mg',
      dosageForm: 'Tablet',
    },
  };

  const prisma: any = {
    medicineEntity: {
      findUnique: jest.fn(async ({ where }: any) =>
        Object.values(catalog).find((m) => m.id === where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const name = (where.canonicalName?.equals ?? '').toLowerCase();
        return catalog[name] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: `med_${data.canonicalName}`, ...data })),
    },
    inventorySignal: { create: jest.fn() },
    availabilitySignal: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async () => ({ id: `sig_${prisma.availabilitySignal.create.mock.calls.length}` })),
      update: jest.fn(async () => ({ id: 'sig_existing' })),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    pharmacy: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Apollo Pharmacy', jurisdictionId: 'jur_in' }),
    },
  };

  const audit = { write: jest.fn() };
  const savedLink = { linkPendingSaves: jest.fn().mockResolvedValue(1) };
  const portalNotifications = {
    inventoryBecameAvailable: jest.fn(),
    inventoryBecameUnavailable: jest.fn(),
    bulkUploadCompleted: jest.fn(),
  };
  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
    savedLink as unknown as SavedMedicineLinkService,
    portalNotifications as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
  );
  return { service, prisma, audit, savedLink, portalNotifications, catalog };
}

const importCsv = (service: PharmacyService, csv: string, mode: 'merge' | 'replace' = 'merge') =>
  service.importCsv(PHARMACY, csv, mode, USER, '10.0.0.1');

describe('PharmacyService.importCsv — patient alerts', () => {
  it('links saved medicines for every stocked row, as the single-item form does', async () => {
    const { service, savedLink } = build();

    await importCsv(service, ['name,status', 'Asthalin,available', 'Dolo,available'].join('\n'));

    expect(savedLink.linkPendingSaves).toHaveBeenCalledTimes(2);
    const linked = savedLink.linkPendingSaves.mock.calls.map(([m]: any[]) => m.canonicalName);
    expect(linked.sort()).toEqual(['Asthalin', 'Dolo']);
  });

  it('links a repeated medicine once, not once per row', async () => {
    const { service, savedLink } = build();

    await importCsv(
      service,
      ['name,status', 'Asthalin,available', 'Asthalin,available', 'Asthalin,available'].join('\n'),
    );

    // linkPendingSaves is a query per call, so a long file listing the same
    // medicine repeatedly must not turn into one lookup per line.
    expect(savedLink.linkPendingSaves).toHaveBeenCalledTimes(1);
  });

  it('does not treat an out-of-stock row as an availability event', async () => {
    const { service, savedLink } = build();

    await importCsv(service, ['name,status', 'Asthalin,out-of-stock'].join('\n'));

    // Telling patients a medicine is "now available" because a file reported it
    // absent is the one thing this hook must never do.
    expect(savedLink.linkPendingSaves).not.toHaveBeenCalled();
  });

  it('does not link rows the importer skipped', async () => {
    const { service, savedLink } = build();

    // A row with neither a name nor a medicineId is skipped outright.
    await importCsv(service, ['name,status', ',available', 'Asthalin,available'].join('\n'));

    expect(savedLink.linkPendingSaves).toHaveBeenCalledTimes(1);
    expect(savedLink.linkPendingSaves.mock.calls[0][0].canonicalName).toBe('Asthalin');
  });
});

describe('PharmacyService.importCsv — pharmacy portal row', () => {
  it('reports the outcome with the counts it returned', async () => {
    const { service, portalNotifications } = build();

    const result = await importCsv(
      service,
      ['name,status', 'Asthalin,available', 'Dolo,available'].join('\n'),
    );

    expect(portalNotifications.bulkUploadCompleted).toHaveBeenCalledTimes(1);
    const [pharmacyId, outcome] = portalNotifications.bulkUploadCompleted.mock.calls[0];
    expect(pharmacyId).toBe(PHARMACY);
    // The notification and the HTTP response describe one import — they cannot
    // be allowed to disagree about how much of the file landed.
    expect(outcome).toEqual({
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      totalProcessed: result.totalProcessed,
      mode: 'merge',
    });
  });

  it('reports an import that applied nothing', async () => {
    const { service, portalNotifications } = build();

    await importCsv(service, ['name,status', ',available', ',available'].join('\n'));

    const [, outcome] = portalNotifications.bulkUploadCompleted.mock.calls[0];
    // Silence here is the worst case: the pharmacy believes its inventory is
    // live when nothing was applied.
    expect(outcome.skipped).toBe(2);
    expect(outcome.imported + outcome.updated).toBe(0);
  });

  it('passes the mode through, because replace prunes what the file omits', async () => {
    const { service, portalNotifications } = build();

    await importCsv(service, ['name,status', 'Asthalin,available'].join('\n'), 'replace');

    expect(portalNotifications.bulkUploadCompleted.mock.calls[0][1].mode).toBe('replace');
  });
});
