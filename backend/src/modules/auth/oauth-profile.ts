/**
 * Normalized identity handed from an OAuth strategy to {@link AuthService}.
 * Every provider strategy maps its raw profile onto this shape so the login
 * upsert logic stays provider-agnostic.
 */
export interface OAuthProfile {
  provider: 'google' | 'microsoft';
  providerId: string;
  email: string;
  fullName: string;
}

/** Providers we support, for config lookups and clean error messages. */
export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];
