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

// Assisted reading (prescription scan). Optional by design: a deployment
// without a key is a valid deployment, and the scan surface simply does not
// offer the fallback. Only a value that is present and malformed is an error,
// because that is a typo somebody meant to work.
describe('validateEnv — scan assisted reading', () => {
  it('accepts a config with no vision settings at all', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('does not require an API key, even in production', () => {
    // Hard-failing the whole API over an optional fallback would take the
    // platform down for a feature it can run perfectly well without.
    expect(() => validateEnv({ ...prodBase })).not.toThrow();
  });

  it('accepts a fully configured vision setup', () => {
    expect(() =>
      validateEnv({
        ...base,
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
        SCAN_VISION_ENABLED: 'true',
        SCAN_VISION_MODEL: 'claude-opus-5',
      }),
    ).not.toThrow();
  });

  it('accepts the feature being switched off explicitly', () => {
    expect(() => validateEnv({ ...base, SCAN_VISION_ENABLED: 'false' })).not.toThrow();
  });

  it('rejects a SCAN_VISION_ENABLED that is neither true nor false', () => {
    expect(() => validateEnv({ ...base, SCAN_VISION_ENABLED: 'yes' })).toThrow(
      /SCAN_VISION_ENABLED must be "true" or "false"/,
    );
  });

  it('rejects a model name that is only whitespace', () => {
    expect(() => validateEnv({ ...base, SCAN_VISION_MODEL: '   ' })).toThrow(
      /SCAN_VISION_MODEL must name a model/,
    );
  });

  it('rejects an API key that is only whitespace', () => {
    expect(() => validateEnv({ ...base, ANTHROPIC_API_KEY: '   ' })).toThrow(
      /ANTHROPIC_API_KEY is set to whitespace/,
    );
  });

  it('never echoes the key into the error message', () => {
    // An invalid value must not be quoted back the way other settings are —
    // errors reach logs.
    const secret = 'sk-ant-super-secret-value';
    try {
      validateEnv({ ...base, ANTHROPIC_API_KEY: secret, SCAN_VISION_ENABLED: 'nope' });
      throw new Error('expected validation to fail');
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
