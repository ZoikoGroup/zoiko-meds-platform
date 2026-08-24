import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching a pharmacy's inventory feed.
 *
 * The URL here is typed by an operator and dialled by the server, which makes
 * this a server-side request forgery surface before it is anything else: left
 * unguarded, "http://169.254.169.254/latest/meta-data/" is a valid feed URL and
 * the response would be handed back through the sync history. Everything in
 * `assertFetchable` exists for that, and it runs against the *resolved
 * addresses*, not the hostname — a name under the operator's control can point
 * anywhere, including at 127.0.0.1.
 */

/** Feeds are inventory files, not datasets. Anything larger is a mistake. */
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

/** A feed that has not answered in this long is treated as down. */
export const FEED_TIMEOUT_MS = 20_000;

/** Rows above this are refused rather than half-imported. */
export const MAX_FEED_ROWS = 20_000;

export function isPrivateAddress(address: string, family: number): boolean {
  if (family === 6) {
    const v6 = address.toLowerCase();
    // Loopback, unspecified, link-local and unique-local.
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    // An IPv4 address wearing a v6 coat is still that IPv4 address.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }

  const [a, b] = address.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Cloud metadata (169.254.169.254) and the rest of link-local.
  if (a === 169 && b === 254) return true;
  // Carrier-grade NAT, then multicast and the reserved top of the space.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Validate a feed URL, resolving its host to check where it actually points.
 * Throws BadRequestException with a message meant for the operator.
 */
export async function assertFetchable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('The feed URL is not a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('The feed URL must start with http:// or https://.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  let addresses: { address: string; family: number }[];
  const literal = isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new BadRequestException(
        `The feed host "${host}" could not be resolved. Check the address, and that it is reachable from the public internet.`,
      );
    }
  }

  // Every resolved address must be public: one private answer among several is
  // enough for a DNS-rebinding attempt to land.
  if (addresses.some((a) => isPrivateAddress(a.address, a.family))) {
    throw new BadRequestException(
      'The feed URL points inside a private network. Publish the feed on an address ZoikoMeds can reach, or use push mode instead.',
    );
  }

  return url;
}

export interface FeedPayload {
  /** Parsed rows, ready for PharmacyService.importCsv. */
  rows: Record<string, string>[];
  /** What the feed said it was, for the message when parsing fails. */
  contentType: string;
}

/** Split CSV text into row objects keyed on the lower-cased header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  if (!headers.includes('name') && !headers.includes('medicineid')) {
    throw new BadRequestException(
      'The feed is missing a "name" (or "medicineId") column in its header row.',
    );
  }
  return lines.slice(1).map((line) => {
    const parts = line.split(',').map((p) => p.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = parts[i] || '';
    });
    return row;
  });
}

/**
 * Read rows out of whatever the feed returned. JSON (an array, or an object
 * with an `items` / `rows` / `data` array) and CSV are both accepted, chosen by
 * the body itself rather than by the declared content type — a file server
 * handing out text/plain for a .csv is the common case, not the exception.
 */
export function parseFeedBody(
  body: string,
  contentType: string,
): Record<string, string>[] {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new BadRequestException('The feed returned an empty response.');
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BadRequestException(
        `The feed returned ${contentType || 'a body'} that is neither valid JSON nor CSV.`,
      );
    }
    const envelope = parsed as Record<string, unknown>;
    const rows = Array.isArray(parsed)
      ? parsed
      : (envelope?.items ?? envelope?.rows ?? envelope?.data);
    if (!Array.isArray(rows)) {
      throw new BadRequestException(
        'The feed returned a JSON object with no "items", "rows" or "data" array of medicines.',
      );
    }
    return rows as Record<string, string>[];
  }

  return parseCsv(trimmed);
}

/**
 * Fetch and parse a pull feed. Every failure mode — unreachable, non-2xx,
 * oversized, unparseable — comes back as a BadRequestException whose message is
 * safe to show the pharmacy, because it is written into the sync history and
 * read there.
 */
export async function fetchFeed(
  rawUrl: string,
  authHeaderName?: string | null,
  authHeaderValue?: string | null,
): Promise<FeedPayload> {
  const url = await assertFetchable(rawUrl);

  const headers: Record<string, string> = {
    Accept: 'application/json, text/csv;q=0.9, text/plain;q=0.8',
    'User-Agent': 'ZoikoMeds-Sync/1.0',
  };
  if (authHeaderName && authHeaderValue) headers[authHeaderName] = authHeaderValue;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: controller.signal,
      // A redirect is a second URL that assertFetchable never saw, which is the
      // standard way around a guard like it.
      redirect: 'error',
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    throw new BadRequestException(
      aborted
        ? `The feed did not respond within ${FEED_TIMEOUT_MS / 1000} seconds.`
        : 'The feed could not be reached. Check the URL is publicly accessible and does not redirect.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new BadRequestException(
      res.status === 401 || res.status === 403
        ? `The feed rejected our credentials (HTTP ${res.status}). Check the auth header.`
        : `The feed answered HTTP ${res.status}.`,
    );
  }

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_FEED_BYTES) {
    throw new BadRequestException(
      `The feed is larger than the ${MAX_FEED_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  const body = await res.text();
  // Checked again against the body: content-length is a claim, not a promise.
  if (Buffer.byteLength(body) > MAX_FEED_BYTES) {
    throw new BadRequestException(
      `The feed is larger than the ${MAX_FEED_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const rows = parseFeedBody(body, contentType);

  if (rows.length > MAX_FEED_ROWS) {
    throw new BadRequestException(
      `The feed has ${rows.length} rows; the limit is ${MAX_FEED_ROWS} per sync.`,
    );
  }

  return { rows, contentType };
}
