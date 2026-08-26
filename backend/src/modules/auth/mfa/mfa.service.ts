import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { generateSecret, otpauthUri, verifyCode } from './totp';

export interface MfaStatus {
  /** A confirmed second factor. Only this makes a code required at sign-in. */
  enrolled: boolean;
  /** A secret exists but no code has been proved against it yet. */
  pending: boolean;
  enrolledAt: string | null;
  /** Whether the workspace requires one, whatever this member has done. */
  required: boolean;
}

/**
 * Time-based one-time passwords for sign-in (MSA-42).
 *
 * The settings page used to carry an "Enforce multi-factor authentication"
 * switch bound to component state. This is the factor it claimed to enforce.
 *
 * Enrolment is two steps on purpose. `mfaSecret` is written when setup begins,
 * but `mfaEnabledAt` — the field that actually makes a code required — is set
 * only once the member has proved a code from it. Someone who opens the setup
 * panel, never scans the QR, and closes the tab must not be locked out of their
 * own account on the next sign-in.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /** Whether this workspace requires a second factor of everyone. */
  async isRequiredByPolicy(): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: 'singleton' },
      select: { requireMfa: true },
    });
    return org?.requireMfa ?? false;
  }

  async status(userId: string): Promise<MfaStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      enrolled: Boolean(user.mfaEnabledAt),
      pending: Boolean(user.mfaSecret) && !user.mfaEnabledAt,
      enrolledAt: user.mfaEnabledAt?.toISOString() ?? null,
      required: await this.isRequiredByPolicy(),
    };
  }

  /**
   * Begin enrolment: mint a secret and hand back the URI to scan.
   *
   * Re-running this before confirming replaces the secret, so a member who
   * abandoned a setup and started again is not left proving a code against a
   * QR code they no longer have. Re-running it *after* confirming is refused —
   * silently swapping a working factor for one nobody has scanned would lock
   * them out at the next sign-in.
   */
  async beginEnrolment(userId: string, email: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabledAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.mfaEnabledAt) {
      throw new BadRequestException(
        'Two-factor authentication is already set up. Turn it off before setting it up again.',
      );
    }

    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaEnabledAt: null },
    });

    return { secret, otpauthUri: otpauthUri(secret, email) };
  }

  /** Prove a code against the pending secret, which is what turns it on. */
  async confirmEnrolment(userId: string, code: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.mfaEnabledAt) {
      throw new BadRequestException('Two-factor authentication is already set up.');
    }
    if (!user.mfaSecret) {
      throw new BadRequestException(
        'Start setting up two-factor authentication before confirming a code.',
      );
    }
    if (!verifyCode(user.mfaSecret, code)) {
      // Deliberately not cleared: a mistyped code should cost a retry, not the
      // whole enrolment and another trip through the QR scan.
      throw new UnauthorizedException('That code is not right. Try the current one.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabledAt: new Date() },
    });
    await this.audit.write(
      userId,
      'auth.mfa.enable',
      'User',
      userId,
      { module: 'Authentication' },
      ipAddress,
    );

    return { enrolled: true };
  }

  /**
   * Turn it off, which requires a current code.
   *
   * A session alone is not enough: an unattended browser is exactly the
   * situation a second factor exists for, and removing it must not be the one
   * thing that session can do unchallenged. Refused outright while the
   * workspace requires MFA — that is the policy's whole point.
   */
  async disable(userId: string, code: string, ipAddress?: string) {
    if (await this.isRequiredByPolicy()) {
      throw new BadRequestException(
        'This workspace requires two-factor authentication, so it cannot be turned off.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.mfaEnabledAt) {
      throw new BadRequestException('Two-factor authentication is not set up.');
    }
    if (!verifyCode(user.mfaSecret, code)) {
      throw new UnauthorizedException('That code is not right. Try the current one.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
    await this.audit.write(
      userId,
      'auth.mfa.disable',
      'User',
      userId,
      { module: 'Authentication' },
      ipAddress,
    );

    return { enrolled: false };
  }

  /**
   * The sign-in check.
   *
   * Returns a reason rather than throwing, so the caller can audit the specific
   * failure alongside every other login outcome.
   */
  verify(
    user: { mfaSecret: string | null; mfaEnabledAt: Date | null },
    code: string | undefined,
  ): { ok: true } | { ok: false; reason: 'mfa_required' | 'mfa_invalid' } {
    if (!user.mfaEnabledAt) return { ok: true };
    if (!code) return { ok: false, reason: 'mfa_required' };
    if (!verifyCode(user.mfaSecret, code)) {
      return { ok: false, reason: 'mfa_invalid' };
    }
    return { ok: true };
  }
}
