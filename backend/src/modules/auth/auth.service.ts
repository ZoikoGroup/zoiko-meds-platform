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
import { roleLabel } from './roles';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';

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
  ) {}

  async register(dto: RegisterDto) {
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
    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Uniform failure for missing user / SSO-only account / bad password to
    // avoid leaking which emails exist.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
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

  async changePassword(userId: string, dto: ChangePasswordDto) {
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
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { message: 'Password changed successfully' };
  }

  // --- Password reset ------------------------------------------------------

  /**
   * Start a reset. Always returns the same response whether or not the email
   * exists, so we never reveal which addresses are registered.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
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
    return generic;
  }

  /** Complete a reset (or invite set-password). Consumes the token. */
  async resetPassword(dto: ResetPasswordDto) {
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
