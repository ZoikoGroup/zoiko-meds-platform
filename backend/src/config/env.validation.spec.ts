import { validateEnv } from './env.validation';

const STRONG_SECRET = 'x'.repeat(40);
const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_SECRET: STRONG_SECRET,
};

describe('validateEnv', () => {
  it('accepts a valid development config', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });

  it('accepts a valid production config', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        SUPER_ADMIN_PASSWORD: 'a-unique-strong-password',
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
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        SUPER_ADMIN_PASSWORD: 'ChangeMe!SuperAdmin1',
      }),
    ).toThrow(/SUPER_ADMIN_PASSWORD/);
  });

  it('rejects wildcard CORS in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        SUPER_ADMIN_PASSWORD: 'unique-strong',
        CORS_ORIGIN: 'https://app.example.com,*',
      }),
    ).toThrow(/CORS_ORIGIN must not be/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
