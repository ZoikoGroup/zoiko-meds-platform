import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { IntegrationDirection, IntegrationSyncStatus } from '@prisma/client';

// The feed guard resolves the host before dialling it, which is the whole point
// of the guard — and a real lookup here would make the suite depend on DNS and
// on example.com continuing to exist. The addresses are what is under test, so
// they are supplied directly; literal-IP cases below bypass this entirely.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]),
}));

import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { PharmacyService } from '../pharmacy.service';
import {
  hashApiKey,
  PharmacyIntegrationService,
  STALE_LOCK_MS,
} from './pharmacy-integration.service';
import { isPrivateAddress, parseFeedBody } from './feed';
import { open, seal } from '../../../common/secret-box';

/**
 * Pharmacy Portal → Integration.
 *
 * The page used to resolve a fixture: every pharmacy on the platform saw the
 * same connected Marg ERP and the same five invented sync runs. These tests
 * cover what replaced it — the properties that make the real thing trustworthy
 * rather than merely present.
 */

const integrationRow = (over: Record<string, unknown> = {}) => ({
  id: 'int_1',
  pharmacyId: 'ph_1',
  provider: 'Marg ERP',
  direction: IntegrationDirection.PULL,
  enabled: true,
  feedUrl: 'https://feeds.example.com/stock.csv',
  authHeaderName: 'Authorization',
  authHeaderSecret: seal('Bearer feed-secret'),
  syncMode: 'merge',
  intervalMinutes: 60,
  apiKeyHash: null,
  apiKeyPrefix: null,
  apiKeyIssuedAt: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  nextSyncAt: null,
  syncingSince: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function build(over: Record<string, unknown> = {}) {
  const prisma = {
    pharmacyIntegration: {
      findUnique: jest.fn().mockResolvedValue(integrationRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ create, update }) =>
        Promise.resolve(integrationRow(update ?? create)),
      ),
      update: jest.fn().mockResolvedValue(integrationRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue(integrationRow()),
    },
    pharmacySyncRun: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    ...over,
  };

  const pharmacy = {
    importCsv: jest.fn().mockResolvedValue({
      imported: 3,
      updated: 1,
      skipped: 0,
      totalProcessed: 4,
      mode: 'merge',
    }),
  };

  const audit = { write: jest.fn().mockResolvedValue(undefined) };

  const service = new PharmacyIntegrationService(
    prisma as unknown as PrismaService,
    pharmacy as unknown as PharmacyService,
    audit as unknown as AuditWriter,
  );

  return { service, prisma, pharmacy, audit };
}

describe('secret-box', () => {
  const previous = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'a-test-secret-long-enough-to-be-accepted';
  });
  afterAll(() => {
    process.env.JWT_SECRET = previous;
  });

  it('round-trips a feed credential', () => {
    expect(open(seal('Bearer abc123'))).toBe('Bearer abc123');
  });

  it('never stores the credential in the clear', () => {
    expect(seal('Bearer abc123')).not.toContain('abc123');
  });

  it('answers null for a tampered value rather than returning something else', () => {
    const sealed = seal('Bearer abc123');
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(open(tampered)).toBeNull();
  });
});

describe('feed guard', () => {
  // The feed URL is typed by an operator and dialled by the server. Without
  // this, "http://169.254.169.254/…" is a valid feed and its response comes
  // back through the sync history.
  it.each([
    ['127.0.0.1', 4],
    ['10.1.2.3', 4],
    ['172.16.0.1', 4],
    ['192.168.1.1', 4],
    ['169.254.169.254', 4],
    ['100.64.0.1', 4],
    ['::1', 6],
    ['fd00::1', 6],
    ['::ffff:127.0.0.1', 6],
  ])('rejects %s as a feed address', (address, family) => {
    expect(isPrivateAddress(address as string, family as number)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 4],
    ['203.0.113.10', 4],
    ['2606:4700::1111', 6],
  ])('allows the public address %s', (address, family) => {
    expect(isPrivateAddress(address as string, family as number)).toBe(false);
  });
});

describe('feed parsing', () => {
  it('reads a JSON array of rows', () => {
    const rows = parseFeedBody('[{"name":"Amoxicillin","status":"available"}]', 'application/json');
    expect(rows).toEqual([{ name: 'Amoxicillin', status: 'available' }]);
  });

  it('reads a JSON envelope with an items array', () => {
    const rows = parseFeedBody('{"items":[{"name":"Metformin"}]}', 'application/json');
    expect(rows).toEqual([{ name: 'Metformin' }]);
  });

  // A file server handing out text/plain for a .csv is the common case, so the
  // body decides the format, not the declared content type.
  it('reads CSV served as text/plain', () => {
    const rows = parseFeedBody('name,status\nAspirin,available', 'text/plain');
    expect(rows).toEqual([{ name: 'Aspirin', status: 'available' }]);
  });

  it('refuses a CSV with no name or medicineId column', () => {
    expect(() => parseFeedBody('sku,qty\nA1,4', 'text/csv')).toThrow(BadRequestException);
  });
});

describe('PharmacyIntegrationService.getIntegration', () => {
  it('reports an unconfigured pharmacy as disconnected, inventing no provider', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    const view = await service.getIntegration('ph_1');

    expect(view.connected).toBe(false);
    expect(view.provider).toBeNull();
    expect(view.history).toEqual([]);
  });

  it('never returns the feed credential, only whether one is set', async () => {
    const { service } = build();

    const view = await service.getIntegration('ph_1');

    expect(view.hasAuthHeader).toBe(true);
    expect(JSON.stringify(view)).not.toContain('feed-secret');
  });

  it('treats an expired lock as idle rather than leaving the feed wedged', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({ syncingSince: new Date(Date.now() - STALE_LOCK_MS - 1000) }),
    );

    expect((await service.getIntegration('ph_1')).syncing).toBe(false);
  });
});

describe('PharmacyIntegrationService.saveIntegration', () => {
  it('refuses a pull integration with no feed URL', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await expect(
      service.saveIntegration('ph_1', { provider: 'Marg ERP' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a feed URL inside a private network', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await expect(
      service.saveIntegration('ph_1', {
        provider: 'Marg ERP',
        feedUrl: 'http://127.0.0.1:8080/stock.csv',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an interval below the floor', async () => {
    const { service } = build();

    await expect(
      service.saveIntegration('ph_1', {
        provider: 'Marg ERP',
        feedUrl: 'https://feeds.example.com/stock.csv',
        intervalMinutes: 1,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a new integration with both auth header fields blank and stores no auth header', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: '',
      authHeaderValue: '',
    } as never);

    const { create } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(create.authHeaderName).toBeNull();
    expect(create.authHeaderSecret).toBeNull();
  });

  it('treats whitespace-only auth header name and value as absent', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: '   ',
      authHeaderValue: '   ',
    } as never);

    const { create } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(create.authHeaderName).toBeNull();
    expect(create.authHeaderSecret).toBeNull();
  });

  it('accepts Authorization header and Bearer token', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'Authorization',
      authHeaderValue: 'Bearer abc123',
    } as never);

    const { create } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(create.authHeaderName).toBe('Authorization');
    expect(open(create.authHeaderSecret)).toBe('Bearer abc123');
  });

  it('accepts custom X-API-Key header and value', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'X-API-Key',
      authHeaderValue: 'abc123',
    } as never);

    const { create } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(create.authHeaderName).toBe('X-API-Key');
    expect(open(create.authHeaderSecret)).toBe('abc123');
  });

  it('preserves exact secret value without trimming non-empty secret', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);
    const untrimmedSecret = 'Bearer  tokenWithSpaces ';

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'Authorization',
      authHeaderValue: untrimmedSecret,
    } as never);

    const { create } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(open(create.authHeaderSecret)).toBe(untrimmedSecret);
  });

  it('refuses a new integration with header name but missing value', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await expect(
      service.saveIntegration('ph_1', {
        provider: 'Marg ERP',
        feedUrl: 'https://feeds.example.com/stock.csv',
        authHeaderName: 'Authorization',
        authHeaderValue: '',
      } as never),
    ).rejects.toThrow(
      new BadRequestException(
        'Auth header value is required when an auth header name is provided.',
      ),
    );
  });

  it('refuses a request with header value but missing name', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(null);

    await expect(
      service.saveIntegration('ph_1', {
        provider: 'Marg ERP',
        feedUrl: 'https://feeds.example.com/stock.csv',
        authHeaderName: '',
        authHeaderValue: 'Bearer abc123',
      } as never),
    ).rejects.toThrow(
      new BadRequestException(
        'Auth header name is required when an auth header value is provided.',
      ),
    );
  });

  // Re-saving the form must retain the stored credential when the value is left blank.
  it('retains the stored credential when editing with the same header name and blank value', async () => {
    const { service, prisma } = build();

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'Authorization',
      authHeaderValue: '',
    } as never);

    const { update } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(update.authHeaderName).toBe('Authorization');
    expect(open(update.authHeaderSecret)).toBe('Bearer feed-secret');
  });

  it('refuses editing when header name changes but value is left blank', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({
        authHeaderName: 'Authorization',
        authHeaderSecret: seal('Bearer feed-secret'),
      }),
    );

    await expect(
      service.saveIntegration('ph_1', {
        provider: 'Marg ERP',
        feedUrl: 'https://feeds.example.com/stock.csv',
        authHeaderName: 'X-API-Key',
        authHeaderValue: '',
      } as never),
    ).rejects.toThrow(
      new BadRequestException(
        'Auth header value is required when changing the auth header name.',
      ),
    );
  });

  it('replaces auth header and secret when changing header name and supplying new value', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({
        authHeaderName: 'Authorization',
        authHeaderSecret: seal('Bearer feed-secret'),
      }),
    );

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'X-API-Key',
      authHeaderValue: 'new-key-123',
    } as never);

    const { update } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(update.authHeaderName).toBe('X-API-Key');
    expect(open(update.authHeaderSecret)).toBe('new-key-123');
  });

  // Shortening a daily feed to every 15 minutes and then waiting a day for the
  // first run reads as the setting having been ignored.
  it('re-measures the schedule from the last run when the interval changes', async () => {
    const { service, prisma } = build();
    const lastSyncAt = new Date(Date.now() - 30 * 60_000);
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({
        intervalMinutes: 1440,
        lastSyncAt,
        nextSyncAt: new Date(Date.now() + 23 * 60 * 60_000),
      }),
    );

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      intervalMinutes: 15,
    } as never);

    const { update } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    // 30 minutes since the last run, now on a 15-minute cycle: already due.
    expect(update.nextSyncAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('leaves the schedule alone when the interval is unchanged', async () => {
    const { service, prisma } = build();
    const nextSyncAt = new Date(Date.now() + 40 * 60_000);
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({ nextSyncAt }),
    );

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      intervalMinutes: 60,
    } as never);

    const { update } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(update.nextSyncAt).toEqual(nextSyncAt);
  });

  it('stops scheduling entirely while the integration is paused', async () => {
    const { service, prisma } = build();

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      enabled: false,
    } as never);

    const { update } = prisma.pharmacyIntegration.upsert.mock.calls[0][0];
    expect(update.nextSyncAt).toBeNull();
  });

  it('never writes the credential to the audit trail', async () => {
    const { service, audit } = build();

    await service.saveIntegration('ph_1', {
      provider: 'Marg ERP',
      feedUrl: 'https://feeds.example.com/stock.csv',
      authHeaderName: 'Authorization',
      authHeaderValue: 'Bearer feed-secret',
    } as never);

    expect(JSON.stringify(audit.write.mock.calls)).not.toContain('feed-secret');
  });
});

describe('PharmacyIntegrationService.syncNow', () => {
  it('refuses to pull from a push integration', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findUnique.mockResolvedValue(
      integrationRow({ direction: IntegrationDirection.PUSH, feedUrl: null }),
    );

    await expect(service.syncNow('ph_1')).rejects.toThrow(BadRequestException);
  });

  it('refuses when the lock is already held', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.syncNow('ph_1')).rejects.toThrow(BadRequestException);
  });

  // A failed fetch is a history row with a reason on it, not an exception: the
  // operator's question is always "why did it stop updating", and the answer
  // has to survive somewhere they can read it.
  it('records a failed fetch as a FAILED run and releases the lock', async () => {
    const { service, prisma } = build();
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('ECONNREFUSED') as never);

    await service.syncNow('ph_1');

    const run = prisma.pharmacySyncRun.create.mock.calls[0][0].data;
    expect(run.status).toBe(IntegrationSyncStatus.FAILED);
    expect(run.note).toMatch(/could not be reached/i);

    const finish = prisma.pharmacyIntegration.update.mock.calls[0][0].data;
    expect(finish.syncingSince).toBeNull();
    // A feed that is down is retried on the normal schedule, not immediately.
    expect(finish.nextSyncAt).toBeInstanceOf(Date);

    fetchMock.mockRestore();
  });
});

describe('PharmacyIntegrationService.ingestPush', () => {
  it('rejects a request with no key', async () => {
    const { service } = build();
    await expect(
      service.ingestPush(undefined, [{ name: 'Aspirin' }], undefined, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown key', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findFirst.mockResolvedValue(null);

    await expect(
      service.ingestPush('zmk_nope', [{ name: 'Aspirin' }], undefined, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  // The key is the only thing that says which pharmacy this is — the body
  // carries no id, so a key can never write somebody else's inventory.
  it('looks the pharmacy up by the hash of the key, never the key itself', async () => {
    const { service, prisma, pharmacy } = build();
    prisma.pharmacyIntegration.findFirst.mockResolvedValue(
      integrationRow({ direction: IntegrationDirection.PUSH, apiKeyHash: hashApiKey('zmk_live') }),
    );

    await service.ingestPush('zmk_live', [{ name: 'Aspirin' }], undefined, undefined);

    const [args] = prisma.pharmacyIntegration.findFirst.mock.calls[0];
    expect(args.where.apiKeyHash).toBe(hashApiKey('zmk_live'));
    expect(args.where.apiKeyHash).not.toBe('zmk_live');
    expect(pharmacy.importCsv).toHaveBeenCalledWith(
      'ph_1',
      [{ name: 'Aspirin' }],
      'merge',
      undefined,
      undefined,
    );
  });

  it('refuses to write while the integration is paused', async () => {
    const { service, prisma } = build();
    prisma.pharmacyIntegration.findFirst.mockResolvedValue(
      integrationRow({ enabled: false, apiKeyHash: hashApiKey('zmk_live') }),
    );

    await expect(
      service.ingestPush('zmk_live', [{ name: 'Aspirin' }], undefined, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('lets the request override the stored sync mode', async () => {
    const { service, prisma, pharmacy } = build();
    prisma.pharmacyIntegration.findFirst.mockResolvedValue(
      integrationRow({ apiKeyHash: hashApiKey('zmk_live') }),
    );

    await service.ingestPush('zmk_live', [{ name: 'Aspirin' }], undefined, 'replace');

    expect(pharmacy.importCsv).toHaveBeenCalledWith(
      'ph_1',
      [{ name: 'Aspirin' }],
      'replace',
      undefined,
      undefined,
    );
  });

  // Skipped rows are the failure mode this page exists to make visible: a feed
  // that quietly drops a quarter of its rows every hour looks like success.
  it('grades a run with skipped rows as PARTIAL', async () => {
    const { service, prisma, pharmacy } = build();
    prisma.pharmacyIntegration.findFirst.mockResolvedValue(
      integrationRow({ apiKeyHash: hashApiKey('zmk_live') }),
    );
    pharmacy.importCsv.mockResolvedValue({
      imported: 2, updated: 0, skipped: 4, totalProcessed: 6, mode: 'merge',
    });

    const result = await service.ingestPush(
      'zmk_live', [{ name: 'Aspirin' }], undefined, undefined,
    );

    expect(result.status).toBe('partial');
    expect(result.note).toMatch(/4 rows skipped/);
  });
});

describe('PharmacyIntegrationService.issueApiKey', () => {
  it('returns the key once and stores only its hash', async () => {
    const { service, prisma } = build();

    const { apiKey } = await service.issueApiKey('ph_1');

    expect(apiKey).toMatch(/^zmk_[0-9a-f]{48}$/);
    const { data } = prisma.pharmacyIntegration.update.mock.calls[0][0];
    expect(data.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(data)).not.toContain(apiKey);
    // Enough of the key to recognise which one is installed, not enough to use.
    expect(apiKey.startsWith(data.apiKeyPrefix)).toBe(true);
    expect(data.apiKeyPrefix.length).toBeLessThan(apiKey.length);
  });
});

describe('PharmacyIntegrationService.runDueSyncs', () => {
  it('only considers enabled pull feeds that are due', async () => {
    const { service, prisma } = build();
    const now = new Date('2026-08-24T10:00:00Z');

    await service.runDueSyncs(now);

    const [args] = prisma.pharmacyIntegration.findMany.mock.calls[0];
    expect(args.where).toEqual({
      enabled: true,
      direction: IntegrationDirection.PULL,
      nextSyncAt: { lte: now },
    });
  });

  // Two API instances polling the same database must not sync one pharmacy
  // twice: the claim is a conditional update, and losing it means skipping.
  it('skips a feed whose lock another instance already took', async () => {
    const { service, prisma, pharmacy } = build();
    prisma.pharmacyIntegration.findMany.mockResolvedValue([integrationRow()]);
    prisma.pharmacyIntegration.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.runDueSyncs()).toBe(0);
    expect(pharmacy.importCsv).not.toHaveBeenCalled();
  });
});
