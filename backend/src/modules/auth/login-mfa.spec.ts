import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { MfaService } from './mfa/mfa.service';
import { generateCode, generateSecret } from './mfa/totp';

/**
 * MSA-42 — the settings page's "Enforce multi-factor authentication" switch was
 * bound to component state and read by nothing. These hold the enforcement it
 * claimed: a code demanded where one is enrolled, and a session refused where
 * the workspace requires a factor the account does not have.
 */
describe('login · second factor', () => {
  const SECRET = generateSecret();
  const PASSWORD = 'correct-horse';

  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    organization: { findUnique: jest.Mock };
  };
  let audit: { write: jest.Mock };
  let auth: AuthService;

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'root@zoikomeds.test',
    fullName: 'Root',
    role: 'SUPER_ADMIN',
    isActive: true,
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    mfaSecret: null,
    mfaEnabledAt: null,
    ...over,
  });

  const failureReasons = () =>
    audit.write.mock.calls
      .filter((call) => call[1] === 'auth.login_failed')
      .map((call) => call[4]?.reason);

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      organization: { findUnique: jest.fn().mockResolvedValue({ requireMfa: false }) },
    };
    audit = { write: jest.fn() };
    const mfa = new MfaService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
    auth = new AuthService(
      prisma as unknown as PrismaService,
      { signAsync: jest.fn().mockResolvedValue('token'), sign: () => 'token' } as unknown as JwtService,
      {} as unknown as MailService,
      audit as unknown as AuditWriter,
      mfa,
    );
  });

  it('signs in an account with no factor, as before', async () => {
    prisma.user.findUnique.mockResolvedValue(account());

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('demands a code when one is enrolled', async () => {
    prisma.user.findUnique.mockResolvedValue(
      account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
    );

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failureReasons()).toContain('Second factor not supplied');
  });

  it('tells the client to ask for one, which it cannot know to do otherwise', async () => {
    prisma.user.findUnique.mockResolvedValue(
      account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
    );

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
    ).rejects.toMatchObject({ response: { mfaRequired: true } });
  });

  it('refuses a wrong code', async () => {
    prisma.user.findUnique.mockResolvedValue(
      account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
    );

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: PASSWORD, mfaCode: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failureReasons()).toContain('Invalid second factor');
  });

  it('signs in with the right code', async () => {
    prisma.user.findUnique.mockResolvedValue(
      account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
    );

    await expect(
      auth.login({
        email: 'root@zoikomeds.test',
        password: PASSWORD,
        mfaCode: generateCode(SECRET),
      }),
    ).resolves.toBeDefined();
  });

  // The password is still checked first, so the policy cannot be used to
  // discover which addresses have accounts.
  it('rejects a wrong password before ever mentioning the factor', async () => {
    prisma.user.findUnique.mockResolvedValue(
      account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
    );

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failureReasons()).toContain('Invalid credentials');
    expect(failureReasons()).not.toContain('Second factor not supplied');
  });

  describe('when the workspace requires it', () => {
    beforeEach(() => {
      prisma.organization.findUnique.mockResolvedValue({ requireMfa: true });
    });

    // Letting them in on the password alone is the exact thing the policy
    // exists to stop — and what the old switch did.
    it('refuses a session to an account that has not enrolled', async () => {
      prisma.user.findUnique.mockResolvedValue(account());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { mfaEnrolmentRequired: true } });
      expect(failureReasons()).toContain(
        'Workspace requires two-factor authentication; account not enrolled',
      );
    });

    it('still signs in an account that has', async () => {
      prisma.user.findUnique.mockResolvedValue(
        account({ mfaSecret: SECRET, mfaEnabledAt: new Date() }),
      );

      await expect(
        auth.login({
          email: 'root@zoikomeds.test',
          password: PASSWORD,
          mfaCode: generateCode(SECRET),
        }),
      ).resolves.toBeDefined();
    });

    it('does not count an abandoned setup as enrolment', async () => {
      prisma.user.findUnique.mockResolvedValue(
        account({ mfaSecret: SECRET, mfaEnabledAt: null }),
      );

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { mfaEnrolmentRequired: true } });
    });
  });
});
