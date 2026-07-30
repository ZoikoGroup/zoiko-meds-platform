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

/** Origin of the SPA, e.g. `https://app.zoikomeds.com`. No trailing slash. */
export function appBaseUrl(config: ConfigService): string {
  return normalizeBaseUrl(
    config.get<string>('APP_BASE_URL') || DEFAULT_APP_BASE_URL,
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
