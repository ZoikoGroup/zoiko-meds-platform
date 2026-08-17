import { DashboardOverviewService } from './dashboard-overview.service';

/**
 * The Super Admin dashboard rollup.
 *
 * The contract under test is that a metric is reported only when it was
 * measured. Four of the ten KPI cards, and six of the ten charts, have no
 * source in this schema; each must come back as a declared gap carrying the
 * reason, never as a zero or a plausible number that reads as measured.
 */

function buildService(over: Record<string, any> = {}) {
  const counts = {
    pharmacy: 13,
    pharmacyVerified: 11,
    verificationRequest: 1,
    user: 9,
    medicineEntity: 54,
    jurisdiction: 0,
    searchToday: 47,
    searchYesterday: 40,
    availabilityFresh: 2,
    availabilityTotal: 98,
    confirmation: 0,
    restock: 0,
    atcClassified: 5,
    ...over,
  };

  const prisma: any = {
    pharmacy: {
      count: jest.fn(({ where } = {} as any) =>
        Promise.resolve(where?.verificationStatus ? counts.pharmacyVerified : counts.pharmacy),
      ),
    },
    verificationRequest: { count: jest.fn().mockResolvedValue(counts.verificationRequest) },
    user: { count: jest.fn().mockResolvedValue(counts.user) },
    medicineEntity: {
      count: jest.fn(({ where } = {} as any) =>
        Promise.resolve(where?.NOT ? counts.atcClassified : counts.medicineEntity),
      ),
    },
    jurisdiction: { count: jest.fn().mockResolvedValue(counts.jurisdiction) },
    searchHistory: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where?.createdAt?.lt ? counts.searchYesterday : counts.searchToday),
      ),
    },
    availabilitySignal: {
      count: jest.fn(({ where } = {} as any) =>
        Promise.resolve(where?.computedAt ? counts.availabilityFresh : counts.availabilityTotal),
      ),
      groupBy: jest.fn().mockResolvedValue(
        over.confidenceRows ?? [
          { confidence: 'HIGH', _count: { _all: 72 } },
          { confidence: 'MODERATE', _count: { _all: 23 } },
          { confidence: 'LOW', _count: { _all: 2 } },
          { confidence: 'UNKNOWN', _count: { _all: 1 } },
        ],
      ),
    },
    signalEvent: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where.type === 'CONFIRMATION' ? counts.confirmation : counts.restock),
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue(over.rawRows ?? []),
    $queryRawUnsafe: jest.fn().mockResolvedValue(over.cumulativeRows ?? []),
  };

  return { service: new DashboardOverviewService(prisma as never), prisma };
}

describe('dashboard rollup reports only what it measured', () => {
  it('returns the live entity counts', async () => {
    const { service } = buildService();
    const o = await service.overview();

    expect(o.kpis.totalPharmacies.value).toBe(13);
    expect(o.kpis.verifiedPharmacies.value).toBe(11);
    expect(o.kpis.pendingVerifications.value).toBe(1);
    expect(o.kpis.activeUsers.value).toBe(9);
    expect(o.kpis.totalMedicines.value).toBe(54);
  });

  it('reports regions live from the Jurisdiction table, zero included', async () => {
    const { service } = buildService();
    // The seeded dashboard claimed "148 regions live" against an empty table.
    expect((await service.overview()).regionsLive).toBe(0);

    const { service: populated } = buildService({ jurisdiction: 12 });
    expect((await populated.overview()).regionsLive).toBe(12);
  });

  it('computes the verified share from the two live counts', async () => {
    const { service } = buildService();
    expect((await service.overview()).kpis.verifiedPharmacies.shareOfTotal).toBe(85);
  });

  it('measures searches today against yesterday', async () => {
    const { service } = buildService();
    const s = (await service.overview()).kpis.searchesToday;
    expect(s.value).toBe(47);
    expect(s.previous).toBe(40);
    expect(s.changePct).toBe(17.5);
  });

  it('returns no percentage change when yesterday has no baseline', async () => {
    const { service } = buildService({ searchYesterday: 0 });
    expect((await service.overview()).kpis.searchesToday.changePct).toBeNull();
  });

  it.each([
    ['apiRequestsToday', 'telemetry'],
    ['systemHealth', 'uptime'],
    ['activeIntegrations', 'integration'],
  ])('declares %s unmeasurable with a reason', async (key, wordInReason) => {
    const { service } = buildService();
    const metric = (await service.overview()).kpis[key as 'systemHealth'];

    expect(metric.available).toBe(false);
    expect(metric.reason.toLowerCase()).toContain(wordInReason);
    // The gap says what would be needed, so the report writes itself.
    expect(metric.requires).toMatch(/\w/);
  });

  it('declares the confirmation rate unmeasurable while no events exist', async () => {
    const { service } = buildService();
    const rate = (await service.overview()).kpis.confirmationRate;
    expect('available' in rate && rate.available).toBe(false);
  });

  it('computes the confirmation rate once events are recorded', async () => {
    const { service } = buildService({ confirmation: 41, restock: 9 });
    const rate = (await service.overview()).kpis.confirmationRate as { value: number; sample: number };
    expect(rate.value).toBe(82);
    expect(rate.sample).toBe(50);
  });

  it('bands the live confidence mix, folding SUPPRESSED into unknown', async () => {
    const { service } = buildService({
      confidenceRows: [
        { confidence: 'HIGH', _count: { _all: 5 } },
        { confidence: 'UNKNOWN', _count: { _all: 2 } },
        { confidence: 'SUPPRESSED', _count: { _all: 3 } },
      ],
    });
    const c = (await service.overview()).confidence;
    expect(c).toEqual({ high: 5, moderate: 0, low: 0, unknown: 5, total: 10 });
  });

  it('reports freshness as a share of signals inside the SLA', async () => {
    const { service } = buildService();
    expect((await service.overview()).freshness).toMatchObject({
      slaHours: 6,
      withinSla: 2,
      total: 98,
      pct: 2,
    });
  });

  it('survives an entirely empty database without dividing by zero', async () => {
    const { service } = buildService({
      pharmacy: 0, pharmacyVerified: 0, verificationRequest: 0, user: 0,
      medicineEntity: 0, jurisdiction: 0, searchToday: 0, searchYesterday: 0,
      availabilityFresh: 0, availabilityTotal: 0, atcClassified: 0, confidenceRows: [],
    });
    const o = await service.overview();

    expect(o.kpis.verifiedPharmacies.shareOfTotal).toBe(0);
    expect(o.freshness.pct).toBe(0);
    expect(o.confidence).toEqual({ high: 0, moderate: 0, low: 0, unknown: 0, total: 0 });
    expect(o.categories.items).toEqual([]);
    expect(o.shortage).toEqual([]);
  });

  it('declares every chart it cannot source, with a reason and a requirement', async () => {
    const { service } = buildService();
    const gaps = (await service.overview()).unavailable;

    expect(Object.keys(gaps).sort()).toEqual([
      'apiUsage',
      'availabilityMap',
      'availabilityTrend',
      'jurisdictionComparison',
      'partnerParticipation',
      'regionalRisk',
      'signalFreshnessTimeline',
      'weeklyActiveUsers',
    ]);
    for (const g of Object.values(gaps)) {
      expect(g.available).toBe(false);
      expect(g.reason).toMatch(/\w/);
      expect(g.requires).toMatch(/\w/);
    }
  });

  it('buckets daily series on UTC days, matching how Prisma stores timestamps', async () => {
    const { service, prisma } = buildService();
    await service.overview();

    // The cumulative sparkline is bounded by explicit UTC date strings rather
    // than CURRENT_DATE, which previously drifted the series by the server's
    // offset and produced a 13th point.
    const [, from, to] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
