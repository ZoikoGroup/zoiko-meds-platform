import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { AuditWriter } from '../admin/audit.writer';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * Reports → Frequently requested.
 *
 * The card ranked the pharmacy's inventory by how many patients had SAVED each
 * medicine — a different action, counted across the whole platform — and then
 * showed the top five whatever the numbers were. Almost nothing is ever saved,
 * so every count was 0 and the five names were simply the first five rows of
 * the pharmacy's own inventory: real medicines, no relationship to demand.
 *
 * Demand is now SignalEvent SEARCH rows, matched on the MediBase identity the
 * search resolved to and scoped to what this pharmacy stocks.
 */

const STOCK = [
  { medicineId: 'med_dolo', medicine: { canonicalName: 'Dolo 650' } },
  { medicineId: 'med_para', medicine: { canonicalName: 'Paracetamol' } },
  { medicineId: 'med_limcee', medicine: { canonicalName: 'Limcee' } },
];

/**
 * @param stock       what this pharmacy has in its inventory
 * @param searches    SEARCH events per medicine identity, platform-wide
 */
function buildService({
  stock = STOCK,
  searches = {} as Record<string, number>,
}: { stock?: typeof STOCK; searches?: Record<string, number> } = {}) {
  const prisma: any = {
    availabilitySignal: {
      findMany: jest.fn().mockResolvedValue(
        stock.map((s) => ({ ...s, confidence: 'HIGH', computedAt: new Date() })),
      ),
    },
    inventorySignal: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    savedMedicine: { groupBy: jest.fn().mockResolvedValue([]) },
    signalEvent: {
      groupBy: jest.fn(async ({ where }: any) => {
        // Mirror Prisma: only identities named in the filter come back.
        const wanted: string[] = where?.medicineId?.in ?? [];
        return Object.entries(searches)
          .filter(([id]) => wanted.includes(id))
          .map(([medicineId, count]) => ({ medicineId, _count: { _all: count } }));
      }),
    },
  };

  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    {} as unknown as AuditWriter,
    {} as unknown as SavedMedicineLinkService,
    { inventoryBecameAvailable: jest.fn(), inventoryBecameUnavailable: jest.fn(), bulkUploadCompleted: jest.fn() } as unknown as PharmacyNotificationService,
    {} as unknown as NotificationPreferencesService,
    { geocode: jest.fn().mockResolvedValue(null) } as unknown as NearbyPharmacyService,
  );
  return { service, prisma };
}

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe('only medicines this pharmacy stocks', () => {
  it('does not show a medicine that is not in the inventory', async () => {
    // The reported case: Deriphyllin was searched, but this pharmacy does not
    // stock it, so it is not this pharmacy's demand to act on.
    const { service } = buildService({
      searches: { med_deriphyllin: 15, med_dolo: 30 },
    });

    const { frequentlyRequested } = await service.getReports('ph_1');

    expect(names(frequentlyRequested)).toEqual(['Dolo 650']);
    expect(names(frequentlyRequested)).not.toContain('Deriphyllin');
  });

  it('asks the database only about identities it stocks', async () => {
    const { service, prisma } = buildService({ searches: { med_dolo: 3 } });

    await service.getReports('ph_1');

    const [args] = prisma.signalEvent.groupBy.mock.calls[0];
    expect(args.where.medicineId.in.sort()).toEqual(['med_dolo', 'med_limcee', 'med_para']);
    expect(args.where.type).toBe('SEARCH');
  });

  it('reads inventory scoped to the pharmacy being reported on', async () => {
    const { service, prisma } = buildService({ searches: { med_dolo: 3 } });

    await service.getReports('ph_42');

    expect(prisma.availabilitySignal.findMany.mock.calls[0][0].where).toMatchObject({
      pharmacyId: 'ph_42',
    });
  });

  it('keeps one pharmacy’s demand out of another’s report', async () => {
    // Pharmacy A stocks Dolo; pharmacy B stocks Limcee. The same platform-wide
    // search counts must produce different reports.
    const searches = { med_dolo: 30, med_limcee: 5 };
    const a = buildService({ stock: [STOCK[0]], searches });
    const b = buildService({ stock: [STOCK[2]], searches });

    expect(names((await a.service.getReports('ph_a')).frequentlyRequested)).toEqual(['Dolo 650']);
    expect(names((await b.service.getReports('ph_b')).frequentlyRequested)).toEqual(['Limcee']);
  });

  it('drops a medicine that has been removed from the inventory', async () => {
    // It was stocked, it was searched, it is gone — so it leaves the report.
    const searches = { med_dolo: 30, med_para: 20 };
    const before = buildService({ stock: STOCK, searches });
    const after = buildService({ stock: [STOCK[0], STOCK[2]], searches });

    expect(names((await before.service.getReports('ph_1')).frequentlyRequested)).toContain(
      'Paracetamol',
    );
    expect(names((await after.service.getReports('ph_1')).frequentlyRequested)).not.toContain(
      'Paracetamol',
    );
  });
});

describe('the numbers are real search counts', () => {
  it('reports the count the events actually hold', async () => {
    const { service } = buildService({ searches: { med_dolo: 30 } });

    const [top] = (await service.getReports('ph_1')).frequentlyRequested;

    expect(top).toMatchObject({ id: 'med_dolo', name: 'Dolo 650', requests: 30 });
  });

  it('counts a medicine once, however the search was spelled', async () => {
    // "Dolo 650", "Dolo-650" and "dolo 650 mg" resolve to one MediBase identity
    // at search time, so they arrive as events against that one id. Matching is
    // on the id — no name comparison happens anywhere in this path.
    const { service, prisma } = buildService({ searches: { med_dolo: 42 } });

    const { frequentlyRequested } = await service.getReports('ph_1');

    expect(frequentlyRequested).toHaveLength(1);
    expect(frequentlyRequested[0].requests).toBe(42);
    expect(prisma.signalEvent.groupBy.mock.calls[0][0].by).toEqual(['medicineId']);
  });

  it('no longer counts saved medicines, which are a different action', async () => {
    const { service, prisma } = buildService({ searches: { med_dolo: 30 } });

    await service.getReports('ph_1');

    expect(prisma.savedMedicine.groupBy).not.toHaveBeenCalled();
  });
});

describe('ordering', () => {
  it('ranks by demand, highest first', async () => {
    const { service } = buildService({
      stock: [
        { medicineId: 'med_a', medicine: { canonicalName: 'Medicine A' } },
        { medicineId: 'med_b', medicine: { canonicalName: 'Medicine B' } },
        { medicineId: 'med_c', medicine: { canonicalName: 'Medicine C' } },
      ],
      searches: { med_a: 20, med_b: 50, med_c: 10 },
    });

    const { frequentlyRequested } = await service.getReports('ph_1');

    expect(names(frequentlyRequested)).toEqual(['Medicine B', 'Medicine A', 'Medicine C']);
  });

  it('does not follow inventory order', async () => {
    // Inventory order is Dolo, Paracetamol, Limcee; demand says otherwise.
    const { service } = buildService({
      searches: { med_dolo: 1, med_para: 2, med_limcee: 3 },
    });

    expect(names((await service.getReports('ph_1')).frequentlyRequested)).toEqual([
      'Limcee',
      'Paracetamol',
      'Dolo 650',
    ]);
  });

  it('breaks a tie by name, so the order is stable between loads', async () => {
    const { service } = buildService({ searches: { med_para: 7, med_limcee: 7 } });

    expect(names((await service.getReports('ph_1')).frequentlyRequested)).toEqual([
      'Limcee',
      'Paracetamol',
    ]);
  });

  it('keeps the existing top-five limit', async () => {
    const stock = Array.from({ length: 9 }, (_, i) => ({
      medicineId: `med_${i}`,
      medicine: { canonicalName: `Medicine ${i}` },
    }));
    const searches = Object.fromEntries(stock.map((s, i) => [s.medicineId, i + 1]));
    const { service } = buildService({ stock, searches });

    const { frequentlyRequested } = await service.getReports('ph_1');

    expect(frequentlyRequested).toHaveLength(5);
    expect(frequentlyRequested[0].requests).toBe(9);
  });
});

describe('nothing is invented to fill the card', () => {
  it('returns an empty list when nothing has been searched', async () => {
    // The page then shows its existing "No medicine requests recorded" state.
    const { service } = buildService({ searches: {} });

    expect((await service.getReports('ph_1')).frequentlyRequested).toEqual([]);
  });

  it('leaves out stocked medicines nobody searched for', async () => {
    const { service } = buildService({ searches: { med_dolo: 4 } });

    const { frequentlyRequested } = await service.getReports('ph_1');

    expect(frequentlyRequested).toHaveLength(1);
    expect(frequentlyRequested.every((m) => m.requests > 0)).toBe(true);
  });

  it('shows two when only two qualify, rather than padding to five', async () => {
    const { service } = buildService({ searches: { med_dolo: 9, med_limcee: 2 } });

    expect((await service.getReports('ph_1')).frequentlyRequested).toHaveLength(2);
  });

  it('returns nothing at all for a pharmacy with no inventory', async () => {
    const { service, prisma } = buildService({ stock: [], searches: { med_dolo: 30 } });

    expect((await service.getReports('ph_1')).frequentlyRequested).toEqual([]);
    // And does not go to the database for demand it could not attribute.
    expect(prisma.signalEvent.groupBy).not.toHaveBeenCalled();
  });
});
