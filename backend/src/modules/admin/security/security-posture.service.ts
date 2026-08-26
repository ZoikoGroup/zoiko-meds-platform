import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isOAuthConfigured } from '../../auth/guards/oauth.guard';

/**
 * One authentication control, as it actually stands.
 *
 * `enforced` is what the platform does, not what somebody would like it to do.
 * There is no setter: every control below is decided by server configuration or
 * by code, so a switch in the console could only ever misreport it.
 */
export interface SecurityControl {
  id: string;
  label: string;
  /** What the platform does about this, in a sentence an operator can act on. */
  detail: string;
  state: 'enforced' | 'available' | 'not-implemented';
  /** Where the answer is actually decided. */
  configuredBy: string;
}

/**
 * The workspace's authentication posture (MSA-42).
 *
 * The settings page carried three switches — "Enforce multi-factor
 * authentication", "SSO (SAML 2.0)", "IP allowlist" — wired to useState and
 * nothing else. Two of them showed on by default. Toggling changed a variable
 * that a reload discarded.
 *
 * None of the three exists in this platform: there is no MFA anywhere in the
 * auth module or the schema, no SAML, and no network restriction. Persisting
 * those flags would have been the worse fix of the two available, because a
 * stored "MFA enforced: on" that nothing reads is a control an operator will
 * report to an auditor and rely on in an incident.
 *
 * So this reports the controls the platform really has, the same way the
 * integrations page reports the services it really talks to, and names the
 * ones it does not have as absent rather than as switched off.
 */
@Injectable()
export class SecurityPostureService {
  constructor(private readonly config: ConfigService) {}

  list(): SecurityControl[] {
    return [
      this.passwordPolicy(),
      this.sessionLifetime(),
      ...this.singleSignOn(),
      this.multiFactor(),
      this.ipAllowlist(),
    ];
  }

  /** Enforced by the DTOs every password path validates against. */
  private passwordPolicy(): SecurityControl {
    return {
      id: 'password-policy',
      label: 'Password minimum length',
      detail:
        'Every sign-in, registration and password change requires at least 8 characters. Passwords are stored as bcrypt hashes.',
      state: 'enforced',
      configuredBy: 'Validation on the auth DTOs',
    };
  }

  private sessionLifetime(): SecurityControl {
    const expiry = this.config.get<string>('JWT_EXPIRES_IN', '3600s');
    return {
      id: 'session-lifetime',
      label: 'Session lifetime',
      detail: `Access tokens expire after ${expiry}. An expired token is rejected on the next request and the console signs the user out.`,
      state: 'enforced',
      configuredBy: 'JWT_EXPIRES_IN',
    };
  }

  /**
   * The SSO this platform has is OAuth against Google and Microsoft — not the
   * SAML 2.0 the old switch named. A provider with no client credentials is off,
   * and its sign-in button answers 503, so "available" is the honest word.
   */
  private singleSignOn(): SecurityControl[] {
    return (['GOOGLE', 'MICROSOFT'] as const).map((prefix) => {
      const configured = isOAuthConfigured(this.config, prefix);
      const name = prefix === 'GOOGLE' ? 'Google' : 'Microsoft';
      return {
        id: `sso-${prefix.toLowerCase()}`,
        label: `Single sign-on — ${name}`,
        detail: configured
          ? `Client credentials are set, so members can sign in with ${name}.`
          : `No client credentials, so the ${name} button answers 503 and only email sign-in works.`,
        state: configured ? ('available' as const) : ('not-implemented' as const),
        configuredBy: `${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET`,
      };
    });
  }

  private multiFactor(): SecurityControl {
    return {
      id: 'mfa',
      label: 'Multi-factor authentication',
      detail:
        'Not implemented. There is no second factor anywhere in the sign-in path, so this cannot be required of members yet.',
      state: 'not-implemented',
      configuredBy: 'Not available in this release',
    };
  }

  private ipAllowlist(): SecurityControl {
    return {
      id: 'ip-allowlist',
      label: 'IP allowlist',
      detail:
        'Not implemented. The API accepts requests from any address that reaches it; restrict this at your load balancer or firewall.',
      state: 'not-implemented',
      configuredBy: 'Network layer, outside the application',
    };
  }
}
