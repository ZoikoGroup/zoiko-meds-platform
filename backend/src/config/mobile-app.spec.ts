import { ConfigService } from '@nestjs/config';
import {
  invalidMobileAppOrigins,
  isValidMobileOAuthRedirect,
  mobileAppOrigins,
  mobileOAuthRedirect,
} from './mobile-app';
import { validateEnv } from './env.validation';

const cfg = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
};

describe('Android app settings', () => {
  describe('MOBILE_APP_ORIGINS', () => {
    it('accepts only the origins a Capacitor WebView reports', () => {
      expect(invalidMobileAppOrigins('https://localhost, capacitor://localhost')).toEqual([]);
      expect(invalidMobileAppOrigins('https://localhost,https://evil.example')).toEqual([
        'https://evil.example',
      ]);
      // A lookalike must not slip through a prefix or substring check.
      expect(invalidMobileAppOrigins('https://localhost.evil.example')).toEqual([
        'https://localhost.evil.example',
      ]);
    });

    it('is rejected at boot when it names anything else', () => {
      expect(() => validateEnv({ ...baseEnv, MOBILE_APP_ORIGINS: 'https://app.zoikomeds.com' })).toThrow(
        /MOBILE_APP_ORIGINS/,
      );
      expect(() => validateEnv({ ...baseEnv, MOBILE_APP_ORIGINS: 'https://localhost' })).not.toThrow();
    });

    it('never widens CORS even if validation were bypassed', () => {
      expect(mobileAppOrigins(cfg({ MOBILE_APP_ORIGINS: 'https://localhost,*' }))).toEqual([
        'https://localhost',
      ]);
      expect(mobileAppOrigins(cfg({}))).toEqual([]);
    });
  });

  describe('MOBILE_OAUTH_REDIRECT', () => {
    it("must be the app's own scheme and exact callback path", () => {
      expect(isValidMobileOAuthRedirect('com.zoikomeds.app://auth/callback')).toBe(true);
      // An http(s) target would be an open redirect carrying a session token.
      expect(isValidMobileOAuthRedirect('https://evil.example/auth/callback')).toBe(false);
      expect(isValidMobileOAuthRedirect('javascript://auth/callback')).toBe(false);
      expect(isValidMobileOAuthRedirect('com.zoikomeds.app://evil/callback')).toBe(false);
      expect(isValidMobileOAuthRedirect('com.zoikomeds.app://auth/other')).toBe(false);
    });

    it('is off unless configured, and ignores an invalid value', () => {
      expect(mobileOAuthRedirect(cfg({}))).toBeNull();
      expect(mobileOAuthRedirect(cfg({ MOBILE_OAUTH_REDIRECT: 'https://x.example/auth/callback' }))).toBeNull();
      expect(mobileOAuthRedirect(cfg({ MOBILE_OAUTH_REDIRECT: 'com.zoikomeds.app://auth/callback' }))).toBe(
        'com.zoikomeds.app://auth/callback',
      );
    });

    it('is rejected at boot when it is not an app scheme', () => {
      expect(() =>
        validateEnv({ ...baseEnv, MOBILE_OAUTH_REDIRECT: 'https://app.zoikomeds.com/auth/callback' }),
      ).toThrow(/MOBILE_OAUTH_REDIRECT/);
    });
  });
});
