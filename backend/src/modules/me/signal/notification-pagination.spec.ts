import { SignalNotificationType } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * One page of notifications at a time.
 *
 * ZoikoSignal regenerates a patient's notifications on every read and returned
 * every one of them, so an account with a hundred-odd rows was answered with a
 * hundred-odd rows and the page rendered all of them in one column. Reaching
 * anything older than the last few meant scrolling past everything newer.
 *
 * Two things have to hold at once for a paginated list with filter chips above
 * it, and they pull in opposite directions: the rows are a slice, and the
 * counts are not. "Safety Alerts 107" describes the whole set, so a client that
 * counted what it had been handed would label every chip ten or fewer. The page
 * and the totals therefore come back together, from the same clauses.
 *
 * The in-memory table below honours where / orderBy / skip / take / count /
 * groupBy, because the arithmetic under test is exactly which rows a skip and a
 * take select — a stub returning a fixed array could not tell a correct page
 * from an off-by-one.
 */

const USER = 'user_1';

type Row = Record<string, any>;

let seq = 0;

/**
 * A notification row.
 *
 * `occurredAt` defaults to one shared instant on purpose: a regeneration pass
 * stamps a batch together, and the reported page was full of rows reading "just
 * now". Ties are the normal case here rather than the edge case.
 */
const notification = (type: SignalNotificationType, over: Row = {}): Row => ({
  id: `n_${String(++seq).padStart(3, '0')}`,
  userId: USER,
  type,
  medicineName: 'Dolo 650',
  title: `${type} title`,
  description: 'description',
  occurredAt: new Date('2026-09-09T10:00:00Z'),
  actionLabel: 'Find pharmacy',
  actionKind: 'search',
  actionQuery: 'Dolo 650',
  read: false,
  archived: false,
  dismissed: false,
  ...over,
});

function buildService(rows: Row[]) {
  const table = rows.map((r) => ({ ...r }));

  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([field, clause]) => {
      if (clause !== null && typeof clause === 'object' && !(clause instanceof Date)) {
        const { in: allowed } = clause as { in?: unknown[] };
        if (!Array.isArray(allowed)) {
          throw new Error(`Unsupported clause on ${field}: ${JSON.stringify(clause)}`);
        }
        return allowed.includes(row[field]);
      }
      return row[field] === clause;
    });

  /** Sort by the service's own orderBy list, so the tiebreaker is exercised. */
  const sorted = (found: Row[], orderBy: Row[] = []) =>
    [...found].sort((a, b) => {
      for (const clause of orderBy) {
        const [field, dir] = Object.entries(clause)[0] as [string, string];
        const av = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
        if (av === bv) continue;
        const cmp = av > bv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });

  const prisma = {
    signalNotification: {
      findMany: jest.fn(async ({ where, orderBy, skip, take }: Row = {}) => {
        const found = sorted(
          table.filter((r) => matches(r, where)),
          orderBy,
        );
        const from = skip ?? 0;
        const slice = take === undefined ? found.slice(from) : found.slice(from, from + take);
        return slice.map((r) => ({ ...r }));
      }),
      count: jest.fn(async ({ where }: Row = {}) => table.filter((r) => matches(r, where)).length),
      groupBy: jest.fn(async ({ by, where }: Row = {}) => {
        const field = by[0];
        const tally = new Map<unknown, number>();
        for (const row of table.filter((r) => matches(r, where))) {
          tally.set(row[field], (tally.get(row[field]) ?? 0) + 1);
        }
        return [...tally].map(([value, n]) => ({ [field]: value, _count: { _all: n } }));
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    // Regeneration finds nothing to do: these cases are about reading a set
    // that already exists, not about producing one.
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    signalNotificationPreference: {
      upsert: jest.fn().mockResolvedValue({
        userId: USER,
        runningLow: true,
        backInStock: true,
        nearbyRestock: true,
        recall: true,
        safety: true,
        push: true,
        email: false,
        sms: false,
      }),
    },
  };

  const service = new PatientSignalService(prisma as never, {
    resolveOrigin: jest.fn().mockResolvedValue(null),
  } as never);
  return { service, prisma };
}

/** 25 running-low, 4 back-in-stock, 3 safety, 2 recall, 1 read limited — 35. */
const manyRows = () => [
  ...Array.from({ length: 25 }, () => notification(SignalNotificationType.RUNNING_LOW)),
  ...Array.from({ length: 4 }, () => notification(SignalNotificationType.BACK_IN_STOCK)),
  ...Array.from({ length: 3 }, () => notification(SignalNotificationType.SAFETY)),
  ...Array.from({ length: 2 }, () => notification(SignalNotificationType.RECALL)),
  notification(SignalNotificationType.LIMITED, { read: true }),
];

beforeEach(() => {
  seq = 0;
});

describe('the endpoint every other caller already uses', () => {
  it('still answers a query-less read with the whole list, as an array', async () => {
    // The nav badge and the patient notifications page read this shape. Adding
    // pagination must not widen what they receive.
    const { service } = buildService(manyRows());

    const result = await service.listNotifications(USER);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(35);
  });

  it('orders that list the same way the paged one does', async () => {
    const { service, prisma } = buildService(manyRows());

    await service.listNotifications(USER);
    const [args] = prisma.signalNotification.findMany.mock.calls.at(-1) as [Row];

    expect(args.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('a page of notifications', () => {
  it('returns ten rows by default', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 1 });

    expect(res.items).toHaveLength(10);
    expect(res.pageSize).toBe(10);
    expect(res.page).toBe(1);
  });

  it('reports how many pages there are', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 1 });

    // 35 rows, ten at a time.
    expect(res.total).toBe(35);
    expect(res.pageCount).toBe(4);
  });

  it('honours a page size the caller asks for', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 1, pageSize: 5 });

    expect(res.items).toHaveLength(5);
    expect(res.pageCount).toBe(7);
  });

  it('leaves the last page short rather than padding it', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 4 });

    expect(res.items).toHaveLength(5);
  });

  it('answers a page past the end with the last one', async () => {
    // Deleting the only row on the final page would otherwise leave the client
    // asking for a page that no longer exists and being shown nothing.
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 99 });

    expect(res.page).toBe(4);
    expect(res.items).toHaveLength(5);
  });

  it('is one page when there is nothing at all', async () => {
    const { service } = buildService([]);

    const res: any = await service.listNotifications(USER, { page: 1 });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.pageCount).toBe(1);
  });
});

describe('paging through the whole set loses and repeats nothing', () => {
  const idsAcrossPages = async (pageSize: number) => {
    const { service } = buildService(manyRows());
    const seen: string[] = [];
    const first: any = await service.listNotifications(USER, { page: 1, pageSize });
    for (let page = 1; page <= first.pageCount; page += 1) {
      const res: any = await service.listNotifications(USER, { page, pageSize });
      seen.push(...res.items.map((n: any) => n.id));
    }
    return seen;
  };

  it('visits every notification exactly once', async () => {
    // The property that matters most, and the one a missing tiebreaker puts at
    // risk: every row in this fixture shares one occurredAt.
    const ids = await idsAcrossPages(10);

    expect(ids).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
  });

  it('holds at a page size that does not divide the total', async () => {
    const ids = await idsAcrossPages(4);

    expect(new Set(ids).size).toBe(35);
  });

  it('breaks ties on id, so two reads of one page agree', async () => {
    const { service } = buildService(manyRows());

    const first: any = await service.listNotifications(USER, { page: 2 });
    const again: any = await service.listNotifications(USER, { page: 2 });

    expect(again.items.map((n: any) => n.id)).toEqual(first.items.map((n: any) => n.id));
  });
});

describe('the counts describe the whole set, not the page', () => {
  it('counts every chip over all of it', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { page: 1 });

    expect(res.counts).toEqual({
      all: 35,
      unread: 34,
      'running-low': 25,
      'back-in-stock': 4,
      safety: 5,
    });
  });

  it('reports the same counts on every page', async () => {
    const { service } = buildService(manyRows());

    const first: any = await service.listNotifications(USER, { page: 1 });
    const last: any = await service.listNotifications(USER, { page: 4 });

    expect(last.counts).toEqual(first.counts);
  });

  it('counts a type with no chip of its own under All only', async () => {
    // `limited` and `nearby-restock` have no chip. They are still notifications
    // and must still be reachable, which means All has to include them.
    const { service } = buildService([
      notification(SignalNotificationType.LIMITED),
      notification(SignalNotificationType.NEARBY_RESTOCK),
    ]);

    const res: any = await service.listNotifications(USER, { page: 1 });

    expect(res.counts.all).toBe(2);
    expect(res.counts['running-low']).toBe(0);
    expect(res.counts['back-in-stock']).toBe(0);
    expect(res.counts.safety).toBe(0);
    expect(res.items).toHaveLength(2);
  });

  it('excludes archived and dismissed rows from the counts as well as the page', async () => {
    const { service } = buildService([
      notification(SignalNotificationType.RUNNING_LOW),
      notification(SignalNotificationType.RUNNING_LOW, { archived: true }),
      notification(SignalNotificationType.RUNNING_LOW, { dismissed: true }),
    ]);

    const res: any = await service.listNotifications(USER, { page: 1 });

    expect(res.counts.all).toBe(1);
    expect(res.items).toHaveLength(1);
  });
});

describe('a filter selects the rows and its own total', () => {
  it('returns only the filtered type', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'back-in-stock' });

    expect(res.items).toHaveLength(4);
    expect(res.items.every((n: any) => n.type === 'back-in-stock')).toBe(true);
  });

  it('paginates the filtered set, not the whole one', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'back-in-stock' });

    expect(res.total).toBe(4);
    expect(res.pageCount).toBe(1);
  });

  it('keeps the chip counts global while it does so', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'back-in-stock' });

    expect(res.counts.all).toBe(35);
    expect(res.counts['running-low']).toBe(25);
  });

  it('gathers a recall and a safety advisory under Safety Alerts', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'safety' });

    expect(res.items).toHaveLength(5);
    expect(res.items.map((n: any) => n.type).sort()).toEqual([
      'recall',
      'recall',
      'safety',
      'safety',
      'safety',
    ]);
  });

  it('returns only unread rows under Unread', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'unread', pageSize: 100 });

    expect(res.total).toBe(34);
    expect(res.items.every((n: any) => n.read === false)).toBe(true);
  });

  it('answers an empty filter with an empty page and a truthful zero', async () => {
    const { service } = buildService([notification(SignalNotificationType.RUNNING_LOW)]);

    const res: any = await service.listNotifications(USER, { filter: 'back-in-stock' });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.pageCount).toBe(1);
    // And the chip that does have something still says so.
    expect(res.counts['running-low']).toBe(1);
  });

  it('names the filter it applied, so a stale response is recognisable', async () => {
    const { service } = buildService(manyRows());

    const res: any = await service.listNotifications(USER, { filter: 'safety' });

    expect(res.filter).toBe('safety');
  });
});
