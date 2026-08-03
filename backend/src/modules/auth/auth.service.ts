import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditWriter } from '../admin/audit.writer';
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

  // --- helpers -------------------------------------------------------------

  /** Create a single-use token, store only its hash, return the raw token. */
  private async createToken(
    userId: string,
    purpose: 'reset' | 'invite',
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
