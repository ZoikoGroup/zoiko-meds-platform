import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';
import { OAuthProfile } from '../oauth-profile';

/**
 * Google OAuth 2.0 sign-in. Registered under the passport name `google`.
 *
 * Guarded by {@link GoogleOAuthGuard}, which returns a clean 503 when the
 * provider is not configured — so an empty client id here never produces a
 * broken redirect to Google.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      // Fallback keeps construction (and app boot) safe when unconfigured.
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret:
        config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:8000/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    const normalized: OAuthProfile = {
      provider: 'google',
      providerId: profile.id,
      email: email ?? '',
      fullName: profile.displayName || email || 'Google User',
    };
    done(null, normalized);
  }
}
