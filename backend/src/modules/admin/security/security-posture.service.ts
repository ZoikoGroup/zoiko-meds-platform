import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { isOAuthConfigured } from '../../auth/guards/oauth.guard';
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
  setting?: 'requireMfa' | 'allowOauthSignIn';
  /** Current value of that setting. Only present alongside `setting`. */
  enabled?: boolean;
}

export interface SecurityPolicy {
  requireMfa: boolean;
  allowOauthSignIn: boolean;
}

/**
 * Who would still be able to sign in if MFA were required right now.
 *
 * Reported alongside the policy so the console can answer the question the
 * switch really asks — "who does this shut out?" — before it is thrown, rather
 * than afterwards through a support ticket.
 *
 * Administrators only, because the policy reaches administrators only. It used
 * to reach every account, which made this switch able to turn every patient and
 * every pharmacy out of the platform: none of them have anywhere to enrol an
 * authenticator, and none of them could get a session in which to try. They
 * have the emailed sign-in link instead, opt-in and their own to set, and this
 * policy does not touch them.
 *
 * Password accounts only, on top of that: OAuth sign-in does not consult the
 * policy, so an account without a password is not one this rule can shut out.
 */
export interface MfaReadiness {
  /** Whether the admin reading this has confirmed an authenticator of their own. */
  actorEnrolled: boolean;
  /** Active administrators who sign in with a password. */
  passwordMembers: number;
  /** How many of those have confirmed a second factor. */
  enrolledMembers: number;
}

/**
 * The workspace's authentication posture (MSA-42).
 *
 * The settings page carried three switches — "Enforce multi-factor
 * authentication", "SSO (SAML 2.0)", "IP allowlist" — wired to useState and
 * nothing else. Two of them showed on by default. Toggling changed a variable
 * that a reload discarded.
 *
 * So this reports the controls the platform really has, the same way the
 * integrations page reports the services it really talks to, and names the
 * ones it does not have as absent rather than as switched off.
 *
 * The IP allowlist has since been withdrawn. It worked, which was the problem:
 * an operator saved a subnet mask as though it were a range, switched it on,
 * and locked every request out of the workspace including their own — the one
 * account that could have switched it back off. A control whose failure mode is
 * losing the console is not one to leave behind a toggle, so the guard, the
 * columns and the editor are gone rather than guarded more carefully. Restrict
 * by network at the load balancer, where being locked out does not also mean
 * being unable to undo it.
 */
/** The one Organization row every policy lives on. */
const SINGLETON_ID = 'singleton';

/**
 * Exactly the accounts AuthService.login applies the policy to: active
 * administrators who sign in with a password.
 */
const ADMINS_THE_POLICY_REACHES = {
  isActive: true,
  role: UserRole.SUPER_ADMIN,
  passwordHash: { not: null },
} as const;

const DEFAULT_POLICY: SecurityPolicy = {
  requireMfa: false,
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
        allowOauthSignIn: true,
      },
    });
    return row ?? DEFAULT_POLICY;
  }

  async update(
    actorId: string | null,
    dto: UpdateSecurityPolicyDto,
    ipAddress?: string,
  ): Promise<{
    policy: SecurityPolicy;
    controls: SecurityControl[];
    mfa: MfaReadiness;
  }> {
    // Checked before the write, not after: the switch that turns MFA on is the
    // one control here whose failure mode is losing the console, exactly as the
    // withdrawn IP allowlist's was. An admin who has not enrolled would be
    // refused by the rule they just wrote, on their own next sign-in, with
    // nobody left holding a session that could undo it.
    if (dto.requireMfa === true) await this.assertActorHasSecondFactor(actorId);

    const data = {
      ...(dto.requireMfa !== undefined ? { requireMfa: dto.requireMfa } : {}),
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

    return this.posture(actorId);
  }

  /**
   * Everything the settings page needs in one read.
   *
   * The same shape `update` answers with, so a save and a first load leave the
   * page holding the same thing.
   */
  async posture(actorId: string | null): Promise<{
    policy: SecurityPolicy;
    controls: SecurityControl[];
    mfa: MfaReadiness;
  }> {
    return {
      policy: await this.policy(),
      controls: await this.list(),
      mfa: await this.mfaReadiness(actorId),
    };
  }

  /**
   * Refuse to require a second factor of everyone at the hands of an admin who
   * has not got one.
   *
   * This is the whole reason the switch sat inert. Enforcement itself has
   * worked since MSA-42 landed, but nothing stopped the one account that could
   * switch it back off from writing itself out of its own workspace, and in
   * production that is what happened. The recovery was a hand-written UPDATE
   * against the database.
   */
  private async assertActorHasSecondFactor(actorId: string | null): Promise<void> {
    if (!actorId) {
      throw new BadRequestException(
        'Set up your own authenticator app before requiring one of the workspace.',
      );
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { mfaEnabledAt: true },
    });
    if (!actor?.mfaEnabledAt) {
      throw new BadRequestException(
        'Set up your own authenticator app before requiring one of the workspace. ' +
          'Without it this policy would refuse your next sign-in, and no other account could turn it off.',
      );
    }
  }

  /**
   * How ready the administrators are for the policy.
   *
   * Scoped to SUPER_ADMIN because AuthService.login is: everybody else uses the
   * opt-in emailed sign-in link, which this switch neither requires nor affects.
   * Counting them here would report a lockout that cannot happen and stop an
   * administrator enabling a control that was safe.
   *
   * OAuth is not counted either, because oauthLogin does not consult the policy
   * — an account with no password is not one this rule can shut out.
   */
  async mfaReadiness(actorId: string | null): Promise<MfaReadiness> {
    const [actor, passwordMembers, enrolledMembers] = await Promise.all([
      actorId
        ? this.prisma.user.findUnique({
            where: { id: actorId },
            select: { mfaEnabledAt: true },
          })
        : Promise.resolve(null),
      this.prisma.user.count({
        where: ADMINS_THE_POLICY_REACHES,
      }),
      this.prisma.user.count({
        where: { ...ADMINS_THE_POLICY_REACHES, mfaEnabledAt: { not: null } },
      }),
    ]);

    return {
      actorEnrolled: Boolean(actor?.mfaEnabledAt),
      passwordMembers,
      enrolledMembers,
    };
  }

  async list(): Promise<SecurityControl[]> {
    const policy = await this.policy();
    return [
      this.passwordPolicy(),
      this.sessionLifetime(),
      this.multiFactor(policy),
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
   * The SSO this platform has is OAuth against Google — not the SAML 2.0 the
   * old switch named. A provider with no client credentials is off, and its
   * sign-in button answers 503, so "available" is the honest word.
   */
  private singleSignOn(): SecurityControl[] {
    return (['GOOGLE'] as const).map((prefix) => {
      const configured = isOAuthConfigured(this.config, prefix);
      const name = 'Google';
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
      label: 'Require two-factor authentication for administrators',
      detail: policy.requireMfa
        ? 'Every administrator signing in with a password must present a code from an authenticator app. One who has not enrolled is refused a session. Patients and pharmacies are not affected: they choose the emailed sign-in link on their own profile.'
        : 'Administrators may enrol an authenticator app, but sign-in does not require one. Switching this on refuses a session to any administrator who has not enrolled, and is refused unless you have enrolled yourself. It does not affect patients or pharmacies.',
      state: policy.requireMfa ? 'enforced' : 'available',
      configuredBy: 'This page',
      setting: 'requireMfa',
      enabled: policy.requireMfa,
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
        'Not implemented. Single sign-on here is OAuth against Google; there is no SAML service provider, so an IdP that only speaks SAML cannot be connected.',
      state: 'not-implemented',
      configuredBy: 'Not available in this release',
    };
  }
}
