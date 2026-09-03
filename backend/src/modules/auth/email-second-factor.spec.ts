import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditWriter } from '../admin/audit.writer';
import { MfaService } from './mfa/mfa.service';

/**
 * The emailed sign-in link (MSA-42).
 *
 * The authenticator app was only ever reachable by a super admin: the enrolment
 * endpoints need a session, the enrolment screen lives on the admin settings
 * page, and the workspace policy refused a session to anyone unenrolled. So the
 * one switch on that page could turn every patient and every pharmacy out of
 * the platform, with no route back in for any of them.
 *
 * This is the factor the rest of the platform can actually use. No app and no
 * enrolment: the account turns it on itself, and the next sign-in is confirmed
 * from the inbox it already proved it owns. The workspace policy now reaches
 * administrators alone.
 */

const PASSWORD_HASH = '$2a$12$abcdefghijklmnopqrstuv';

function buildService(overrides: { user?: Record<string, unknown> } = {}) {
  const user = {
    id: 'u1',
    email: 'asha@zoikomeds.test',
    fullName: 'Asha Rao',
    role: UserRole.PUBLIC,
    passwordHash: PASSWORD_HASH,
    isActive: true,
    mfaSecret: null,
    mfaEnabledAt: null,
    mfaEmailEnabled: false,
    ...overrides.user,
  };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mail = {
    sendLoginVerification: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { write: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const mfa = {
    verify: jest.fn().mockReturnValue({ ok: true }),
    isRequiredByPolicy: jest.fn().mockResolvedValue(false),
  };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as never,
    mail as unknown as MailService,
    audit as unknown as AuditWriter,
    mfa as unknown as MfaService,
  );

  return { service, prisma, mail, audit, jwt, mfa, user };
}

/** bcrypt.compare is the only thing standing between the test and the branch. */
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const login = (service: AuthService) =>
  service.login(
    { email: 'asha@zoikomeds.test', password: 'correct-horse' } as never,
    '10.0.0.1',
    'jest',
  );

describe('signing in with the emailed factor on', () => {
  it('sends the link instead of a session', async () => {
    const { service, mail, jwt } = buildService({ user: { mfaEmailEnabled: true } });

    const result = await login(service);

    expect(mail.sendLoginVerification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'asha@zoikomeds.test', fullName: 'Asha Rao' }),
    );
    expect(result).toMatchObject({ mfaEmailSent: true });
    // The whole point: a right password is now half a sign-in, not a session.
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('accessToken');
  });

  it('answers rather than throws, because nothing has gone wrong', async () => {
    // A 401 here would have the form render a half-finished sign-in beside the
    // wrong-password case it is nothing like.
    const { service } = buildService({ user: { mfaEmailEnabled: true } });

    await expect(login(service)).resolves.toBeDefined();
  });

  it('names the inbox without printing the address in full', async () => {
    // Whoever is at the screen at this point is not certainly the account
    // holder — they have a password, which is exactly what is in doubt.
    const { service } = buildService({ user: { mfaEmailEnabled: true } });

    const result = (await login(service)) as { email: string };

    expect(result.email).toBe('as****@zoikomeds.test');
    expect(result.email).not.toContain('asha@');
  });

  it('masks a long address to exactly the same width as a short one', async () => {
    // Otherwise the mask discloses how long the address is, which is not
    // something the person reading this screen is necessarily entitled to.
    const { service } = buildService({
      user: { mfaEmailEnabled: true, email: 'a.very.long.address@zoikomeds.test' },
    });

    const result = (await login(service)) as { email: string };

    expect(result.email).toBe('a.****@zoikomeds.test');
  });

  it('mints a single-use token that expires', async () => {
    const { service, prisma } = buildService({ user: { mfaEmailEnabled: true } });

    await login(service);

    const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(data.purpose).toBe('login');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Ten minutes, not an hour: a link sitting in a mail archive must not be a
    // standing key to the account.
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
    // Only the hash is stored, as the reset and invite flows do.
    expect(data.tokenHash).toEqual(expect.any(String));
    expect(data).not.toHaveProperty('token');
  });

  it('leaves an account without the factor signing in exactly as before', async () => {
    const { service, mail, jwt } = buildService({ user: { mfaEmailEnabled: false } });

    const result = await login(service);

    expect(mail.sendLoginVerification).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalled();
    expect(result).toHaveProperty('accessToken');
  });

  it('sends nothing when the password was wrong', async () => {
    // The link is a second factor, not a first one. Mailing it on a failed
    // attempt would turn a wrong guess into a notification anyone could trigger.
    const bcrypt = jest.requireMock('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { service, mail } = buildService({ user: { mfaEmailEnabled: true } });

    await expect(login(service)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mail.sendLoginVerification).not.toHaveBeenCalled();
  });

  it('sends nothing to a deactivated account', async () => {
    const { service, mail } = buildService({
      user: { mfaEmailEnabled: true, isActive: false },
    });

    await expect(login(service)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mail.sendLoginVerification).not.toHaveBeenCalled();
  });
});

describe('opening the link', () => {
  const validToken = () => ({
    id: 't1',
    purpose: 'login',
    usedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    user: {
      id: 'u1',
      email: 'asha@zoikomeds.test',
      fullName: 'Asha Rao',
      role: UserRole.PUBLIC,
      isActive: true,
    },
  });

  it('issues the session', async () => {
    const { service, prisma, jwt } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validToken());

    const result = await service.completeEmailSecondFactor('raw-token', '10.0.0.1', 'jest');

    expect(jwt.signAsync).toHaveBeenCalled();
    expect(result).toHaveProperty('accessToken');
  });

  it('spends the token, so the link works once', async () => {
    const { service, prisma } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validToken());

    await service.completeEmailSecondFactor('raw-token');

    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { usedAt: expect.any(Date) },
      }),
    );
  });

  it('refuses a token that has already been spent', async () => {
    // The second presentation is either a double-click or somebody else holding
    // the link, and only one of those should still work.
    const { service, prisma } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      ...validToken(),
      usedAt: new Date(),
    });

    await expect(service.completeEmailSecondFactor('raw-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an expired token', async () => {
    const { service, prisma } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      ...validToken(),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.completeEmailSecondFactor('raw-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a reset token presented as a sign-in link', async () => {
    // Both live in the same table. A password-reset token must not be a session.
    const { service, prisma } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      ...validToken(),
      purpose: 'reset',
    });

    await expect(service.completeEmailSecondFactor('raw-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an account deactivated since the link was sent', async () => {
    // Minutes pass between sending and opening, and the answer can change.
    const { service, prisma } = buildService();
    const record = validToken();
    record.user.isActive = false;
    prisma.passwordResetToken.findUnique.mockResolvedValue(record);

    await expect(service.completeEmailSecondFactor('raw-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('says the same thing however the token is no good', async () => {
    // Distinguishing them tells whoever holds a link which part they got wrong.
    const { service, prisma } = buildService();
    const messages: string[] = [];
    for (const record of [
      null,
      { ...validToken(), usedAt: new Date() },
      { ...validToken(), expiresAt: new Date(0) },
      { ...validToken(), purpose: 'invite' },
    ]) {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);
      await service.completeEmailSecondFactor('raw-token').catch((e) => messages.push(e.message));
    }

    expect(new Set(messages).size).toBe(1);
    expect(messages).toHaveLength(4);
  });
});

describe('choosing to use it', () => {
  it('is the account holder’s own decision to turn on', async () => {
    const { service, prisma } = buildService();

    await service.setEmailSecondFactor('u1', true, '10.0.0.1', 'jest');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mfaEmailEnabled: true } }),
    );
  });

  it('can be turned back off, with nothing standing in the way', async () => {
    // Voluntary means voluntary. Nothing about this factor may become a thing
    // an account cannot undo for itself.
    const { service, prisma } = buildService({ user: { mfaEmailEnabled: true } });

    await service.setEmailSecondFactor('u1', false);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mfaEmailEnabled: false } }),
    );
  });

  it('is refused to an administrator, who has the authenticator app', async () => {
    // Resting the workspace's most privileged account on an inbox would put it
    // behind whatever that mailbox's own security happens to be, and behind an
    // SMTP service that can be down.
    const { service, prisma } = buildService({ user: { role: UserRole.SUPER_ADMIN } });

    await expect(service.setEmailSecondFactor('u1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is refused to an account with no password for it to follow', async () => {
    const { service } = buildService({ user: { passwordHash: null } });

    await expect(service.setEmailSecondFactor('u1', true)).rejects.toThrow(
      /identity provider/i,
    );
  });

  it('reports availability from the server, not from each page', async () => {
    const { service } = buildService({ user: { role: UserRole.PHARMACY_ADMIN } });

    const status = await service.emailSecondFactorStatus('u1');

    expect(status).toMatchObject({ enabled: false, available: true });
    expect(status.email).toBe('as****@zoikomeds.test');
  });

  it('reports it as unavailable to an administrator', async () => {
    const { service } = buildService({ user: { role: UserRole.SUPER_ADMIN } });

    expect((await service.emailSecondFactorStatus('u1')).available).toBe(false);
  });
});

describe('the workspace policy after this change', () => {
  it('no longer refuses a patient who has not enrolled an authenticator', async () => {
    // The bug in its worst form: one switch on the admin settings page turned
    // every patient and every pharmacy out of the platform, with nowhere to
    // enrol and no session in which to try.
    const { service, mfa, jwt } = buildService({ user: { role: UserRole.PUBLIC } });
    mfa.isRequiredByPolicy.mockResolvedValue(true);

    const result = await login(service);

    expect(result).toHaveProperty('accessToken');
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('no longer refuses a pharmacy either', async () => {
    const { service, mfa } = buildService({ user: { role: UserRole.PHARMACY_ADMIN } });
    mfa.isRequiredByPolicy.mockResolvedValue(true);

    await expect(login(service)).resolves.toHaveProperty('accessToken');
  });

  it('still refuses an unenrolled administrator, which is what it is for', async () => {
    const { service, mfa } = buildService({ user: { role: UserRole.SUPER_ADMIN } });
    mfa.isRequiredByPolicy.mockResolvedValue(true);

    await expect(login(service)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets an enrolled administrator through', async () => {
    const { service, mfa } = buildService({
      user: { role: UserRole.SUPER_ADMIN, mfaEnabledAt: new Date() },
    });
    mfa.isRequiredByPolicy.mockResolvedValue(true);

    await expect(login(service)).resolves.toHaveProperty('accessToken');
  });
});
