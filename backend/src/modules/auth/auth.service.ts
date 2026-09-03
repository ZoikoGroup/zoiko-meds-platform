import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditWriter } from '../admin/audit.writer';
import { MfaService } from './mfa/mfa.service';
import { roleLabel } from './roles';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { OAuthProfile } from './oauth-profile';

const SALT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * How long an emailed sign-in link stays good (MSA-42).
 *
 * Ten minutes: long enough to walk to another device and open the inbox, short
 * enough that a link sitting in a mail archive is not a standing key to the
 * account. The password has already been checked by the time one is sent, so
 * this is the possession half of the factor and nothing else.
 */
const LOGIN_LINK_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LOGIN_LINK_TTL_MINUTES = LOGIN_LINK_TTL_MS / 60_000;

/**
 * Authentication & account administration for the ZoikoMeds platform.
 * Passwords are hashed with bcrypt; sessions are stateless JWTs.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly auditWriter: AuditWriter,
    private readonly mfa: MfaService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    // Self-service registration can never grant an elevated role.
    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: dto.fullName,
        phone: dto.phone || null,
        passwordHash,
        role: UserRole.PUBLIC,
      },
    });

    // Best-effort welcome; never blocks account creation.
    void this.mail.sendWelcome({ to: user.email, fullName: user.fullName });

    await this.auditWriter.write(
      user.id,
      'auth.register',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Register',
        status: 'Success',
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return this.issueSession(user);
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      await this.auditWriter.write(
        null,
        'auth.login_failed',
        'User',
        null,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          attemptedEmail: email,
          reason: 'User not found or missing password',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      await this.auditWriter.write(
        user.id,
        'auth.login_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          reason: 'Account deactivated',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException('This account has been deactivated');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.auditWriter.write(
        user.id,
        'auth.login_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          reason: 'Invalid credentials',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    // The password was right. Everything below decides whether that is enough.
    const factor = this.mfa.verify(user, dto.mfaCode);
    if (!factor.ok) {
      await this.auditWriter.write(
        user.id,
        'auth.login_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          reason:
            factor.reason === 'mfa_required'
              ? 'Second factor not supplied'
              : 'Invalid second factor',
          userAgent,
        },
        ipAddress,
      );

      // A missing code is not a rejected credential: the client has to be told
      // to ask for one, and cannot know to until it has tried. Distinguished by
      // the mfaRequired flag rather than by the status code, so a client that
      // ignores it still treats the attempt as unsuccessful.
      throw new UnauthorizedException({
        message:
          factor.reason === 'mfa_required'
            ? 'Enter the code from your authenticator app.'
            : 'That code is not right. Try the current one.',
        mfaRequired: true,
      });
    }

    // Workspace policy, checked after the password so it cannot be used to
    // discover which addresses have accounts. Refused rather than waved
    // through: letting an administrator in on the password alone is the exact
    // thing the policy exists to stop, and a switch that does that is the bug
    // (MSA-42).
    //
    // Administrators only. The policy used to reach every account, which meant
    // one switch on the settings page could refuse every patient and every
    // pharmacy their sign-in — none of whom have anywhere to enrol an
    // authenticator, or any way to get a session in which to try. Everybody
    // else turns on the emailed link below if they want a second factor, and
    // nothing turns it on for them.
    if (
      user.role === UserRole.SUPER_ADMIN &&
      !user.mfaEnabledAt &&
      (await this.mfa.isRequiredByPolicy())
    ) {
      await this.auditWriter.write(
        user.id,
        'auth.login_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          userEmail: user.email,
          userRole: user.role,
          reason: 'Workspace requires two-factor authentication; account not enrolled',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException({
        message:
          'This workspace requires administrators to use an authenticator app. Set one up from the settings page of an account that still has access.',
        mfaEnrolmentRequired: true,
      });
    }

    // The emailed second factor (MSA-42). Opt-in, per account, and checked last
    // so that everything able to refuse a sign-in outright has already had its
    // say — there is no point mailing a link to finish an attempt that a
    // deactivated account or a wrong password was going to lose anyway.
    if (user.mfaEmailEnabled) {
      return this.beginEmailSecondFactor(user, ipAddress, userAgent);
    }

    await this.auditWriter.write(
      user.id,
      'auth.login',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Login',
        status: 'Success',
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        mfa: user.mfaEnabledAt ? 'totp' : 'none',
        userAgent,
      },
      ipAddress,
    );

    return this.issueSession(user);
  }

  /**
   * Sign in (or provision on first use) via an external OAuth provider.
   * Accounts created this way are password-less — they can only sign in through
   * their identity provider, never grant an elevated role, and follow the same
   * active-account and audit rules as password login.
   */
  async oauthLogin(
    profile: OAuthProfile,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (!profile.email) {
      throw new UnauthorizedException(
        'Your identity provider did not share an email address, which is required to sign in.',
      );
    }

    // Workspace policy (MSA-42). Checked before any account is provisioned, so a
    // workspace with single sign-on switched off does not quietly accumulate
    // accounts it will never let in.
    const org = await this.prisma.organization.findUnique({
      where: { id: 'singleton' },
      select: { allowOauthSignIn: true },
    });
    if (org && !org.allowOauthSignIn) {
      await this.auditWriter.write(
        null,
        'auth.login_failed',
        'User',
        null,
        {
          module: 'Authentication',
          action: 'Failed Login',
          status: 'Failed',
          attemptedEmail: this.normalizeEmail(profile.email),
          reason: 'Single sign-on is switched off for this workspace',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException(
        'Single sign-on is switched off for this workspace. Sign in with your email and password.',
      );
    }
    const email = this.normalizeEmail(profile.email);
    let user = await this.prisma.user.findUnique({ where: { email } });
    const isNew = !user;

    if (!user) {
      // Self-service OAuth registration can never grant an elevated role.
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: profile.fullName,
          role: UserRole.PUBLIC,
          // passwordHash stays null — this is an IdP-backed account.
        },
      });
      void this.mail.sendWelcome({ to: user.email, fullName: user.fullName });
    }

    if (!user.isActive) {
      await this.auditWriter.write(
        user.id,
        'auth.oauth_login_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed OAuth Login',
          status: 'Failed',
          provider: profile.provider,
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          reason: 'Account deactivated',
          userAgent,
        },
        ipAddress,
      );
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.auditWriter.write(
      user.id,
      isNew ? 'auth.oauth_register' : 'auth.oauth_login',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: isNew ? 'OAuth Register' : 'OAuth Login',
        status: 'Success',
        provider: profile.provider,
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return this.issueSession(user);
  }

  async logout(userId: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.auditWriter.write(
        user.id,
        'auth.logout',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Logout',
          status: 'Success',
          userId: user.id,
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          userAgent,
        },
        ipAddress,
      );
    }
    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toPublicUser(user);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account signs in via your identity provider and has no password to change',
      );
    }
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      await this.auditWriter.write(
        user.id,
        'auth.change_password_failed',
        'User',
        user.id,
        {
          module: 'Authentication',
          action: 'Failed Password Change',
          status: 'Failed',
          userEmail: user.email,
          userName: user.fullName,
          userRole: user.role,
          reason: 'Current password incorrect',
          userAgent,
        },
        ipAddress,
      );
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.auditWriter.write(
      user.id,
      'auth.change_password',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Password Change',
        status: 'Success',
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return { message: 'Password changed successfully' };
  }

  // --- Password reset ------------------------------------------------------

  /**
   * Start a reset. Always returns the same response whether or not the email
   * exists, so we never reveal which addresses are registered.
   */
  async forgotPassword(dto: ForgotPasswordDto, ipAddress?: string, userAgent?: string) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const generic = {
      message:
        'If an account exists for that email, a password reset link has been sent.',
    };
    // Only password-backed, active accounts can reset. SSO accounts opt out.
    if (!user || !user.passwordHash || !user.isActive) return generic;

    const token = await this.createToken(user.id, 'reset', RESET_TTL_MS);
    await this.mail.sendPasswordReset({
      to: user.email,
      fullName: user.fullName,
      token,
    });

    await this.auditWriter.write(
      user.id,
      'auth.forgot_password',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Password Reset Request',
        status: 'Success',
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return generic;
  }

  /** Complete a reset (or invite set-password). Consumes the token. */
  async resetPassword(dto: ResetPasswordDto, ipAddress?: string, userAgent?: string) {
    const tokenHash = this.hashToken(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This link is invalid or has expired. Please request a new one.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false, isActive: true },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate any other outstanding tokens for this user.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);

    if (record.user) {
      await this.auditWriter.write(
        record.user.id,
        'auth.reset_password',
        'User',
        record.user.id,
        {
          module: 'Authentication',
          action: 'Password Reset Complete',
          status: 'Success',
          userId: record.user.id,
          userEmail: record.user.email,
          userName: record.user.fullName,
          userRole: record.user.role,
          userAgent,
        },
        ipAddress,
      );
    }

    return { message: 'Your password has been set. You can now sign in.' };
  }

  /**
   * Issue an invite token for an admin-provisioned account and email a
   * set-password link. Returns the raw token for callers that need it (tests).
   */
  async sendInviteFor(user: User): Promise<string> {
    const token = await this.createToken(user.id, 'invite', INVITE_TTL_MS);
    await this.mail.sendInvite({
      to: user.email,
      fullName: user.fullName,
      token,
      roleLabel: roleLabel(user.role),
    });
    return token;
  }

  // --- Emailed second factor (MSA-42) --------------------------------------
  //
  // A link rather than a code, because it needs no enrolment step and no app:
  // an account turns it on, and the next sign-in is confirmed from the inbox
  // that account already proves it owns at registration. That is what makes it
  // safe to offer to every patient and every pharmacy, where requiring an
  // authenticator app would have meant requiring one of people with nowhere to
  // set one up.

  /**
   * Send the link, and answer with what the form should say.
   *
   * Deliberately not an exception. The password was right and nothing is wrong;
   * the sign-in is half finished, and a 401 would have the client render it as
   * a failure next to the wrong-password case it is nothing like.
   *
   * No session is issued here, and none can be until the link is opened.
   */
  private async beginEmailSecondFactor(
    user: User,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const token = await this.createToken(user.id, 'login', LOGIN_LINK_TTL_MS);
    await this.mail.sendLoginVerification({
      to: user.email,
      fullName: user.fullName,
      token,
      minutes: LOGIN_LINK_TTL_MINUTES,
    });

    await this.auditWriter.write(
      user.id,
      'auth.mfa.email_sent',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Sign-in Link Sent',
        status: 'Success',
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return {
      mfaEmailSent: true,
      // Masked, so the page can say where the link went without printing a full
      // address to whoever is sitting at the screen — which, at this point in
      // the flow, is not certainly the account holder.
      email: this.maskEmail(user.email),
      expiresInMinutes: LOGIN_LINK_TTL_MINUTES,
      message: `We sent a sign-in link to ${this.maskEmail(user.email)}. Open it to finish signing in.`,
    };
  }

  /**
   * Finish a sign-in from the emailed link. Consumes the token.
   *
   * Single use and expiring, checked against the same hashed-token table the
   * reset and invite flows use. A token that has been spent is refused rather
   * than quietly re-issuing a session: the second time it is presented, either
   * the member double-clicked or somebody else has the link, and only one of
   * those should still work.
   */
  async completeEmailSecondFactor(
    rawToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: true },
    });

    // One message for every way a token can be no good. Distinguishing them
    // tells whoever is holding a link which part they got wrong.
    const refuse = () =>
      new UnauthorizedException(
        'This sign-in link is no longer valid. Sign in again to get a new one.',
      );

    if (
      !record ||
      record.purpose !== 'login' ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw refuse();
    }

    const user = record.user;
    // Re-checked here, not just at the password step: minutes have passed, and
    // an account deactivated in between must not be let in by a link that was
    // valid when it was sent.
    if (!user.isActive) throw refuse();

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await this.auditWriter.write(
      user.id,
      'auth.login',
      'User',
      user.id,
      {
        module: 'Authentication',
        action: 'Login',
        status: 'Success',
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        reason: 'Confirmed by emailed sign-in link',
        userAgent,
      },
      ipAddress,
    );

    return this.issueSession(user);
  }

  /**
   * Turn the emailed factor on or off for this account.
   *
   * Refused for administrators, who have the authenticator app and a workspace
   * policy that can require it. Letting a super admin rest their console on an
   * inbox would put the workspace's most privileged account behind whatever
   * that mailbox's own security happens to be, and behind an SMTP service that
   * can be down.
   */
  async setEmailSecondFactor(
    userId: string,
    enabled: boolean,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'Administrator accounts use an authenticator app rather than an emailed link. Set one up from Settings → Security.',
      );
    }
    // Nothing to send a link to. Accounts created through a provider have no
    // password either, so this factor would have no first factor to be second
    // to.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account signs in through an identity provider, so there is no password for a second factor to follow.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEmailEnabled: enabled },
    });

    await this.auditWriter.write(
      userId,
      enabled ? 'auth.mfa.email_enable' : 'auth.mfa.email_disable',
      'User',
      userId,
      {
        module: 'Authentication',
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
        userAgent,
      },
      ipAddress,
    );

    return { mfaEmailEnabled: enabled };
  }

  /** Whether this account has the emailed factor on, and whether it may. */
  async emailSecondFactorStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, passwordHash: true, mfaEmailEnabled: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      enabled: user.mfaEmailEnabled,
      // Said by the server rather than worked out by each page, so the console
      // and the patient portal cannot disagree about who may turn it on.
      available: user.role !== UserRole.SUPER_ADMIN && Boolean(user.passwordHash),
      email: this.maskEmail(user.email),
    };
  }

  // --- helpers -------------------------------------------------------------

  /**
   * `ab****@example.com` — enough for the account holder to recognise their own
   * address, not enough to learn one they did not already know.
   *
   * A fixed run of stars rather than one per hidden character: the length of an
   * address is itself something the person reading this screen may not be
   * entitled to, and it costs nothing to withhold.
   */
  private maskEmail(email: string): string {
    const at = email.lastIndexOf('@');
    if (at < 1) return email;
    return `${email.slice(0, Math.min(2, at))}****${email.slice(at)}`;
  }


  /** Create a single-use token, store only its hash, return the raw token. */
  private async createToken(
    userId: string,
    purpose: 'reset' | 'invite' | 'login',
    ttlMs: number,
  ): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(raw),
        purpose,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return raw;
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async issueSession(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user: this.toPublicUser(user) };
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      pharmacyId: user.pharmacyId,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
