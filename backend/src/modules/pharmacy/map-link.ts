import { BadRequestException } from '@nestjs/common';

/**
 * Read coordinates out of a Google Maps link.
 *
 * The client parses full URLs on its own; this exists for the share links the
 * Maps mobile app produces (maps.app.goo.gl/…), which carry no coordinates at
 * all — they are redirects, and a browser cannot follow them cross-origin.
 *
 * Only Google's own hosts are ever fetched. The URL arrives from a logged-in
 * pharmacy operator, so without that allowlist this endpoint would be an
 * open request-forwarder pointed at whatever the caller supplies.
 */

const ALLOWED_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
]);

function isAllowedGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  return /^(?:[a-z0-9-]+\.)?google\.(?:com?\.)?[a-z]{2,3}$/.test(host);
}

/** Give up rather than hang the request on a slow redirect chain. */
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;

/** Same precedence as the client parser: the pin (3d/4d) beats the viewport (@). */
const PATTERNS = [
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /[?&](?:q|query|ll|destination|center|daddr|sll)=(-?\d+(?:\.\d+)?)%2C\s*(-?\d+(?:\.\d+)?)/i,
  /[?&](?:q|query|ll|destination|center|daddr|sll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  /\/(?:place|dir)\/(?:[^/]*\/)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
];

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function valid(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Coordinates embedded in `text`, or null. */
export function coordinatesFrom(text: string): Coordinates | null {
  if (!text) return null;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* keep the raw text */
  }
  for (const pattern of PATTERNS) {
    for (const candidate of [decoded, text]) {
      const m = candidate.match(pattern);
      if (!m) continue;
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) {
        return {
          latitude: Math.round(lat * 1e7) / 1e7,
          longitude: Math.round(lng * 1e7) / 1e7,
        };
      }
    }
  }
  return null;
}

/** Throws unless `raw` is an http(s) URL on a Google Maps host. */
function assertAllowed(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('That does not look like a link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('Only http(s) links are supported.');
  }
  if (!isAllowedGoogleHost(url.hostname)) {
    throw new BadRequestException('Paste a Google Maps link.');
  }
  return url;
}

/**
 * Follow a Maps share link until its coordinates appear.
 *
 * Redirects are followed one hop at a time, re-checking the host each time, so
 * an open redirect on a Google domain cannot walk this off to another server.
 */
export async function resolveMapLink(raw: string): Promise<Coordinates> {
  // Host first, always. Parsing before this would accept coordinates out of
  // any URL that happens to contain "@lat,lng" — no request is made, so it is
  // not SSRF, but the endpoint would be quietly reading locations out of
  // non-Google links while claiming to accept Maps links only.
  let current = assertAllowed(raw);

  // An allowed long-form URL answers without any network call at all.
  const direct = coordinatesFrom(raw);
  if (direct) return direct;

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Maps serves a coordinate-bearing page to a browser UA and a bare
        // interstitial to anything else.
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZoikoMeds/1.0)' },
      });
    } catch {
      throw new BadRequestException('Could not open that link. Check it and try again.');
    }

    const location = response.headers.get('location');
    if (location) {
      const next = new URL(location, current);
      current = assertAllowed(next.toString());
      const fromLocation = coordinatesFrom(current.toString());
      if (fromLocation) return fromLocation;
      continue;
    }

    // Final hop: the coordinates are in the URL we landed on, or in the body.
    const fromUrl = coordinatesFrom(current.toString());
    if (fromUrl) return fromUrl;

    const body = await response.text().catch(() => '');
    const fromBody = coordinatesFrom(body);
    if (fromBody) return fromBody;
    break;
  }

  throw new BadRequestException(
    'No location found in that link. Open the place in Google Maps and copy the link again.',
  );
}
