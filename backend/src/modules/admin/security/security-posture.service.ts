import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { isOAuthConfigured } from '../../auth/guards/oauth.guard';
import { isValidEntry } from './ip-allowlist';
import { UpdateSecurityPolicyDto } from './update-security-policy.dto';

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
  /**
   * The policy key this control is set by, when the console can set it. Absent
   * where the answer lives in server configuration or in code, which is what
   * stops the page rendering a switch that could only misreport.
   */
  setting?: 'requireMfa' | 'ipAllowlistEnabled' | 'allowOauthSignIn';
  /** Current value of that setting. Only present alongside `setting`. */
  enabled?: boolean;
}

export interface SecurityPolicy {
  requireMfa: boolean;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  allowOauthSignIn: boolean;
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
/** The one Organization row every policy lives on. */
const SINGLETON_ID = 'singleton';

const DEFAULT_POLICY: SecurityPolicy = {
  requireMfa: false,
  ipAllowlistEnabled: false,
  ipAllowlist: [],
  allowOauthSignIn: true,
};

@Injectable()
export class SecurityPostureService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async policy(): Promise<SecurityPolicy> {
    const row = await this.prisma.organization.findUnique({
      where: { id: SINGLETON_ID },
      select: {
        requireMfa: true,
        ipAllowlistEnabled: true,
        ipAllowlist: true,
        allowOauthSignIn: true,
      },
    });
    return row ?? DEFAULT_POLICY;
  }

  async update(
    actorId: string | null,
    dto: UpdateSecurityPolicyDto,
    ipAddress?: string,
  ): Promise<{ policy: SecurityPolicy; controls: SecurityControl[] }> {
    const current = await this.policy();

    // Validated here rather than only in the DTO, because a syntactically fine
    // string can still be a range that matches nothing, and an entry that never
    // matches is indistinguishable from an allowlist that is simply wrong.
    if (dto.ipAllowlist) {
      const bad = dto.ipAllowlist.filter((entry) => !isValidEntry(entry));
      if (bad.length > 0) {
        throw new BadRequestException(
          `Not an address or CIDR range: ${bad.join(', ')}`,
        );
      }
    }

    const nextEnabled = dto.ipAllowlistEnabled ?? current.ipAllowlistEnabled;
    const nextList = dto.ipAllowlist ?? current.ipAllowlist;
    // Refused rather than silently allowed: switching the allowlist on with
    // nothing in it reads as "restricted" on the page while the guard, quite
    // correctly, lets everything through. The two must not disagree.
    if (nextEnabled && nextList.length === 0) {
      throw new BadRequestException(
        'Add at least one address or range before switching the allowlist on.',
      );
    }

    const data = {
      ...(dto.requireMfa !== undefined ? { requireMfa: dto.requireMfa } : {}),
      ...(dto.ipAllowlistEnabled !== undefined
        ? { ipAllowlistEnabled: dto.ipAllowlistEnabled }
        : {}),
      ...(dto.ipAllowlist !== undefined
        ? { ipAllowlist: dto.ipAllowlist.map((entry) => entry.trim()) }
        : {}),
      ...(dto.allowOauthSignIn !== undefined
        ? { allowOauthSignIn: dto.allowOauthSignIn }
        : {}),
      updatedById: actorId,
    };

    await this.prisma.organization.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, name: 'ZoikoMeds', slug: 'zoikomeds', ...data },
    });

    await this.audit.write(
      actorId,
      'admin.security.update',
      'Organization',
      SINGLETON_ID,
      { fields: Object.keys(dto), module: 'Settings' },
      ipAddress,
    );

    return { policy: await this.policy(), controls: await this.list() };
  }

  async list(): Promise<SecurityControl[]> {
    const policy = await this.policy();
    return [
      this.passwordPolicy(),
      this.sessionLifetime(),
      this.multiFactor(policy),
      this.ipAllowlist(policy),
      this.oauthSignIn(policy),
      ...this.singleSignOn(),
      this.saml(),
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

  /** Enforced in AuthService.login against each account's enrolment. */
  private multiFactor(policy: SecurityPolicy): SecurityControl {
    return {
      id: 'mfa',
      label: 'Require two-factor authentication',
      detail: policy.requireMfa
        ? 'Every password sign-in must present a code from an authenticator app. A member who has not enrolled is refused a session and told to set it up.'
        : 'Members may enrol an authenticator app, but sign-in does not require one. Switching this on refuses a session to anyone who has not enrolled.',
      state: policy.requireMfa ? 'enforced' : 'available',
      configuredBy: 'This page',
      setting: 'requireMfa',
      enabled: policy.requireMfa,
    };
  }

  /** Enforced by IpAllowlistGuard on every request except the health probes. */
  private ipAllowlist(policy: SecurityPolicy): SecurityControl {
    const count = policy.ipAllowlist.length;
    return {
      id: 'ip-allowlist',
      label: 'IP allowlist',
      detail: policy.ipAllowlistEnabled
        ? `Only requests from ${count} approved ${count === 1 ? 'range' : 'ranges'} are accepted. Health probes are always answered, so a wrong entry cannot take the service out of its load balancer.`
        : 'The API accepts requests from any address that reaches it. Add ranges and switch this on to restrict it.',
      state: policy.ipAllowlistEnabled ? 'enforced' : 'available',
      configuredBy: 'This page',
      setting: 'ipAllowlistEnabled',
      enabled: policy.ipAllowlistEnabled,
    };
  }

  /** Enforced in AuthService.oauthLogin, after the provider has answered. */
  private oauthSignIn(policy: SecurityPolicy): SecurityControl {
    return {
      id: 'oauth-sign-in',
      label: 'Allow single sign-on',
      detail: policy.allowOauthSignIn
        ? 'Members may sign in with any identity provider configured below.'
        : 'Single sign-on is refused for this workspace even where a provider is configured, so only email and password work.',
      state: policy.allowOauthSignIn ? 'enforced' : 'available',
      configuredBy: 'This page',
      setting: 'allowOauthSignIn',
      enabled: policy.allowOauthSignIn,
    };
  }

  /**
   * Named explicitly because the switch this page used to carry said "SSO (SAML
   * 2.0)", and the sign-on above is OAuth. Leaving that unsaid would let the
   * two be read as the same thing.
   */
  private saml(): SecurityControl {
    return {
      id: 'saml',
      label: 'SAML 2.0',
      detail:
        'Not implemented. Single sign-on here is OAuth against Google and Microsoft; there is no SAML service provider, so an IdP that only speaks SAML cannot be connected.',
      state: 'not-implemented',
      configuredBy: 'Not available in this release',
    };
  }
}
