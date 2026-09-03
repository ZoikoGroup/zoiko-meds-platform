import { isIP } from 'node:net';

/**
 * Who the request actually came from.
 *
 * The audit log recorded a different address every time the same person signed
 * in from the same desk: 172.70.219.25, then 172.69.179.107, then 172.71.198.84.
 * Looked up, they resolved to "CloudFlare Inc., Mumbai". They were correct
 * lookups of the wrong address.
 *
 * The production path is four deep:
 *
 *   browser
 *     -> Vercel edge          (vercel.json rewrites /internal/* to the API host)
 *     -> Cloudflare           (get.zoikomeds.com is proxied; it resolves to
 *                              104.21.34.30 / 172.67.167.215 / 2606:4700::)
 *     -> GCP load balancer
 *     -> Node
 *
 * Each of those appends what *it* saw to X-Forwarded-For, so the header arrives
 * as [browser, vercel-egress, cloudflare-edge] and the socket peer is the load
 * balancer. Express was configured with `trust proxy = 1`, which reads the
 * rightmost entry — the Cloudflare edge node. Cloudflare is anycast, so the
 * nearest edge differs request to request, and the "IP address" column became a
 * record of Cloudflare's routing rather than of the person.
 *
 * CF-Connecting-IP does not help here and is deliberately not read. Cloudflare
 * sets it to the address that connected to Cloudflare, which in this topology is
 * the Vercel egress IP — a different proxy, not the browser.
 */

/**
 * How many proxies in front of this process append to X-Forwarded-For.
 *
 * Defaults to 1, which is what the process already did, so deploying this
 * changes nothing until the value is set deliberately. Set it from evidence —
 * GET /api/admin/diagnostics/client-ip reports the chain a real request
 * produced — and not by counting boxes on a diagram: a CDN that is bypassed for
 * some routes, or a health check that reaches the origin directly, changes the
 * answer.
 *
 * For the topology above the value is 3.
 */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  // An empty variable is unset, not zero. `TRUSTED_PROXY_HOPS=` in a deploy
  // config is a value someone meant to fill in, and Number('') is 0 — which
  // would quietly stop trusting the proxies altogether.
  const configured = env.TRUSTED_PROXY_HOPS?.trim();
  const raw = Number(configured ? configured : 1);
  // A non-numeric or negative setting must not silently disable forwarding
  // trust or, worse, read further left than the chain justifies.
  if (!Number.isInteger(raw) || raw < 0 || raw > 16) return 1;
  return raw;
}

/**
 * An address in the form the audit log should hold it.
 *
 * IPv4-mapped IPv6 (`::ffff:203.0.113.4`) is written back as plain IPv4 so the
 * same client does not appear under two spellings depending on which listener
 * accepted the connection. A port suffix, which some proxies append, is
 * dropped. Anything that is not an address is rejected rather than stored —
 * "unknown" and "-" are values proxies really do emit.
 */
export function normaliseIp(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  let candidate = String(value).trim();
  if (!candidate) return undefined;

  // [2001:db8::1]:443 — bracketed IPv6 with a port.
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) candidate = bracketed[1];

  if (candidate.toLowerCase().startsWith('::ffff:')) {
    const mapped = candidate.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return mapped;
  }

  // 203.0.113.4:51514 — IPv4 with a port. Only split when what remains is an
  // address; a bare IPv6 also contains colons and must not be truncated.
  if (isIP(candidate) === 0 && candidate.includes(':')) {
    const [host] = candidate.split(':');
    if (isIP(host) === 4) return host;
  }

  return isIP(candidate) === 0 ? undefined : candidate;
}

/** The X-Forwarded-For chain, oldest hop first, malformed entries dropped. */
export function parseForwardedFor(header: unknown): string[] {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => normaliseIp(entry))
    .filter((entry): entry is string => Boolean(entry));
}

/**
 * RFC 7239 `Forwarded: for=203.0.113.4;proto=https, for=198.51.100.7`.
 *
 * Read only when X-Forwarded-For is absent. Some proxies emit one, some the
 * other; nothing in this path emits both, and preferring one keeps the hop
 * count meaning the same thing in either case.
 */
export function parseForwarded(header: unknown): string[] {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((element) => {
      const match = /for\s*=\s*"?([^;,"]+)"?/i.exec(element);
      return match ? normaliseIp(match[1]) : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
}

/** The shape this needs from a request, so it can be called with a plain object. */
export interface IpBearingRequest {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

/**
 * The client address to record, resolved once for the whole application.
 *
 * Counted from the right, because that is the only end that cannot be forged:
 * every entry to the left of the trusted boundary was written by something this
 * process has no reason to believe. With `hops` proxies trusted, the client is
 * the entry `hops` positions from the end.
 *
 * The refusal is the important part. When the chain is *shorter* than the
 * configured depth the request did not come through the expected proxies —
 * someone reached the origin directly, with a header of their choosing — and
 * the header is discarded entirely in favour of the peer socket. Clamping the
 * index to zero instead, which is the obvious-looking thing to do, would make
 * `X-Forwarded-For: 1.2.3.4` from any attacker the recorded address of every
 * security event they caused.
 */
export function resolveClientIp(
  req: IpBearingRequest,
  hops: number = trustedProxyHops(),
): string | undefined {
  const headers = req.headers ?? {};
  const peer = normaliseIp(req.socket?.remoteAddress ?? req.connection?.remoteAddress);

  if (hops > 0) {
    const chain =
      parseForwardedFor(headers['x-forwarded-for']).length > 0
        ? parseForwardedFor(headers['x-forwarded-for'])
        : parseForwarded(headers['forwarded']);

    // Only when the chain is at least as long as the trust depth. A shorter one
    // means a hop was skipped, and every entry in it is then unattributable.
    if (chain.length >= hops) {
      const client = chain[chain.length - hops];
      if (client) return client;
    }
  }

  // No forwarding to trust: the peer is the client, which is the right answer
  // for a direct request and for local development.
  return peer ?? normaliseIp(req.ip);
}

/**
 * What the forwarding headers actually said, for setting TRUSTED_PROXY_HOPS.
 *
 * Addresses only — no cookies, tokens, credentials or body. Exposed behind the
 * SUPER_ADMIN guard because a proxy chain describes the deployment's shape.
 */
export function describeForwarding(req: IpBearingRequest, hops = trustedProxyHops()) {
  const headers = req.headers ?? {};
  const forwardedFor = parseForwardedFor(headers['x-forwarded-for']);
  const forwarded = parseForwarded(headers['forwarded']);
  const chain = forwardedFor.length > 0 ? forwardedFor : forwarded;

  return {
    resolved: resolveClientIp(req, hops) ?? null,
    trustedProxyHops: hops,
    // Set TRUSTED_PROXY_HOPS to this to read the leftmost entry of a chain this
    // shape — after checking the entry it selects is the address you expect.
    chainLength: chain.length,
    forwardedFor,
    forwarded,
    // Reported so it is visible that it holds a proxy address in this topology
    // and is therefore not used. Cloudflare sets it to whatever connected to
    // Cloudflare, which here is Vercel.
    cfConnectingIp: normaliseIp(headers['cf-connecting-ip'] as string) ?? null,
    trueClientIp: normaliseIp(headers['true-client-ip'] as string) ?? null,
    xRealIp: normaliseIp(headers['x-real-ip'] as string) ?? null,
    socketPeer: normaliseIp(req.socket?.remoteAddress) ?? null,
    expressReqIp: normaliseIp(req.ip) ?? null,
  };
}
