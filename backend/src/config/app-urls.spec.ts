import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_APP_BASE_URL,
  appBaseUrl,
  appBaseUrlWarning,
  appUrl,
  oauthSuccessRedirect,
  withQueryParam,
} from './app-urls';

/** Minimal ConfigService stand-in: only `get(key)` is used by these helpers. */
function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('app-urls', () => {
  it('falls back to the Vite dev server when APP_BASE_URL is unset', () => {
    expect(appBaseUrl(configOf({}))).toBe(DEFAULT_APP_BASE_URL);
  });

  it('strips trailing slashes and surrounding whitespace', () => {
    const config = configOf({ APP_BASE_URL: '  https://app.zoikomeds.com//  ' });
    expect(appBaseUrl(config)).toBe('https://app.zoikomeds.com');
    expect(appUrl(config, '/reset-password')).toBe(
      'https://app.zoikomeds.com/reset-password',
    );
  });

  it('derives the OAuth redirect from the app host when unset', () => {
    const config = configOf({ APP_BASE_URL: 'https://app.zoikomeds.com' });
    expect(oauthSuccessRedirect(config)).toBe(
      'https://app.zoikomeds.com/auth/callback',
    );
  });

  it('prefers an explicit OAUTH_SUCCESS_REDIRECT', () => {
    const config = configOf({
      APP_BASE_URL: 'https://app.zoikomeds.com',
      OAUTH_SUCCESS_REDIRECT: 'https://portal.zoikomeds.com/auth/callback',
    });
    expect(oauthSuccessRedirect(config)).toBe(
      'https://portal.zoikomeds.com/auth/callback',
    );
  });

  it('ignores a blank OAUTH_SUCCESS_REDIRECT', () => {
    const config = configOf({
      APP_BASE_URL: 'https://app.zoikomeds.com',
      OAUTH_SUCCESS_REDIRECT: '   ',
    });
    expect(oauthSuccessRedirect(config)).toBe(
      'https://app.zoikomeds.com/auth/callback',
    );
  });

  it('appends the token without breaking an existing query string', () => {
    expect(withQueryParam('https://app.zoikomeds.com/auth/callback', 'token', 'a b')).toBe(
      'https://app.zoikomeds.com/auth/callback?token=a%20b',
    );
    expect(
      withQueryParam('https://app.zoikomeds.com/auth/callback?next=/saved', 'token', 'jwt'),
    ).toBe('https://app.zoikomeds.com/auth/callback?next=/saved&token=jwt');
  });
});

describe('an APP_BASE_URL that does not serve the SPA (MP-47)', () => {
  // The reported failure: paying redirected the pharmacy to
  // https://get.zoikomeds.com/pharmacy/billing, where the API answers
  // {"statusCode":404,"message":"Cannot GET /pharmacy/billing"}. The API host is
  // not in CORS_ORIGIN, because the SPA is not served from it.
  const misconfigured = {
    APP_BASE_URL: 'https://get.zoikomeds.com',
    CORS_ORIGIN: 'https://app.zoikomeds.com,http://localhost:5173',
  };

  it('uses the origin the SPA is actually served from', () => {
    expect(appBaseUrl(configOf(misconfigured))).toBe('https://app.zoikomeds.com');
  });

  it('builds the payment return URL against that origin', () => {
    expect(appUrl(configOf(misconfigured), '/pharmacy/billing')).toBe(
      'https://app.zoikomeds.com/pharmacy/billing',
    );
  });

  it('says what it did and why, for the boot log', () => {
    const warning = appBaseUrlWarning(configOf(misconfigured));

    expect(warning).toMatch(/get\.zoikomeds\.com/);
    expect(warning).toMatch(/app\.zoikomeds\.com is being used instead/);
  });

  it('skips a loopback origin when choosing the replacement', () => {
    // A deployed API whose only other allowed origin is localhost cannot be
    // repaired by guessing; localhost would be worse than the configured value.
    const config = configOf({
      APP_BASE_URL: 'https://get.zoikomeds.com',
      CORS_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173',
    });

    expect(appBaseUrl(config)).toBe('https://get.zoikomeds.com');
  });

  it('keeps APP_BASE_URL when it is one of the allowed origins', () => {
    const config = configOf({
      APP_BASE_URL: 'https://app.zoikomeds.com',
      CORS_ORIGIN: 'https://app.zoikomeds.com,http://localhost:5173',
    });

    expect(appBaseUrl(config)).toBe('https://app.zoikomeds.com');
    expect(appBaseUrlWarning(config)).toBeNull();
  });

  it('matches on origin, so a path or trailing slash does not count as a mismatch', () => {
    const config = configOf({
      APP_BASE_URL: 'https://app.zoikomeds.com/',
      CORS_ORIGIN: 'https://app.zoikomeds.com',
    });

    expect(appBaseUrl(config)).toBe('https://app.zoikomeds.com');
    expect(appBaseUrlWarning(config)).toBeNull();
  });

  it('trusts APP_BASE_URL when no origins are configured to check it against', () => {
    // Local development sets no CORS_ORIGIN; inventing a rule there would break
    // every developer's environment to fix a deployment's.
    const config = configOf({ APP_BASE_URL: 'https://app.zoikomeds.com' });

    expect(appBaseUrl(config)).toBe('https://app.zoikomeds.com');
    expect(appBaseUrlWarning(config)).toBeNull();
  });

  it('warns when APP_BASE_URL is unset, naming the fallback', () => {
    expect(appBaseUrlWarning(configOf({}))).toMatch(/not set/i);
    expect(appBaseUrl(configOf({}))).toBe(DEFAULT_APP_BASE_URL);
  });

  it('leaves the dev default alone when it is an allowed origin', () => {
    const config = configOf({
      APP_BASE_URL: 'http://localhost:5173',
      CORS_ORIGIN: 'http://localhost:5173,http://localhost:5174',
    });

    expect(appBaseUrl(config)).toBe('http://localhost:5173');
  });
});
