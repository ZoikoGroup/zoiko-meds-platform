import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { APP_OAUTH_STATE, mobileOAuthRedirect } from '../../../config/mobile-app';

/**
 * Returns true only when both the client id and secret for a provider are set.
 * Used by the OAuth guards to fail fast (503) instead of bouncing the user to a
 * broken provider consent screen built from placeholder credentials.
 */
export function isOAuthConfigured(config: ConfigService, prefix: 'GOOGLE'): boolean {
  return Boolean(
    config.get<string>(`${prefix}_CLIENT_ID`) &&
      config.get<string>(`${prefix}_CLIENT_SECRET`),
  );
}

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!isOAuthConfigured(this.config, 'GOOGLE')) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server',
      );
    }
    return super.canActivate(context);
  }

  /**
   * `GET /auth/google?client=app` marks a sign-in started from the Android app.
   * The marker rides through Google as the OAuth `state` (a fixed value, never
   * anything taken from the caller) so the callback knows to hand the session
   * back to the app. Used only when the app redirect is configured.
   */
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.query?.client === 'app' && mobileOAuthRedirect(this.config)) {
      return { state: APP_OAUTH_STATE };
    }
    return undefined;
  }
}
