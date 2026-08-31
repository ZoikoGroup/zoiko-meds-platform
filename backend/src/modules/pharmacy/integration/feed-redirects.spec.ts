import { BadRequestException } from '@nestjs/common';

/**
 * Resolution is per-host here, unlike the sibling spec's single public answer:
 * these tests are precisely about a redirect that lands somewhere it should not,
 * so the target's address is the thing under test.
 */
const ADDRESSES: Record<string, { address: string; family: number }[]> = {
  'docs.google.com': [{ address: '142.250.190.78', family: 4 }],
  'doc-0c-2k-sheets.googleusercontent.com': [{ address: '142.250.190.65', family: 4 }],
  'feeds.example.com': [{ address: '203.0.113.10', family: 4 }],
  'cdn.example.net': [{ address: '198.51.100.7', family: 4 }],
  'mirror.example.org': [{ address: '203.0.113.44', family: 4 }],
  // A public name that resolves inward — the DNS-rebinding shape.
  'internal.example.com': [{ address: '10.0.0.5', family: 4 }],
  localhost: [{ address: '127.0.0.1', family: 4 }],
};

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async (host: string) => {
    const found = ADDRESSES[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  }),
}));

import { fetchFeed, MAX_FEED_REDIRECTS } from './feed';

/**
 * Following a feed's redirects.
 *
 * `redirect: 'error'` used to refuse every 3xx, on the reasoning that a
 * redirect is a URL the SSRF guard never saw. The reasoning was right and the
 * remedy was wrong: a published Google Sheet answers 307 from docs.google.com
 * and serves the CSV from googleusercontent.com, so the rule refused the single
 * most common feed a pharmacy has, and the operator was told to stop their URL
 * redirecting — something no Google Sheet can be made to do.
 *
 * Redirects are now followed one at a time, and every hop is put through the
 * same guard as the URL the operator typed.
 */

const CSV = [
  'name,generic,strength,dosageform,status',
  'Dolo 650,Paracetamol,650 mg,Tablet,available',
  'Augmentin 625,Amoxicillin + Clavulanate,625 mg,Tablet,limited stock',
  'Cetirizine 10,Cetirizine,10 mg,Tablet,out of stock',
].join('\r\n');

const csvResponse = () =>
  new Response(CSV, {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8' },
  });

/** A 3xx the way a server actually sends one. */
const redirectTo = (location: string, status = 307) =>
  new Response(null, { status, headers: { location } });

/**
 * Serve a scripted conversation and record what was asked for.
 *
 * Responses are keyed on URL so a loop can answer the same URL twice, which a
 * flat queue could not express.
 */
function serve(routes: Record<string, () => Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    calls.push({ url, headers });
    const handler = routes[url];
    if (!handler) throw new TypeError('fetch failed');
    return handler();
  });
  return { calls, spy };
}

afterEach(() => jest.restoreAllMocks());

const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv';
const SHEET_TARGET = 'https://doc-0c-2k-sheets.googleusercontent.com/pub/54bogv/e5i1lu/1788180775000';

describe('a feed that does not redirect', () => {
  it('is fetched and parsed exactly as before', async () => {
    serve({ 'https://feeds.example.com/stock.csv': csvResponse });

    const { rows, contentType } = await fetchFeed('https://feeds.example.com/stock.csv');

    expect(rows).toHaveLength(3);
    expect(contentType).toContain('text/csv');
  });

  it('asks for the URL once', async () => {
    const { calls } = serve({ 'https://feeds.example.com/stock.csv': csvResponse });

    await fetchFeed('https://feeds.example.com/stock.csv');

    expect(calls).toHaveLength(1);
  });
});

describe('a published Google Sheet', () => {
  // The reported case, end to end.
  it('follows the 307 to googleusercontent and reads the CSV', async () => {
    serve({
      [SHEET]: () => redirectTo(SHEET_TARGET, 307),
      [SHEET_TARGET]: csvResponse,
    });

    const { rows } = await fetchFeed(SHEET);

    expect(rows.map((r) => r.name)).toEqual(['Dolo 650', 'Augmentin 625', 'Cetirizine 10']);
  });

  it('reads the columns this sheet actually has', async () => {
    serve({ [SHEET]: () => redirectTo(SHEET_TARGET), [SHEET_TARGET]: csvResponse });

    const [first] = (await fetchFeed(SHEET)).rows;

    expect(first).toEqual({
      name: 'Dolo 650',
      generic: 'Paracetamol',
      strength: '650 mg',
      dosageform: 'Tablet',
      status: 'available',
    });
  });

  it('dials the redirect target itself, not the original URL again', async () => {
    const { calls } = serve({
      [SHEET]: () => redirectTo(SHEET_TARGET),
      [SHEET_TARGET]: csvResponse,
    });

    await fetchFeed(SHEET);

    expect(calls.map((c) => c.url)).toEqual([SHEET, SHEET_TARGET]);
  });

  it('sends no Authorization header for a public sheet', async () => {
    const { calls } = serve({
      [SHEET]: () => redirectTo(SHEET_TARGET),
      [SHEET_TARGET]: csvResponse,
    });

    await fetchFeed(SHEET);

    for (const call of calls) {
      expect(Object.keys(call.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  });
});

describe('the length of the chain', () => {
  it('follows several safe hops', async () => {
    serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('https://cdn.example.net/a'),
      'https://cdn.example.net/a': () => redirectTo('https://mirror.example.org/b'),
      'https://mirror.example.org/b': csvResponse,
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).resolves.toMatchObject({
      rows: expect.any(Array),
    });
  });

  it('resolves a relative Location against the hop that sent it', async () => {
    serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('/exports/latest.csv'),
      'https://feeds.example.com/exports/latest.csv': csvResponse,
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).resolves.toBeDefined();
  });

  it.each([301, 302, 303, 307, 308])('follows a %s', async (status) => {
    serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('https://cdn.example.net/a', status),
      'https://cdn.example.net/a': csvResponse,
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).resolves.toBeDefined();
  });

  it('gives up rather than following forever', async () => {
    // Every hop points one further along; none of them ever answers with a body.
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i <= MAX_FEED_REDIRECTS + 2; i++) {
      routes[`https://cdn.example.net/${i}`] = () =>
        redirectTo(`https://cdn.example.net/${i + 1}`);
    }
    serve(routes);

    await expect(fetchFeed('https://cdn.example.net/0')).rejects.toThrow(
      /redirected more than 5 times/,
    );
  });

  it('ends a redirect loop instead of spinning on it', async () => {
    serve({
      'https://cdn.example.net/a': () => redirectTo('https://cdn.example.net/b'),
      'https://cdn.example.net/b': () => redirectTo('https://cdn.example.net/a'),
    });

    await expect(fetchFeed('https://cdn.example.net/a')).rejects.toThrow(
      /redirected more than 5 times/,
    );
  });

  it('stops at exactly the limit, having made one request per hop plus the first', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i <= MAX_FEED_REDIRECTS + 2; i++) {
      routes[`https://cdn.example.net/${i}`] = () =>
        redirectTo(`https://cdn.example.net/${i + 1}`);
    }
    const { calls } = serve(routes);

    await expect(fetchFeed('https://cdn.example.net/0')).rejects.toThrow(BadRequestException);

    expect(calls).toHaveLength(MAX_FEED_REDIRECTS + 1);
  });
});

describe('a redirect the guard must refuse', () => {
  // The reason redirects are followed by hand at all. `redirect: 'follow'`
  // would dial each of these inside undici, where the guard cannot see them.
  it.each([
    ['loopback by address', 'http://127.0.0.1:8000/feed.csv'],
    ['loopback by name', 'http://localhost/feed.csv'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['RFC1918', 'http://10.0.0.5/feed.csv'],
    ['a private v6 address', 'http://[::1]/feed.csv'],
    ['a public name resolving inward', 'https://internal.example.com/feed.csv'],
  ])('blocks a redirect to %s', async (_label, target) => {
    const { calls } = serve({
      'https://feeds.example.com/stock.csv': () => redirectTo(target),
      [target]: csvResponse,
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.toThrow(
      /blocked or private address/,
    );
    // And never dialled it: the guard runs before the request, not after.
    expect(calls.map((c) => c.url)).toEqual(['https://feeds.example.com/stock.csv']);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    serve({ 'https://feeds.example.com/stock.csv': () => redirectTo('file:///etc/passwd') });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.toThrow(
      /blocked or private address/,
    );
  });

  it('says so when a redirect carries no Location at all', async () => {
    serve({
      'https://feeds.example.com/stock.csv': () => new Response(null, { status: 302 }),
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.toThrow(
      /no Location header/,
    );
  });

  it('names neither the address nor anything else secret in the message', async () => {
    serve({
      'https://feeds.example.com/stock.csv': () =>
        redirectTo('http://169.254.169.254/latest/meta-data/'),
    });

    await expect(
      fetchFeed('https://feeds.example.com/stock.csv', 'Authorization', 'Bearer feed-secret'),
    ).rejects.toThrow(expect.not.stringMatching(/feed-secret/) as unknown as string);
  });
});

describe('where the credential is allowed to go', () => {
  const AUTH = ['X-Api-Key', 'super-secret-key'] as const;

  it('sends it to the origin it was configured for', async () => {
    const { calls } = serve({ 'https://feeds.example.com/stock.csv': csvResponse });

    await fetchFeed('https://feeds.example.com/stock.csv', ...AUTH);

    expect(calls[0].headers['X-Api-Key']).toBe('super-secret-key');
  });

  it('keeps sending it across a redirect that stays on that origin', async () => {
    const { calls } = serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('/exports/latest.csv'),
      'https://feeds.example.com/exports/latest.csv': csvResponse,
    });

    await fetchFeed('https://feeds.example.com/stock.csv', ...AUTH);

    expect(calls).toHaveLength(2);
    expect(calls[1].headers['X-Api-Key']).toBe('super-secret-key');
  });

  it('withholds it from a redirect to a different host', async () => {
    // The operator gave this header to their own feed host. A third party the
    // feed happens to point at was never party to that.
    const { calls } = serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('https://cdn.example.net/a'),
      'https://cdn.example.net/a': csvResponse,
    });

    await fetchFeed('https://feeds.example.com/stock.csv', ...AUTH);

    expect(calls[1].url).toBe('https://cdn.example.net/a');
    expect(calls[1].headers['X-Api-Key']).toBeUndefined();
  });

  it('withholds it when only the scheme changes, a downgrade being the point', async () => {
    const { calls } = serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('http://feeds.example.com/plain.csv'),
      'http://feeds.example.com/plain.csv': csvResponse,
    });

    await fetchFeed('https://feeds.example.com/stock.csv', ...AUTH);

    expect(calls[1].headers['X-Api-Key']).toBeUndefined();
  });

  it('still reads a public feed that has no credential at all', async () => {
    const { calls } = serve({
      [SHEET]: () => redirectTo(SHEET_TARGET),
      [SHEET_TARGET]: csvResponse,
    });

    await expect(fetchFeed(SHEET)).resolves.toMatchObject({ rows: expect.any(Array) });
    expect(calls.every((c) => !('X-Api-Key' in c.headers))).toBe(true);
  });
});

describe('what the final response has to be', () => {
  it('reports the status when the last hop refuses', async () => {
    serve({
      'https://feeds.example.com/stock.csv': () => redirectTo('https://cdn.example.net/a'),
      'https://cdn.example.net/a': () => new Response('nope', { status: 403 }),
    });

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.toThrow(/HTTP 403/);
  });

  it('names HTML as HTML rather than blaming the column headers', async () => {
    // What an unpublished sheet returns: 200, and a sign-in page.
    serve({
      [SHEET]: () => redirectTo(SHEET_TARGET),
      [SHEET_TARGET]: () =>
        new Response('<!DOCTYPE html><html lang="en"><head><title>Sign in</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });

    await expect(fetchFeed(SHEET)).rejects.toThrow(/HTML instead of CSV or JSON/);
  });

  it('reports an unreachable host without mentioning redirects', async () => {
    // The old message told every operator their URL redirected, whether or not
    // it did, because one sentence covered both faults.
    serve({});

    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.toThrow(
      /could not be reached/,
    );
    await expect(fetchFeed('https://feeds.example.com/stock.csv')).rejects.not.toThrow(
      /does not redirect/,
    );
  });
});
