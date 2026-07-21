import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-microsoft';
import { OAuthProfile } from '../oauth-profile';

/**
 * Microsoft / Azure AD OAuth 2.0 sign-in. Registered under the passport name
 * `microsoft`. Works with both work/school (Azure AD) and personal accounts
 * depending on the configured tenant (`common` by default).
 *
 * Guarded by {@link MicrosoftOAuthGuard}, which returns a clean 503 when the
 * provider is not configured.
 */
@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('MICROSOFT_CLIENT_ID') || 'not-configured',
      clientSecret:
        config.get<string>('MICROSOFT_CLIENT_SECRET') || 'not-configured',
      callbackURL:
        config.get<string>('MICROSOFT_CALLBACK_URL') ||
        'http://localhost:8000/api/auth/microsoft/callback',
      tenant: config.get<string>('MICROSOFT_TENANT') || 'common',
      scope: ['user.read'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email =
      profile.emails?.[0]?.value ||
      (profile._json?.mail as string | undefined) ||
      (profile._json?.userPrincipalName as string | undefined);
    const normalized: OAuthProfile = {
      provider: 'microsoft',
      providerId: profile.id,
      email: email ?? '',
      fullName: profile.displayName || email || 'Microsoft User',
    };
    done(null, normalized);
  }
}
