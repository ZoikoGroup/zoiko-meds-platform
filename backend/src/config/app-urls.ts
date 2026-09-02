/**
 * Public app URLs used by anything that hands a link to a browser or an inbox.
 *
 * Every outbound link (password reset, invite, notification deep link) and the
 * OAuth success bounce must land on the domain that serves the ZoikoMeds SPA —
 * never the marketing site and never localhost in a deployed environment. That
 * host lives in one place, `APP_BASE_URL`, and is read only through the helpers
 * below so the three call sites cannot drift apart.
 */

import type { ConfigService } from '@nestjs/config';

/** Dev-only fallback: the Vite dev server. Production must set APP_BASE_URL. */
export const DEFAULT_APP_BASE_URL = 'http://localhost:5173';

/** Path inside the SPA that finishes the OAuth browser flow. */
export const OAUTH_CALLBACK_PATH = '/auth/callback';

/** Trim whitespace and any trailing slashes so `${base}${path}` is safe. */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Origins the API accepts browser requests from, i.e. where the SPA is served. */
function allowedOrigins(config: ConfigService): string[] {
  return (config.get<string>('CORS_ORIGIN') || '')
    .split(',')
    .map((origin) => normalizeBaseUrl(origin))
    .filter(Boolean);
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const isLoopback = (value: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(value);

/**
 * Origin of the SPA, e.g. `https://app.zoikomeds.com`. No trailing slash.
 *
 * APP_BASE_URL is the answer whenever it names a host this API actually serves
 * the SPA to — which is exactly the set in CORS_ORIGIN, since a browser on that
 * origin could not call this API otherwise.
 *
 * When it names anything else, it is not usable and is not used. Pointed at the
 * API's own origin, every link built from it lands on a JSON 404 instead of a
 * page: password resets, invites, and the page a pharmacy is returned to after
 * paying (MP-47). CORS_ORIGIN already holds the right host in that situation, so
 * the first non-loopback entry is used instead of knowingly producing a dead link.
 *
 * Deliberately not clever about which entry: a single wrong link is recoverable,
 * and the alternative is a deployment where nothing sent to a browser works.
 */
export function appBaseUrl(config: ConfigService): string {
  const configured = normalizeBaseUrl(config.get<string>('APP_BASE_URL') || '');
  const allowed = allowedOrigins(config);

  if (configured) {
    const configuredOrigin = originOf(configured);
    const servesTheSpa =
      allowed.length === 0 ||
      allowed.some((origin) => originOf(origin) === configuredOrigin);
    if (servesTheSpa) return configured;

    const usable = allowed.find((origin) => !isLoopback(origin));
    if (usable) return usable;
  }

  return configured || DEFAULT_APP_BASE_URL;
}

/**
 * Why appBaseUrl did not use APP_BASE_URL, or null when it did.
 *
 * Returned rather than logged from inside the resolver: it is called on every
 * link, and the warning belongs once at boot where somebody will read it.
 */
export function appBaseUrlWarning(config: ConfigService): string | null {
  const configured = normalizeBaseUrl(config.get<string>('APP_BASE_URL') || '');
  if (!configured) {
    return `APP_BASE_URL is not set, so browser links fall back to ${DEFAULT_APP_BASE_URL}. Set it to the origin that serves the SPA.`;
  }

  const resolved = appBaseUrl(config);
  if (resolved === configured) return null;

  return (
    `APP_BASE_URL is set to ${configured}, which is not an origin this API serves the SPA to ` +
    `(CORS_ORIGIN). Browser links would land on a 404, so ${resolved} is being used instead. ` +
    'Correct APP_BASE_URL: every outbound link, and the page a pharmacy returns to after paying, is built from it.'
  );
}

/** Absolute SPA URL for `path` (which must start with `/`). */
export function appUrl(config: ConfigService, path: string): string {
  return `${appBaseUrl(config)}${path}`;
}

/**
 * Where the OAuth callback sends the browser once a session is issued.
 * `OAUTH_SUCCESS_REDIRECT` overrides it; otherwise the SPA's callback route.
 */
export function oauthSuccessRedirect(config: ConfigService): string {
  const configured = config.get<string>('OAUTH_SUCCESS_REDIRECT')?.trim();
  return configured || appUrl(config, OAUTH_CALLBACK_PATH);
}

/**
 * Append `token` to a redirect target, preserving any query string the target
 * already carries (a naive `?token=` would produce a second `?` and break it).
 */
export function withQueryParam(
  target: string,
  key: string,
  value: string,
): string {
  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}${key}=${encodeURIComponent(value)}`;
}
