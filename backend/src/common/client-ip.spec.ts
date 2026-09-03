import {
  describeForwarding,
  normaliseIp,
  parseForwarded,
  parseForwardedFor,
  resolveClientIp,
  trustedProxyHops,
} from './client-ip';

/**
 * The address the audit log records.
 *
 * The Audit Logs page showed the same person, on the same machine, on the same
 * connection, signing in from 172.70.219.25, then 172.69.179.107, then
 * 172.71.198.84. Looked up, those resolve to "CloudFlare Inc., Mumbai" — correct
 * lookups of the wrong address. All three sit in Cloudflare's 172.64.0.0/13, and
 * get.zoikomeds.com resolves to 104.21.34.30 / 172.67.167.215, so Cloudflare is
 * in the path in proxied mode.
 *
 * The chain is browser -> Vercel edge -> Cloudflare -> load balancer -> Node,
 * each appending what it saw to X-Forwarded-For. `trust proxy = 1` read the
 * rightmost entry: the Cloudflare edge node, which is anycast and therefore
 * different on every request.
 *
 * The important tests here are the ones about a chain that is *shorter* than the
 * configured trust depth. Reading further left than the proxies justify is how a
 * fix for this becomes a way to write any address you like into the security log.
 */

const BROWSER = '203.0.113.45';
const VERCEL_EGRESS = '76.76.21.21';
const CF_EDGE = '172.70.219.25';
const CF_EDGE_OTHER = '172.69.179.107';
const LB_PEER = '10.128.0.7';

/** A request as it arrives at Node in production: three appending hops. */
const production = (
  browser = BROWSER,
  cfEdge = CF_EDGE,
  extra: Record<string, unknown> = {},
) => ({
  headers: { 'x-forwarded-for': `${browser}, ${VERCEL_EGRESS}, ${cfEdge}`, ...extra },
  socket: { remoteAddress: LB_PEER },
  ip: cfEdge,
});

const PRODUCTION_HOPS = 3;

describe('the reported symptom', () => {
  it('recorded the Cloudflare edge node under the old single-hop trust', () => {
    // Not a regression test for a bug — a record of what the old configuration
    // did, which is the whole reason the value moved into configuration.
    expect(resolveClientIp(production(), 1)).toBe(CF_EDGE);
  });

  it('records the browser once the real depth is configured', () => {
    expect(resolveClientIp(production(), PRODUCTION_HOPS)).toBe(BROWSER);
  });

  it('gives the same answer when only the edge node changes', () => {
    // The reported case: same person, same desk, different Cloudflare edge.
    const first = resolveClientIp(production(BROWSER, CF_EDGE), PRODUCTION_HOPS);
    const second = resolveClientIp(production(BROWSER, CF_EDGE_OTHER), PRODUCTION_HOPS);

    expect(first).toBe(second);
    expect(first).toBe(BROWSER);
  });

  it.each([CF_EDGE, CF_EDGE_OTHER, '172.71.198.84', '172.71.202.66'])(
    'never records the edge address %s',
    (edge) => {
      expect(resolveClientIp(production(BROWSER, edge), PRODUCTION_HOPS)).not.toBe(edge);
    },
  );

  it('records a genuinely different address when the client really moves', () => {
    // A changed ISP or a VPN is a real change and must still show as one.
    const moved = resolveClientIp(production('198.51.100.9'), PRODUCTION_HOPS);

    expect(moved).toBe('198.51.100.9');
  });
});

describe('a forged X-Forwarded-For is not accepted', () => {
  it('ignores the header when the chain is shorter than the trusted depth', () => {
    // Somebody reaching the origin directly with a header of their choosing.
    // The chain is one entry where three were expected, so nothing in it is
    // attributable and the peer socket is the only honest answer.
    const attacker = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '198.51.100.200' },
    };

    expect(resolveClientIp(attacker, PRODUCTION_HOPS)).toBe('198.51.100.200');
  });

  it('does not clamp to the leftmost entry', () => {
    // Clamping the index to zero is the obvious-looking implementation and it
    // is exactly the hole: every short chain would be attacker-controlled.
    const attacker = {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      socket: { remoteAddress: '198.51.100.200' },
    };

    expect(resolveClientIp(attacker, PRODUCTION_HOPS)).not.toBe('1.2.3.4');
    expect(resolveClientIp(attacker, PRODUCTION_HOPS)).toBe('198.51.100.200');
  });

  it('ignores an address the client prepends to a real chain', () => {
    // The browser sends its own X-Forwarded-For; Vercel sets the header to the
    // real client address, so a prepended value would push the chain one longer
    // than the trusted depth and be read past, not read.
    const withInjected = {
      headers: {
        'x-forwarded-for': `1.2.3.4, ${BROWSER}, ${VERCEL_EGRESS}, ${CF_EDGE}`,
      },
      socket: { remoteAddress: LB_PEER },
    };

    expect(resolveClientIp(withInjected, PRODUCTION_HOPS)).toBe(BROWSER);
  });

  it('ignores CF-Connecting-IP even when it is present', () => {
    // Cloudflare sets it to whatever connected to Cloudflare, which in this
    // topology is the Vercel egress address — a different proxy, not the person.
    const req = production(BROWSER, CF_EDGE, { 'cf-connecting-ip': VERCEL_EGRESS });

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(BROWSER);
  });

  it('ignores X-Real-IP and True-Client-IP', () => {
    const req = production(BROWSER, CF_EDGE, {
      'x-real-ip': '1.2.3.4',
      'true-client-ip': '5.6.7.8',
    });

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(BROWSER);
  });

  it('trusts nothing forwarded when the depth is zero', () => {
    expect(resolveClientIp(production(), 0)).toBe(LB_PEER);
  });
});

describe('malformed forwarded values', () => {
  it.each([
    ['unknown', 'what some proxies emit for an unresolvable peer'],
    ['-', 'an empty placeholder'],
    ['not-an-ip', 'free text'],
    ['999.999.999.999', 'a number that is not an address'],
    ['<script>', 'an injection attempt'],
  ])('drops %s — %s', (junk) => {
    expect(parseForwardedFor(junk)).toEqual([]);
    expect(normaliseIp(junk)).toBeUndefined();
  });

  it('keeps the valid entries either side of a junk one', () => {
    expect(parseForwardedFor(`${BROWSER}, unknown, ${CF_EDGE}`)).toEqual([BROWSER, CF_EDGE]);
  });

  it('falls back to the peer when every entry is junk', () => {
    const req = {
      headers: { 'x-forwarded-for': 'unknown, -, nonsense' },
      socket: { remoteAddress: LB_PEER },
    };

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(LB_PEER);
  });

  it('handles an absent header', () => {
    expect(resolveClientIp({ socket: { remoteAddress: LB_PEER } }, 3)).toBe(LB_PEER);
    expect(parseForwardedFor(undefined)).toEqual([]);
  });

  it('handles the header arriving more than once', () => {
    // Node exposes a repeated header as an array.
    const req = {
      headers: { 'x-forwarded-for': [`${BROWSER}, ${VERCEL_EGRESS}`, CF_EDGE] },
      socket: { remoteAddress: LB_PEER },
    };

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(BROWSER);
  });
});

describe('IPv4 and IPv6', () => {
  it('records an IPv4 client', () => {
    expect(resolveClientIp(production('203.0.113.45'), PRODUCTION_HOPS)).toBe('203.0.113.45');
  });

  it('records an IPv6 client', () => {
    const req = {
      headers: {
        'x-forwarded-for': `2001:db8::8a2e:370:7334, ${VERCEL_EGRESS}, ${CF_EDGE}`,
      },
      socket: { remoteAddress: LB_PEER },
    };

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe('2001:db8::8a2e:370:7334');
  });

  it('writes an IPv4-mapped IPv6 address back as plain IPv4', () => {
    // Otherwise the same client appears under two spellings depending on which
    // listener accepted the connection.
    expect(normaliseIp('::ffff:203.0.113.45')).toBe('203.0.113.45');
    expect(normaliseIp('::FFFF:203.0.113.45')).toBe('203.0.113.45');
  });

  it('drops a port suffix from either family', () => {
    expect(normaliseIp('203.0.113.45:51514')).toBe('203.0.113.45');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:db8::1');
  });

  it('does not truncate a bare IPv6 at its first colon', () => {
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('trims whitespace around each entry', () => {
    expect(parseForwardedFor(`  ${BROWSER} ,  ${CF_EDGE}  `)).toEqual([BROWSER, CF_EDGE]);
  });
});

describe('a direct request', () => {
  it('records the peer when nothing is in front', () => {
    expect(resolveClientIp({ socket: { remoteAddress: '198.51.100.4' } }, 3)).toBe(
      '198.51.100.4',
    );
  });

  it('gives local development a usable address', () => {
    expect(resolveClientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' } }, 1)).toBe(
      '127.0.0.1',
    );
    expect(resolveClientIp({ socket: { remoteAddress: '::1' } }, 1)).toBe('::1');
  });

  it('falls back to req.ip when there is no socket at all', () => {
    expect(resolveClientIp({ ip: '198.51.100.4' }, 1)).toBe('198.51.100.4');
  });

  it('returns undefined rather than a wrong value when there is nothing to read', () => {
    expect(resolveClientIp({}, 3)).toBeUndefined();
  });
});

describe('RFC 7239 Forwarded', () => {
  it('is read when X-Forwarded-For is absent', () => {
    const req = {
      headers: {
        forwarded: `for=${BROWSER};proto=https, for=${VERCEL_EGRESS}, for=${CF_EDGE}`,
      },
      socket: { remoteAddress: LB_PEER },
    };

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(BROWSER);
  });

  it('handles a quoted IPv6 element', () => {
    expect(parseForwarded('for="[2001:db8::1]:443"')).toEqual(['2001:db8::1']);
  });

  it('is not read when X-Forwarded-For is present', () => {
    // One header decides, so the hop count means the same thing either way.
    const req = production(BROWSER, CF_EDGE, { forwarded: 'for=1.2.3.4' });

    expect(resolveClientIp(req, PRODUCTION_HOPS)).toBe(BROWSER);
  });
});

describe('the trusted depth setting', () => {
  it('defaults to the depth the process already used', () => {
    // Deploying this changes nothing on its own; the value is set deliberately.
    expect(trustedProxyHops({})).toBe(1);
  });

  it('reads a configured depth', () => {
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '3' })).toBe(3);
  });

  it.each(['0', '2', '4'])('accepts %s', (value) => {
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: value })).toBe(Number(value));
  });

  it.each(['-1', 'three', '1.5', '', '999'])(
    'falls back to 1 rather than honouring %s',
    (value) => {
      // A bad setting must not silently widen trust; 1 is the conservative
      // reading, and reading further left than the chain justifies is the risk.
      expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: value })).toBe(1);
    },
  );
});

describe('the diagnostic', () => {
  it('reports the chain a real request produced', () => {
    const report = describeForwarding(production(), PRODUCTION_HOPS);

    expect(report.chainLength).toBe(3);
    expect(report.forwardedFor).toEqual([BROWSER, VERCEL_EGRESS, CF_EDGE]);
    expect(report.resolved).toBe(BROWSER);
    expect(report.trustedProxyHops).toBe(3);
  });

  it('shows what the old configuration would have picked', () => {
    const report = describeForwarding(production(), 1);

    expect(report.resolved).toBe(CF_EDGE);
  });

  it('shows the Cloudflare header holding a proxy address, unused', () => {
    const report = describeForwarding(
      production(BROWSER, CF_EDGE, { 'cf-connecting-ip': VERCEL_EGRESS }),
      PRODUCTION_HOPS,
    );

    expect(report.cfConnectingIp).toBe(VERCEL_EGRESS);
    expect(report.resolved).toBe(BROWSER);
  });

  it('carries addresses only — no credentials, cookies or body', () => {
    const report = describeForwarding(
      production(BROWSER, CF_EDGE, {
        cookie: 'session=secret',
        authorization: 'Bearer token',
      }),
      PRODUCTION_HOPS,
    );

    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/secret|Bearer|token|cookie/i);
  });
});
