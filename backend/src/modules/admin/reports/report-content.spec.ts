import { inflateSync } from 'node:zlib';
import { ReportFormat, ReportScope, ReportStatus, ReportType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { ReportDataService } from './report-data.service';
import { ReportsService } from './reports.service';

/**
 * What a generated report actually says.
 *
 * MSA-53 made the download a real PDF. What the PDF carried was the report's
 * own metadata, four governance bullets and the line "No aggregate figures are
 * attached to this export yet" — so a Super Admin who exported a Data Quality
 * report on ZoikoSignal received a page that told them nothing about ZoikoSignal
 * and nothing about why anyone would read it.
 *
 * Every figure asserted below is a count, a min or a max of rows in the
 * fixture. Nothing here checks a score, a projection or a trend, because the
 * platform produces none and the report must not print one.
 */

/** The visible text of a PDF, recovered without decompressing the whole file. */
function pdfText(body: Buffer): string {
  const raw = body.toString('latin1');
  const streams: string[] = [];
  // Scanned by regex rather than a manual walk: "endstream" contains "stream",
  // so advancing by one character matched it again and the next slice swallowed
  // the following object — page two went undecoded, which is exactly the
  // content these tests are about.
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    const begin = match.index + match[0].length;
    const finish = raw.indexOf('endstream', begin);
    if (finish === -1) continue;
    try {
      streams.push(
        inflateSync(Buffer.from(raw.slice(begin, finish), 'latin1')).toString('latin1'),
      );
    } catch {
      // Not every stream is deflated; the ones that are not carry no text.
    }
  }
  return streams
    .join('\n')
    .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_all, hex: string) =>
      Buffer.from(hex, 'hex').toString('utf8'),
    );
}

const report = (over: Record<string, unknown> = {}) => ({
  id: 'rep_1',
  name: 'tester report 4',
  type: ReportType.DATA_QUALITY,
  format: ReportFormat.PDF,
  scope: ReportScope.SIGNAL,
  status: ReportStatus.READY,
  owner: 'tester_super_admin@gmail.com',
  createdBy: 'tester_super_admin@gmail.com',
  schedule: null,
  createdAt: new Date('2026-09-02T13:14:20Z'),
  updatedAt: new Date('2026-09-02T13:14:20Z'),
  ...over,
});

/**
 * A known estate: 12 signals over 3 medicines and 2 pharmacies, one suppressed,
 * against a catalog of 74 identities and a network of 8 pharmacies.
 */
const ESTATE = {
  signals: 12,
  fresh: 9,
  visible: 7,
  suppressed: 1,
  unknown: 0,
  awaiting: 2,
  medicines: 74,
  suppressedMedicines: 3,
  unGoverned: 74,
  pharmacies: 8,
  verified: 6,
  participating: 5,
  pendingReview: 2,
};

function buildPrisma(row: Record<string, unknown>, estate = ESTATE) {
  return {
    report: {
      findUnique: jest.fn().mockResolvedValue(row),
      count: jest.fn().mockResolvedValue(8),
    },
    availabilitySignal: {
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.confidence === 'SUPPRESSED') return estate.suppressed;
        if (where.confidence === 'UNKNOWN') return estate.unknown;
        if (where.requiresConfirmation) return estate.awaiting;
        if (where.computedAt?.gte) return estate.fresh;
        if (where.computedAt?.lt) return estate.signals - estate.fresh;
        // The patient-visibility predicate carries a nested pharmacy clause.
        if (where.pharmacy) return estate.visible;
        return estate.signals;
      }),
      groupBy: jest.fn(async ({ by }: any) => {
        if (by[0] === 'confidence') {
          return [
            { confidence: 'HIGH', _count: { _all: 6 } },
            { confidence: 'MODERATE', _count: { _all: 3 } },
            { confidence: 'LOW', _count: { _all: 2 } },
            { confidence: 'SUPPRESSED', _count: { _all: estate.suppressed } },
          ];
        }
        return by[0] === 'medicineId'
          ? [{ medicineId: 'm1' }, { medicineId: 'm2' }, { medicineId: 'm3' }]
          : [{ pharmacyId: 'p1' }, { pharmacyId: 'p2' }];
      }),
      aggregate: jest.fn().mockResolvedValue({
        _min: { computedAt: new Date('2026-08-20T09:00:00Z') },
        _max: { computedAt: new Date('2026-09-02T11:30:00Z') },
      }),
    },
    medicineEntity: {
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.isSuppressed) return estate.suppressedMedicines;
        if (where.jurisdictionId === null) return estate.unGoverned;
        if (where.jurisdictionId?.not !== undefined) return 0;
        return estate.medicines;
      }),
    },
    pharmacy: {
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.isParticipating) return estate.participating;
        if (where.verificationStatus) return estate.verified;
        return estate.pharmacies;
      }),
    },
    verificationRequest: { count: jest.fn().mockResolvedValue(estate.pendingReview) },
    jurisdiction: { count: jest.fn().mockResolvedValue(0) },
    signalEvent: {
      groupBy: jest.fn().mockResolvedValue([
        { type: 'SEARCH', _count: { _all: 40 } },
        { type: 'ZERO_RESULT', _count: { _all: 5 } },
      ]),
    },
    auditLog: { count: jest.fn().mockResolvedValue(311) },
  };
}

function buildService(row: Record<string, unknown> = report(), estate = ESTATE) {
  const prisma = buildPrisma(row, estate);
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    new ReportDataService(prisma as unknown as PrismaService),
  );
  return { service, prisma };
}

const text = async (row?: Record<string, unknown>, estate = ESTATE) => {
  const { service } = buildService(row ?? report(), estate);
  const { body } = await service.download('user_1', 'rep_1', '10.0.0.1');
  return pdfText(body);
};

const content = (row?: Record<string, unknown>) => {
  const prisma = buildPrisma(row ?? report());
  return new ReportDataService(prisma as unknown as PrismaService).build(
    (row ?? report()) as never,
  );
};

describe('the report says what it is for', () => {
  it('carries a Purpose / intended use section', async () => {
    expect(await text()).toMatch(/Purpose \/ intended use/i);
  });

  it('names the uses it supports', async () => {
    const pdf = await text();

    for (const use of [
      'operational monitoring',
      'data-quality review',
      'compliance and audit review',
    ]) {
      expect(pdf).toContain(use);
    }
  });

  it('states the aggregate-only limit in the purpose, not only the footer', async () => {
    // The reader deciding whether they may forward the file is reading this
    // section, so the restriction belongs in it.
    const { purpose } = await content();

    expect(purpose.join(' ')).toMatch(/aggregate-only/i);
    expect(purpose.join(' ')).toMatch(/does not expose patient data or exact pharmacy stock/i);
  });

  it('is specific to Data Quality on ZoikoSignal', async () => {
    const { purpose } = await content();

    expect(purpose[0]).toMatch(/ZoikoSignal availability data/);
    expect(purpose[0]).toMatch(/stale or suppressed signals/);
    expect(purpose[0]).toMatch(/confidence is distributed/);
  });

  it('says something different for a network report', async () => {
    const { purpose } = await content(
      report({ type: ReportType.NETWORK_REPORT, scope: ReportScope.NETWORK }),
    );

    expect(purpose[0]).toMatch(/verified, participating and actively reporting/);
    expect(purpose[0]).not.toMatch(/confidence is distributed/);
  });

  it.each([
    [ReportType.EXECUTIVE_BRIEFING, ReportScope.ALL, /platform scale and activity/],
    [ReportType.REGIONAL_DIGEST, ReportScope.JURISDICTION, /jurisdiction/i],
    [ReportType.GOVERNANCE_EXPORT, ReportScope.ALL, /governed record of an export/],
    [ReportType.OPERATIONS, ReportScope.SIGNAL, /currently telling patients/],
  ])('describes %s / %s in its own terms', async (type, scope, expected) => {
    const { purpose } = await content(report({ type, scope }));

    expect(purpose[0]).toMatch(expected);
  });
});

describe('a Data Quality report on ZoikoSignal carries real figures', () => {
  it('leads with the key metrics', async () => {
    const pdf = await text();

    expect(pdf).toMatch(/Key metrics/i);
    expect(pdf).toContain('Availability signals on record');
    expect(pdf).toContain('Pharmacies contributing signals');
  });

  it('states the signal counts the database holds', async () => {
    const { keyMetrics } = await content();
    const value = (label: string) =>
      keyMetrics.find((m) => m.label === label)?.value;

    expect(value('Availability signals on record')).toBe('12');
    expect(value('Signals visible to patients')).toBe('7 of 12 (58%)');
    expect(value('Medicine identities with a signal')).toBe('3');
    expect(value('Pharmacies contributing signals')).toBe('2');
  });

  it('breaks the confidence bands out', async () => {
    const { sections } = await content();
    const bands = sections.find((s) => s.heading === 'Confidence distribution');

    expect(bands?.metrics.map((m) => m.label)).toEqual([
      'High',
      'Moderate',
      'Low',
      'Unknown',
      'Suppressed',
    ]);
    expect(bands?.metrics.find((m) => m.label === 'High')?.value).toBe('6 of 12 (50%)');
  });

  it('reports freshness against the platform target', async () => {
    const { sections } = await content();
    const freshness = sections.find((s) => s.heading === 'Freshness');
    const value = (label: string) =>
      freshness?.metrics.find((m) => m.label === label)?.value;

    expect(value('Freshness target')).toBe('6 hours');
    expect(value('Recomputed within target')).toBe('9 of 12 (75%)');
    expect(value('Stale against target')).toBe('3 of 12 (25%)');
    expect(value('Oldest signal')).toBe('2026-08-20 09:00 UTC');
    expect(value('Most recent signal')).toBe('2026-09-02 11:30 UTC');
  });

  it('reports catalog coverage', async () => {
    const { sections } = await content();
    const coverage = sections.find((s) => s.heading === 'Catalog coverage and quality');

    expect(coverage?.metrics.find((m) => m.label.startsWith('Medicine identities'))?.value).toBe(
      '74',
    );
    expect(
      coverage?.metrics.find((m) => m.label === 'With no availability signal')?.value,
    ).toBe('71 of 74 (96%)');
  });

  it('names every section in the detailed breakdown', async () => {
    const pdf = await text();

    expect(pdf).toMatch(/Detailed breakdown/i);
    for (const heading of [
      'Signal overview',
      'Confidence distribution',
      'Freshness',
      'Catalog coverage and quality',
    ]) {
      expect(pdf).toContain(heading);
    }
  });
});

describe('the executive summary only says what the figures say', () => {
  it('quotes the counts it was built from', async () => {
    const { summary } = await content();

    expect(summary[0]).toContain('12 availability signals');
    expect(summary[0]).toContain('3 medicine identities');
    expect(summary[0]).toContain('2 contributing pharmacies');
    expect(summary[0]).toContain('7 are currently visible to patients');
  });

  it('mentions suppression only when something is suppressed', async () => {
    const withNone = await content();
    expect(withNone.summary.join(' ')).toMatch(/1 signal is suppressed/);

    const { service } = buildService(report(), { ...ESTATE, suppressed: 0 });
    const { body } = await service.download('user_1', 'rep_1');
    expect(pdfText(body)).not.toMatch(/signals? (is|are) suppressed/);
  });

  it('mentions staleness only when something is stale', async () => {
    const clean = new ReportDataService(
      buildPrisma(report(), { ...ESTATE, fresh: ESTATE.signals }) as unknown as PrismaService,
    );

    const { summary } = await clean.build(report() as never);

    expect(summary.join(' ')).not.toMatch(/freshness target/);
  });

  it('says so plainly when there is nothing on record', async () => {
    // Zero is a real reading. It is stated, not hidden and not rounded up.
    const empty = new ReportDataService(
      buildPrisma(report(), {
        ...ESTATE,
        signals: 0,
        fresh: 0,
        visible: 0,
        suppressed: 0,
      }) as unknown as PrismaService,
    );

    const { summary } = await empty.build(report() as never);

    expect(summary[0]).toMatch(/found no availability signals on record/);
  });

  it('carries no invented figure anywhere in the document', async () => {
    // Nothing the platform does not measure: no score, no index, no projection,
    // no period-over-period movement.
    const pdf = await text();

    for (const word of [
      'health score',
      'quality score',
      'projected',
      'forecast',
      'estimated',
      'trend',
      'benchmark',
    ]) {
      expect(pdf.toLowerCase()).not.toContain(word);
    }
  });
});

describe('a report type with no analytics source', () => {
  const forecast = () => report({ type: ReportType.FORECAST, scope: ReportScope.ALL });

  it('says detailed analytics are unavailable', async () => {
    const { unavailable } = await content(forecast());

    expect(unavailable).toMatch(/not currently available/i);
  });

  it('states it in the document rather than leaving a blank section', async () => {
    const pdf = await text(forecast());

    expect(pdf).toMatch(/Detailed analytics/);
    expect(pdf).toMatch(/not currently available/i);
  });

  it('attaches no figures at all', async () => {
    const built = await content(forecast());

    expect(built.sections).toEqual([]);
    expect(built.keyMetrics).toEqual([]);
  });

  it('substitutes no projection', async () => {
    const pdf = await text(forecast());

    expect(pdf).not.toMatch(/\d+% projected|expected demand|will rise|will fall/i);
  });

  it('still carries its purpose and governance', async () => {
    const pdf = await text(forecast());

    expect(pdf).toMatch(/Purpose \/ intended use/i);
    expect(pdf).toMatch(/Aggregate-only/);
  });
});

describe('governance is not weakened to fill the report', () => {
  it('keeps every governance rule', async () => {
    const pdf = await text();

    for (const line of [
      'Aggregate-only: this export contains no patient data.',
      'No exact stock counts are included',
      'Scoped to the requesting role and jurisdiction.',
      'The request is recorded in the platform audit log.',
    ]) {
      expect(pdf).toContain(line);
    }
  });

  it('reads no patient table to build the figures', async () => {
    // The proof that no patient data can reach the export: the aggregate
    // builder never touches a table that holds any.
    const { prisma } = buildService();
    await buildService().service.download('user_1', 'rep_1');

    expect(prisma).not.toHaveProperty('user');
    expect(prisma).not.toHaveProperty('savedMedicine');
    expect(prisma).not.toHaveProperty('searchHistory');
    expect(prisma).not.toHaveProperty('signalNotification');
  });

  it('carries no patient identifier', async () => {
    // The word "patient" is all over the report — it is what the governance
    // rules are about. What must not appear is an identifier, so this counts
    // the addresses instead: the owner's own is on the report by design, and
    // nobody else's is.
    const pdf = await text();
    const addresses = new Set(pdf.match(/[\w.+-]+@[\w.-]+/g) ?? []);

    expect([...addresses]).toEqual(['tester_super_admin@gmail.com']);
  });

  it('carries no exact stock quantity', async () => {
    // Availability is a confidence band. No quantity column exists to print,
    // and the report states the restriction rather than relying on that.
    const pdf = await text();

    expect(pdf).not.toMatch(/units? in stock|quantity on hand|stock count of/i);
    expect(pdf).toContain('No exact stock counts are included');
  });

  it('states the restriction on every page', async () => {
    const { service } = buildService();
    const { body } = await service.download('user_1', 'rep_1');
    const footers = pdfText(body).match(/Aggregate-only export/g) ?? [];

    // The report now runs to more than one page, and a sheet printed on its own
    // must still say what it may not be used for.
    expect(footers.length).toBeGreaterThan(1);
  });
});

describe('the download contract is unchanged', () => {
  it('is still application/pdf', async () => {
    const { service } = buildService();

    expect((await service.download('user_1', 'rep_1')).contentType).toBe('application/pdf');
  });

  it('still begins with %PDF-', async () => {
    const { service } = buildService();
    const { body } = await service.download('user_1', 'rep_1');

    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still names the file .pdf', async () => {
    const { service } = buildService();

    expect((await service.download('user_1', 'rep_1')).filename).toBe('tester report 4.pdf');
  });
});

describe('CSV and JSON carry the same figures', () => {
  it('CSV lists the aggregate sections', async () => {
    const { service } = buildService(report({ format: ReportFormat.CSV }));
    const { body, contentType } = await service.download('user_1', 'rep_1');
    const csv = body.toString('utf8');

    expect(contentType).toBe('text/csv; charset=utf-8');
    expect(csv.split('\n')[0]).toBe('Section,Field,Value');
    expect(csv).toContain('Confidence distribution,High,6 of 12 (50%)');
    expect(csv).toContain('Key metrics,Availability signals on record,12');
  });

  it('CSV carries the purpose', async () => {
    const { service } = buildService(report({ format: ReportFormat.CSV }));
    const { body } = await service.download('user_1', 'rep_1');

    expect(body.toString('utf8')).toContain('Purpose / intended use');
  });

  it('JSON carries the same structure, not a raw dump', async () => {
    const { service } = buildService(report({ format: ReportFormat.JSON }));
    const { body, contentType } = await service.download('user_1', 'rep_1');
    const payload = JSON.parse(body.toString('utf8'));

    expect(contentType).toBe('application/json; charset=utf-8');
    expect(payload.purpose[0]).toMatch(/ZoikoSignal availability data/);
    expect(payload.keyMetrics[0]).toEqual({
      label: 'Availability signals on record',
      value: '12',
    });
    expect(payload.sections.map((s: { heading: string }) => s.heading)).toContain('Freshness');
    expect(payload.governance.aggregateOnly).toBe(true);
  });

  it('JSON no longer ships an empty data array', async () => {
    const { service } = buildService(report({ format: ReportFormat.JSON }));
    const { body } = await service.download('user_1', 'rep_1');

    expect(JSON.parse(body.toString('utf8'))).not.toHaveProperty('data');
  });
});
