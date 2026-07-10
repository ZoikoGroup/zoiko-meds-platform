import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const SALT_ROUNDS = 12;

/**
 * Authentication & account administration for the ZoikoMeds platform.
 * Passwords are hashed with bcrypt; sessions are stateless JWTs.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

  // --- helpers -------------------------------------------------------------

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
      createdAt: user.createdAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
