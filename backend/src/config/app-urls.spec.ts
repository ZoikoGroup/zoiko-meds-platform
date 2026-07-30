import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_APP_BASE_URL,
  appBaseUrl,
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
