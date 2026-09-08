import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import { MfaService } from './mfa.service';
import { generateCode, generateSecret } from './totp';

describe('MfaService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    organization: { findUnique: jest.Mock };
  };
  let audit: { write: jest.Mock };
  let service: MfaService;

  const SECRET = generateSecret();

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      organization: { findUnique: jest.fn().mockResolvedValue({ requireMfa: false }) },
    };
    audit = { write: jest.fn() };
    service = new MfaService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
  });

  describe('enrolment', () => {
    it('mints a scannable secret without requiring anything yet', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaEnabledAt: null });

      const { secret, otpauthUri } = await service.beginEnrolment('u1', 'a@b.test');

      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(otpauthUri).toContain('otpauth://totp/');
      // mfaEnabledAt stays null: an enrolment begun and abandoned must not lock
      // the member out at their next sign-in.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { mfaSecret: secret, mfaEnabledAt: null } }),
      );
    });

    it('refuses to re-mint over a working factor', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaEnabledAt: new Date() });

      // Silently swapping the secret would lock them out at the next sign-in.
      await expect(service.beginEnrolment('u1', 'a@b.test')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('turns the factor on only once a code is proved', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: null });

      await service.confirmEnrolment('u1', generateCode(SECRET), '10.0.0.1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { mfaEnabledAt: expect.any(Date) } }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        'u1',
        'auth.mfa.enable',
        'User',
        'u1',
        expect.objectContaining({ module: 'Authentication' }),
        '10.0.0.1',
      );
    });

    it('keeps the pending secret after a mistyped code', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: null });

      await expect(service.confirmEnrolment('u1', '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // A typo should cost a retry, not the whole enrolment and another QR scan.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to confirm before setup has begun', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: null, mfaEnabledAt: null });

      await expect(service.confirmEnrolment('u1', '000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('disabling', () => {
    it('requires a current code, not just a session', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: new Date() });

      // An unattended browser is the situation a second factor exists for.
      await expect(service.disable('u1', '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('clears both fields once the code is right', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: new Date() });

      await service.disable('u1', generateCode(SECRET), '10.0.0.1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { mfaSecret: null, mfaEnabledAt: null } }),
      );
    });

    it('refuses outright while the workspace requires MFA', async () => {
      prisma.organization.findUnique.mockResolvedValue({ requireMfa: true });
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: new Date() });

      // That is the policy's whole point.
      await expect(
        service.disable('u1', generateCode(SECRET)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('separates enrolled from a setup that was never confirmed', async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: SECRET, mfaEnabledAt: null });

      const status = await service.status('u1');

      expect(status.enrolled).toBe(false);
      expect(status.pending).toBe(true);
    });

    it('reports the workspace requirement alongside the account', async () => {
      prisma.organization.findUnique.mockResolvedValue({ requireMfa: true });
      prisma.user.findUnique.mockResolvedValue({ mfaSecret: null, mfaEnabledAt: null });

      const status = await service.status('u1');

      expect(status.required).toBe(true);
      expect(status.enrolled).toBe(false);
    });
  });

  describe('sign-in check', () => {
    it('passes an account with no factor straight through', () => {
      expect(service.verify({ mfaSecret: null, mfaEnabledAt: null }, undefined)).toEqual({
        ok: true,
      });
    });

    it('asks for a code when one is enrolled and none was sent', () => {
      expect(
        service.verify({ mfaSecret: SECRET, mfaEnabledAt: new Date() }, undefined),
      ).toEqual({ ok: false, reason: 'mfa_required' });
    });

    it('rejects a wrong code', () => {
      expect(
        service.verify({ mfaSecret: SECRET, mfaEnabledAt: new Date() }, '000000'),
      ).toEqual({ ok: false, reason: 'mfa_invalid' });
    });

    it('accepts the current code', () => {
      expect(
        service.verify({ mfaSecret: SECRET, mfaEnabledAt: new Date() }, generateCode(SECRET)),
      ).toEqual({ ok: true });
    });

    // A secret with no mfaEnabledAt is an abandoned setup, not a second factor.
    it('does not demand a code for an unconfirmed enrolment', () => {
      expect(service.verify({ mfaSecret: SECRET, mfaEnabledAt: null }, undefined)).toEqual({
        ok: true,
      });
    });
  });

  /**
   * What a sign-in still owes, as a table.
   *
   * `verify` above answers "is this code right". This answers the question
   * asked before it — whether a code is owed at all — and getting it from
   * `mfaEnabledAt` alone was the defect: enrolment made a code compulsory for
   * ever, so the workspace switch governed nothing for the administrators it
   * names and an enrolled admin was stopped at a prompt with the policy off.
   *
   * Written as every combination rather than as the cases that broke, because
   * the interesting property is the whole grid: which of role, policy and
   * enrolment moves the answer, and which does not.
   */
  describe('what a sign-in still owes', () => {
    const policy = (requireMfa: boolean) =>
      prisma.organization.findUnique.mockResolvedValue({ requireMfa });

    const ENROLLED = new Date();

    it.each([
      // role,             policy, enrolled,  owes
      ['SUPER_ADMIN',      false,  true,      'none'],
      ['SUPER_ADMIN',      false,  false,     'none'],
      ['SUPER_ADMIN',      true,   true,      'code'],
      ['SUPER_ADMIN',      true,   false,     'enrolment'],
      // Not governed by the switch: their own enrolment is their own choice,
      // and no workspace setting turns it on or off for them.
      ['PHARMACY_ADMIN',   true,   true,      'code'],
      ['PHARMACY_ADMIN',   true,   false,     'none'],
      ['PHARMACY_ADMIN',   false,  true,      'code'],
      ['PUBLIC',           true,   false,     'none'],
      ['ADMIN',            true,   false,     'none'],
    ] as const)(
      '%s with policy=%s and enrolled=%s owes %s',
      async (role, requireMfa, enrolled, expected) => {
        policy(requireMfa);

        await expect(
          service.loginRequirement({
            role: role as never,
            mfaEnabledAt: enrolled ? ENROLLED : null,
          }),
        ).resolves.toBe(expected);
      },
    );

    it('reads the policy for the roles it governs, and not otherwise', async () => {
      // An ordinary sign-in should not be paying for a settings lookup it can
      // never be affected by.
      policy(true);

      await service.loginRequirement({ role: 'PUBLIC' as never, mfaEnabledAt: null });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();

      await service.loginRequirement({ role: 'SUPER_ADMIN' as never, mfaEnabledAt: null });
      expect(prisma.organization.findUnique).toHaveBeenCalledTimes(1);
    });

    it('treats a missing organization row as the policy being off', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.loginRequirement({ role: 'SUPER_ADMIN' as never, mfaEnabledAt: null }),
      ).resolves.toBe('none');
    });

    it('names the roles the switch governs in one place', () => {
      expect(service.isGovernedByPolicy('SUPER_ADMIN' as never)).toBe(true);
      expect(service.isGovernedByPolicy('ADMIN' as never)).toBe(false);
      expect(service.isGovernedByPolicy('PHARMACY_ADMIN' as never)).toBe(false);
      expect(service.isGovernedByPolicy('PUBLIC' as never)).toBe(false);
    });

    it('asks for nothing new when the policy is switched off and on again', async () => {
      // The enrolment is untouched by any of this: the answer changes with the
      // switch and comes straight back, off the same stored factor.
      const enrolledAdmin = { role: 'SUPER_ADMIN' as never, mfaEnabledAt: ENROLLED };

      policy(true);
      await expect(service.loginRequirement(enrolledAdmin)).resolves.toBe('code');
      policy(false);
      await expect(service.loginRequirement(enrolledAdmin)).resolves.toBe('none');
      policy(true);
      await expect(service.loginRequirement(enrolledAdmin)).resolves.toBe('code');

      // And nothing here writes to the account at all.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
