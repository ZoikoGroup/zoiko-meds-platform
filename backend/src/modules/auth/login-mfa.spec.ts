import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { MfaService } from './mfa/mfa.service';
import { generateCode, generateSecret } from './mfa/totp';

/**
 * MSA-42 — the settings page's "Enforce multi-factor authentication" switch was
 * bound to component state and read by nothing. These hold the enforcement it
 * claimed.
 *
 * The switch decides. That is the correction these were rewritten for: the code
 * used to be demanded of anyone holding an enrolment, whatever the policy said,
 * which made the switch govern nothing for the accounts it names and enrolment
 * a one-way door — an administrator who set an authenticator up was stopped at
 * a code prompt for ever after, with the workspace policy off and the prompt
 * supposedly lifted. Enrolment is a capability; the policy turns it into a
 * requirement, and turning the policy off leaves the capability sitting there
 * untouched.
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

  /** Turn the workspace policy on. Off is the default, as it is in the schema. */
  const requirePolicy = () =>
    prisma.organization.findUnique.mockResolvedValue({ requireMfa: true });

  const enrolledAccount = () => account({ mfaSecret: SECRET, mfaEnabledAt: new Date() });

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

  // The password is still checked first, so the policy cannot be used to
  // discover which addresses have accounts.
  it('rejects a wrong password before ever mentioning the factor', async () => {
    requirePolicy();
    prisma.user.findUnique.mockResolvedValue(enrolledAccount());

    await expect(
      auth.login({ email: 'root@zoikomeds.test', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failureReasons()).toContain('Invalid credentials');
    expect(failureReasons()).not.toContain('Second factor not supplied');
  });

  describe('when the workspace does not require it', () => {
    // The reported defect. The switch is off, so an administrator signs in on
    // the password — including one who has an authenticator set up, which is
    // the case that used to be stopped at a code prompt nothing was asking for.

    it('A. signs in an enrolled administrator on the password alone', async () => {
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('A. asks for no code, and reports no refusal', async () => {
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await auth.login({ email: 'root@zoikomeds.test', password: PASSWORD });

      expect(failureReasons()).toEqual([]);
    });

    it('B. signs in an administrator who never enrolled', async () => {
      prisma.user.findUnique.mockResolvedValue(account());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('leaves the enrolment on the account, dormant rather than spent', async () => {
      // Nothing about a sign-in under the policy-off path may clear the secret
      // or the enrolment date: turning the policy back on has to work off the
      // enrolment that is already there.
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await auth.login({ email: 'root@zoikomeds.test', password: PASSWORD });

      const wrote = prisma.user.update.mock.calls.map((call) => call[0]?.data ?? {});
      for (const data of wrote) {
        expect(data).not.toHaveProperty('mfaSecret');
        expect(data).not.toHaveProperty('mfaEnabledAt');
      }
    });

    it('accepts a code it did not ask for, rather than failing on it', async () => {
      // A client that still has one in hand — a resubmitted form, a password
      // manager — must not be turned away for offering it.
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await expect(
        auth.login({
          email: 'root@zoikomeds.test',
          password: PASSWORD,
          mfaCode: generateCode(SECRET),
        }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('G. requires the code again the moment the policy comes back on', async () => {
      // On, off, on — with the same account and no re-enrolment in between.
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());
      const attempt = () => auth.login({ email: 'root@zoikomeds.test', password: PASSWORD });

      requirePolicy();
      await expect(attempt()).rejects.toMatchObject({ response: { mfaRequired: true } });

      prisma.organization.findUnique.mockResolvedValue({ requireMfa: false });
      await expect(attempt()).resolves.toHaveProperty('accessToken');

      requirePolicy();
      await expect(attempt()).rejects.toMatchObject({ response: { mfaRequired: true } });
      // And the code that was enrolled all along still works.
      await expect(
        auth.login({
          email: 'root@zoikomeds.test',
          password: PASSWORD,
          mfaCode: generateCode(SECRET),
        }),
      ).resolves.toHaveProperty('accessToken');
    });
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

    it('C. demands a code from an enrolled account', async () => {
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(failureReasons()).toContain('Second factor not supplied');
    });

    it('C. tells the client to ask for one, which it cannot know to do otherwise', async () => {
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { mfaRequired: true } });
    });

    it('D. refuses a wrong code, and still asks for one', async () => {
      prisma.user.findUnique.mockResolvedValue(enrolledAccount());

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD, mfaCode: '000000' }),
      ).rejects.toMatchObject({ response: { mfaRequired: true } });
      expect(failureReasons()).toContain('Invalid second factor');
    });

    it('is the policy that decides, not the role of the account alone', async () => {
      // A pharmacy account is not what the switch governs, so the same policy
      // that stops an administrator does not stop them — the whole reason the
      // enforcement is asked of one role rather than of everyone.
      prisma.user.findUnique.mockResolvedValue(account({ role: 'PHARMACY_ADMIN' }));

      await expect(
        auth.login({ email: 'root@zoikomeds.test', password: PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
    });
  });

  /**
   * What the browser actually receives.
   *
   * Everything above asserts the exception this service throws. That is not
   * what a login form reads: between the two sits AllExceptionsFilter, which
   * rebuilds the response, and it used to rebuild it from `message` and `error`
   * alone. `mfaRequired` never left the server, so the form printed "Enter the
   * code from your authenticator app" and rendered no field to type one in —
   * and an enrolled administrator could not sign in at all.
   *
   * Both sides had passing tests. These are the ones that would have failed:
   * the real refusal, through the real filter, asserted on the real body.
   */
  describe('the refusal as the login form receives it', () => {
    /** Run a login that is expected to fail, and return the serialized body. */
    const wireBody = async (dto: Parameters<AuthService['login']>[0]) => {
      const json = jest.fn();
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status: () => ({ json }) }),
          getRequest: () => ({ method: 'POST', originalUrl: '/api/auth/login', id: 'req_1' }),
        }),
      } as unknown as ArgumentsHost;

      // The filter builds its own logger; a warn line per 4xx is not the subject.
      const warn = jest
        .spyOn(AppLogger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        await auth.login(dto);
        throw new Error('login was expected to be refused');
      } catch (err) {
        new AllExceptionsFilter().catch(err, host);
      } finally {
        warn.mockRestore();
      }
      return json.mock.calls[0][0] as Record<string, unknown>;
    };

    const enrolled = () => account({ mfaSecret: SECRET, mfaEnabledAt: new Date() });

    it('tells the form to ask for a code', async () => {
      requirePolicy();
      prisma.user.findUnique.mockResolvedValue(enrolled());

      const body = await wireBody({ email: 'root@zoikomeds.test', password: PASSWORD });

      expect(body.statusCode).toBe(401);
      expect(body.mfaRequired).toBe(true);
      expect(body.message).toBe('Enter the code from your authenticator app.');
    });

    it('still tells it so when the code was wrong, so the field stays up', async () => {
      requirePolicy();
      prisma.user.findUnique.mockResolvedValue(enrolled());

      const body = await wireBody({
        email: 'root@zoikomeds.test',
        password: PASSWORD,
        mfaCode: '000000',
      });

      expect(body.mfaRequired).toBe(true);
      expect(body.message).toBe('That code is not right. Try the current one.');
    });

    it('asks for enrolment instead when there is no code to give', async () => {
      prisma.organization.findUnique.mockResolvedValue({ requireMfa: true });
      prisma.user.findUnique.mockResolvedValue(account());

      const body = await wireBody({ email: 'root@zoikomeds.test', password: PASSWORD });

      expect(body.mfaEnrolmentRequired).toBe(true);
      // Distinguishable from the case above, which is the whole point: one asks
      // for a field, the other must not offer one.
      expect(body.mfaRequired).toBeUndefined();
    });

    it('says nothing about a factor when the password was simply wrong', async () => {
      requirePolicy();
      prisma.user.findUnique.mockResolvedValue(enrolled());

      const body = await wireBody({ email: 'root@zoikomeds.test', password: 'wrong-password' });

      expect(body.mfaRequired).toBeUndefined();
      expect(body.message).toBe('Invalid email or password');
    });

    it('carries no session, and never the secret', async () => {
      requirePolicy();
      prisma.user.findUnique.mockResolvedValue(enrolled());

      const body = await wireBody({ email: 'root@zoikomeds.test', password: PASSWORD });

      expect(body.accessToken).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(SECRET);
    });
  });
});
