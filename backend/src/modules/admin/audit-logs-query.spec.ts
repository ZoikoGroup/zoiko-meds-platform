import { ValidationPipe } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';

/**
 * The /admin/audit-logs query contract.
 *
 * Settings → Audit log asked for `limit=50`. This endpoint paginates on
 * page/pageSize, and the global pipe runs with forbidNonWhitelisted, so the
 * parameter was not ignored — the request was rejected and the tab rendered the
 * validator's own words, "property limit should not exist", in place of the log.
 *
 * Pinned here rather than only in the frontend: the strict validation is the
 * behaviour worth keeping, so what needs a test is which parameters the contract
 * actually admits.
 */

// The pipe as main.ts configures it, so whitelisting is real in these tests.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = { type: 'query' as const, metatype: ListAuditLogsQuery, data: '' };

/** Validate a query string's worth of params as the controller would receive it. */
async function validate(
  query: Record<string, unknown>,
): Promise<{ ok: boolean; messages: string[]; value?: ListAuditLogsQuery }> {
  try {
    const value = (await pipe.transform(query, meta)) as ListAuditLogsQuery;
    return { ok: true, messages: [], value };
  } catch (err: unknown) {
    const res = (err as { getResponse?: () => unknown }).getResponse?.() as {
      message?: string | string[];
    };
    const message = res?.message ?? [];
    return { ok: false, messages: Array.isArray(message) ? message : [message] };
  }
}

describe('the pagination contract', () => {
  it('accepts page and pageSize — the project convention', async () => {
    // Query params arrive as strings; @Type(() => Number) is what makes this work.
    const { ok, value } = await validate({ page: '2', pageSize: '50' });

    expect(ok).toBe(true);
    expect(value).toMatchObject({ page: 2, pageSize: 50 });
  });

  it('accepts pageSize on its own, which is what the Settings tab sends', async () => {
    const { ok, value } = await validate({ pageSize: '50' });

    expect(ok).toBe(true);
    expect(value?.pageSize).toBe(50);
  });

  it('loads with no pagination at all, so the caller need not supply any', async () => {
    // The service defaults to page 1, pageSize 50.
    const { ok, value } = await validate({});

    expect(ok).toBe(true);
    expect(value?.page).toBeUndefined();
    expect(value?.pageSize).toBeUndefined();
  });

  it('refuses a page below one', async () => {
    expect((await validate({ page: '0' })).ok).toBe(false);
  });

  it('refuses a non-numeric page size', async () => {
    expect((await validate({ pageSize: 'fifty' })).ok).toBe(false);
  });
});

describe('limit is not part of this contract', () => {
  it('rejects it, as the strict pipe should', async () => {
    // Kept deliberately: silently dropping unknown params hides caller bugs.
    // The fix is that the frontend no longer sends this one.
    const { ok, messages } = await validate({ limit: '50' });

    expect(ok).toBe(false);
    expect(messages.join(' ')).toMatch(/limit should not exist/);
  });

  it('is not quietly accepted alongside pageSize either', async () => {
    expect((await validate({ pageSize: '50', limit: '50' })).ok).toBe(false);
  });

  it('rejects the other pagination dialects too, so there is one contract', async () => {
    for (const params of [{ offset: '0' }, { take: '10' }, { skip: '5' }, { perPage: '20' }]) {
      expect((await validate(params)).ok).toBe(false);
    }
  });
});

describe('the filters the Audit Log page relies on', () => {
  it('accepts every one of them together', async () => {
    const { ok, value } = await validate({
      pageSize: '200',
      module: 'Inventory',
      action: 'Update',
      user: 'root@zoikomeds.test',
      pharmacy: 'Apollo Kompally',
      search: 'signed in',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      severity: AuditSeverity.INFO,
    });

    expect(ok).toBe(true);
    expect(value).toMatchObject({
      pageSize: 200,
      module: 'Inventory',
      action: 'Update',
      user: 'root@zoikomeds.test',
      pharmacy: 'Apollo Kompally',
      search: 'signed in',
      severity: AuditSeverity.INFO,
    });
  });

  it.each(['module', 'action', 'user', 'pharmacy', 'search', 'startDate', 'endDate'])(
    'accepts %s on its own',
    async (field) => {
      expect((await validate({ [field]: 'x' })).ok).toBe(true);
    },
  );

  it('refuses a severity outside the enum', async () => {
    expect((await validate({ severity: 'CATASTROPHIC' })).ok).toBe(false);
  });
});
