import { validateEnv } from './env.validation';

const STRONG_SECRET = 'x'.repeat(40);
const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_SECRET: STRONG_SECRET,
};

// A production config that clears every prod-only guardrail; specs override the
// one field under test.
const prodBase = {
  ...base,
  NODE_ENV: 'production',
  SUPER_ADMIN_PASSWORD: 'a-unique-strong-password',
  APP_BASE_URL: 'https://app.example.com',
};

describe('validateEnv', () => {
  it('accepts a valid development config', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });

  it('accepts a valid production config', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        CORS_ORIGIN: 'https://app.example.com',
      }),
    ).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET is required/);
  });

  it.each(['change-me-in-production', 'jwtsecretishere', 'secret', 'CHANGEME'])(
    'rejects the known placeholder secret %p in any environment',
    (secret) => {
      expect(() => validateEnv({ ...base, JWT_SECRET: secret })).toThrow(/placeholder/);
    },
  );

  it('rejects a short JWT_SECRET in production', () => {
    expect(() =>
      validateEnv({ ...base, JWT_SECRET: 'short-but-not-placeholder', NODE_ENV: 'production' }),
    ).toThrow(/at least 32 characters/);
  });

  it('rejects a missing/non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL is required/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x/y' })).toThrow(
      /must be a PostgreSQL/,
    );
  });

  it('rejects the sample super-admin password in production', () => {
    expect(() =>
      validateEnv({ ...prodBase, SUPER_ADMIN_PASSWORD: 'ChangeMe!SuperAdmin1' }),
    ).toThrow(/SUPER_ADMIN_PASSWORD/);
  });

  it('rejects wildcard CORS in production', () => {
    expect(() =>
      validateEnv({ ...prodBase, CORS_ORIGIN: 'https://app.example.com,*' }),
    ).toThrow(/CORS_ORIGIN must not be/);
  });

  it('rejects a non-absolute APP_BASE_URL in any environment', () => {
    expect(() => validateEnv({ ...base, APP_BASE_URL: 'app.zoikomeds.com' })).toThrow(
      /APP_BASE_URL must be an absolute http\(s\) URL/,
    );
  });

  it('requires APP_BASE_URL in production', () => {
    expect(() => validateEnv({ ...prodBase, APP_BASE_URL: '' })).toThrow(
      /APP_BASE_URL is required in production/,
    );
  });

  it('rejects a localhost APP_BASE_URL in production', () => {
    expect(() =>
      validateEnv({ ...prodBase, APP_BASE_URL: 'http://localhost:5173' }),
    ).toThrow(/APP_BASE_URL must not point at localhost/);
  });

  it('rejects an invalid or localhost OAUTH_SUCCESS_REDIRECT', () => {
    expect(() => validateEnv({ ...base, OAUTH_SUCCESS_REDIRECT: '/auth/callback' })).toThrow(
      /OAUTH_SUCCESS_REDIRECT must be an absolute http\(s\) URL/,
    );
    expect(() =>
      validateEnv({
        ...prodBase,
        OAUTH_SUCCESS_REDIRECT: 'http://localhost:5173/auth/callback',
      }),
    ).toThrow(/OAUTH_SUCCESS_REDIRECT must not point at localhost/);
  });

  it('accepts APP_BASE_URL with a trailing slash', () => {
    expect(() =>
      validateEnv({ ...prodBase, APP_BASE_URL: 'https://app.zoikomeds.com/' }),
    ).not.toThrow();
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
