/**
 * Boot-time environment validation.
 *
 * Wired into ConfigModule.forRoot({ validate }). If the process starts with a
 * missing or unsafe configuration it fails fast with a clear message rather
 * than silently booting on insecure defaults (e.g. a placeholder JWT secret).
 */

/** Placeholder/known-weak secrets that must never reach a running instance. */
const FORBIDDEN_JWT_SECRETS = new Set([
  'change-me-in-production',
  'jwtsecretishere',
  'secret',
  'changeme',
  'dev-secret',
]);

const MIN_JWT_SECRET_LENGTH = 32;

export interface ValidatedEnv extends Record<string, unknown> {
  NODE_ENV: 'development' | 'test' | 'production';
  JWT_SECRET: string;
  DATABASE_URL: string;
}

export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const errors: string[] = [];

  const nodeEnv = String(config.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push(
      `NODE_ENV must be one of development|test|production (got "${nodeEnv}").`,
    );
  }
  const isProd = nodeEnv === 'production';

  // --- JWT_SECRET: required always; strong + non-placeholder in production ---
  const jwtSecret = String(config.JWT_SECRET ?? '');
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required.');
  } else if (FORBIDDEN_JWT_SECRETS.has(jwtSecret.toLowerCase())) {
    errors.push(
      'JWT_SECRET is set to a known placeholder value. Generate a strong random secret (e.g. `openssl rand -base64 48`).',
    );
  } else if (isProd && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production (got ${jwtSecret.length}).`,
    );
  }

  // --- DATABASE_URL ----------------------------------------------------------
  const databaseUrl = String(config.DATABASE_URL ?? '');
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required.');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a PostgreSQL connection string.');
  }

  // --- Public app URLs -------------------------------------------------------
  // Password-reset links, invites and the OAuth bounce all target APP_BASE_URL.
  // A wrong or missing value silently mails users to the wrong site, so the
  // format is checked here and a deployed instance must set a real host.
  const appBaseUrl = String(config.APP_BASE_URL ?? '').trim();
  if (appBaseUrl && !isAbsoluteHttpUrl(appBaseUrl)) {
    errors.push(
      `APP_BASE_URL must be an absolute http(s) URL of the ZoikoMeds app (got "${appBaseUrl}").`,
    );
  }
  const oauthRedirect = String(config.OAUTH_SUCCESS_REDIRECT ?? '').trim();
  if (oauthRedirect && !isAbsoluteHttpUrl(oauthRedirect)) {
    errors.push(
      `OAUTH_SUCCESS_REDIRECT must be an absolute http(s) URL (got "${oauthRedirect}").`,
    );
  }

  // --- Production-only guardrails --------------------------------------------
  if (isProd) {
    if (!appBaseUrl) {
      errors.push(
        'APP_BASE_URL is required in production — it is the host used for password reset links, invites and the OAuth redirect.',
      );
    } else if (isLoopbackUrl(appBaseUrl)) {
      errors.push(
        `APP_BASE_URL must not point at localhost in production (got "${appBaseUrl}").`,
      );
    }
    if (oauthRedirect && isLoopbackUrl(oauthRedirect)) {
      errors.push(
        `OAUTH_SUCCESS_REDIRECT must not point at localhost in production (got "${oauthRedirect}").`,
      );
    }
    const superAdminPassword = String(config.SUPER_ADMIN_PASSWORD ?? '');
    if (superAdminPassword === 'ChangeMe!SuperAdmin1') {
      errors.push(
        'SUPER_ADMIN_PASSWORD is still the sample value. Set a unique strong password before seeding production.',
      );
    }
    const corsOrigin = String(config.CORS_ORIGIN ?? '');
    if (corsOrigin.split(',').some((o) => o.trim() === '*')) {
      errors.push('CORS_ORIGIN must not be "*" in production.');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return { ...config, NODE_ENV: nodeEnv, JWT_SECRET: jwtSecret, DATABASE_URL: databaseUrl } as ValidatedEnv;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    // IPv6 hostnames come back bracketed ("[::1]") — compare the bare address.
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
