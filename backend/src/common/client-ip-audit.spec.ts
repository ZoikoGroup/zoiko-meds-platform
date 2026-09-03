import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { resolveClientIp, trustedProxyHops } from './client-ip';

/**
 * The address every audited action records, end to end.
 *
 * Forty-six handlers across seven controllers capture one. All of them used
 * Nest's `@Ip()`, so fixing the login route alone would have left role changes,
 * password resets, key revocations and verification decisions still naming
 * Cloudflare edge nodes. The decorator is what changed, and it delegates to
 * `resolveClientIp` — which is exercised here through a real Express server
 * carrying the same `trust proxy` setting main.ts applies, because the
 * interaction between that setting and the resolver is the part a fake request
 * object cannot show.
 */

const BROWSER = '203.0.113.45';
const VERCEL_EGRESS = '76.76.21.21';
const CF_EDGE = '172.70.219.25';
const CF_EDGE_OTHER = '172.69.179.107';

/** X-Forwarded-For as production builds it: browser, Vercel, Cloudflare edge. */
const chain = (browser = BROWSER, edge = CF_EDGE) => `${browser}, ${VERCEL_EGRESS}, ${edge}`;

/** A server configured the way main.ts configures the real one. */
async function boot(hops: string | undefined) {
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = hops;

  const app = express();
  // The single setting, read from the same helper main.ts reads.
  app.set('trust proxy', trustedProxyHops());
  // Stands in for any audited handler; @ClientIp() resolves exactly this way.
  app.get('/probe', (req, res) => {
    res.json({ ipAddress: resolveClientIp(req) ?? null, expressReqIp: req.ip ?? null });
  });

  const server = await new Promise<Server>((done) => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

const probe = async (baseUrl: string, forwardedFor?: string) => {
  const res = await fetch(`${baseUrl}/probe`, {
    headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
  });
  return (await res.json()) as { ipAddress: string | null; expressReqIp: string | null };
};

describe('the same user signing in twice from the same connection', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await boot('3'));
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it('records the browser address, not the edge node', async () => {
    expect((await probe(baseUrl, chain())).ipAddress).toBe(BROWSER);
  });

  it('records the same address on a second login through a different edge', async () => {
    // The reported case, exactly: one person, one desk, two Cloudflare nodes.
    const first = await probe(baseUrl, chain(BROWSER, CF_EDGE));
    const second = await probe(baseUrl, chain(BROWSER, CF_EDGE_OTHER));

    expect(first.ipAddress).toBe(second.ipAddress);
    expect(first.ipAddress).toBe(BROWSER);
  });

  it('agrees with the address the rate limiter keys on', async () => {
    // Both come from the one trust setting. Throttling a request under one
    // address and auditing it under another is how a review loses an hour.
    const { ipAddress, expressReqIp } = await probe(baseUrl, chain());

    expect(ipAddress).toBe(expressReqIp);
  });

  it('records a real change of connection as a change', async () => {
    expect((await probe(baseUrl, chain('198.51.100.9'))).ipAddress).toBe('198.51.100.9');
  });

  it('records an IPv6 client', async () => {
    const forwarded = chain('2001:db8::8a2e:370:7334');

    expect((await probe(baseUrl, forwarded)).ipAddress).toBe('2001:db8::8a2e:370:7334');
  });

  it('refuses a forged header from a request that skipped the proxies', async () => {
    // This connection is loopback, so the chain is one entry where three were
    // expected. The header is discarded and the peer stands.
    const { ipAddress } = await probe(baseUrl, '1.2.3.4');

    expect(ipAddress).not.toBe('1.2.3.4');
    expect(ipAddress).toBe('127.0.0.1');
  });

  it('still answers with an address when nothing is forwarded', async () => {
    expect((await probe(baseUrl)).ipAddress).toBe('127.0.0.1');
  });

  it('drops a malformed entry rather than storing it', async () => {
    const { ipAddress } = await probe(baseUrl, `${BROWSER}, unknown, -, ${CF_EDGE}`);

    // Three valid-looking positions collapse to two real ones, which is shorter
    // than the trusted depth — so nothing forwarded is attributable.
    expect(ipAddress).toBe('127.0.0.1');
  });
});

describe('with the depth left at its default', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await boot(undefined));
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  it('behaves as the process did before, so deploying changes nothing', async () => {
    expect((await probe(baseUrl, chain())).ipAddress).toBe(CF_EDGE);
  });
});

describe('every audited handler resolves the address the same way', () => {
  // Source-level, because the risk is a new handler reaching for @Ip() again
  // and one corner of the security log quietly going back to naming
  // infrastructure. Forty-six call sites is too many to keep consistent by
  // inspection.
  const CONTROLLERS = [
    'src/modules/admin/admin.controller.ts',
    'src/modules/admin/notification/notification.controller.ts',
    'src/modules/admin/pharmacy/pharmacy-admin.controller.ts',
    'src/modules/admin/reports/reports.controller.ts',
    'src/modules/admin/verification/verification.controller.ts',
    'src/modules/auth/auth.controller.ts',
    'src/modules/pharmacy/pharmacy.controller.ts',
  ];

  const source = (path: string) => readFileSync(resolvePath(process.cwd(), path), 'utf8');

  it.each(CONTROLLERS)('%s uses @ClientIp()', (path) => {
    expect(source(path)).toContain('@ClientIp()');
  });

  it.each(CONTROLLERS)('%s no longer uses @Ip()', (path) => {
    expect(source(path)).not.toContain('@Ip()');
  });

  it('captures an address on the login route', async () => {
    expect(source('src/modules/auth/auth.controller.ts')).toMatch(
      /login[\s\S]{0,400}@ClientIp\(\)/,
    );
  });

  it('leaves no handler reading a forwarding header directly', () => {
    for (const path of CONTROLLERS) {
      const text = source(path).toLowerCase();
      expect(text).not.toContain('x-forwarded-for');
      expect(text).not.toContain('cf-connecting-ip');
      expect(text).not.toContain('x-real-ip');
    }
  });

  it('logs requests under the same address it audits them under', () => {
    const interceptor = source('src/common/interceptors/logging.interceptor.ts');

    expect(interceptor).toContain('resolveClientIp(req)');
    expect(interceptor).not.toMatch(/ip: req\.ip/);
  });

  it('sets trust proxy from the same helper the resolver reads', () => {
    const main = source('src/main.ts');

    expect(main).toContain("set('trust proxy', trustedProxyHops())");
    expect(main).not.toContain("set('trust proxy', 1)");
  });
});
