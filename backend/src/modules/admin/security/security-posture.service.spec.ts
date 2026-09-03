import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { SecurityPostureService } from './security-posture.service';

/**
 * What GET /admin/security answers with.
 *
 * It used to return the controls alone, so the page had to save once before it
 * could show what was stored. It now answers with the same { policy, controls }
 * envelope PATCH does.
 */

const STORED = {
  requireMfa: true,
  allowOauthSignIn: true,
};

function buildService(
  row: Record<string, unknown> | null = STORED,
  actor: { mfaEnabledAt: Date | null } | null = { mfaEnabledAt: new Date() },
) {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(actor),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const service = new SecurityPostureService(
    { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
  );
  return { service, prisma };
}

describe('the posture payload', () => {
  it('carries the stored policy alongside the controls', async () => {
    const { service } = buildService();

    const posture = await service.posture('admin-1');

    expect(posture.policy).toMatchObject(STORED);
    expect(Array.isArray(posture.controls)).toBe(true);
  });

  it('describes the MFA control the page can still set', async () => {
    const { service } = buildService();

    const control = (await service.posture('admin-1')).controls.find((c) => c.id === 'mfa');

    expect(control).toMatchObject({ setting: 'requireMfa', enabled: true });
  });

  it('offers no IP allowlist control, because there is no longer one', async () => {
    // Withdrawn after a saved subnet mask locked the workspace out of its own
    // console. A control the page cannot set must not appear as one it can.
    const { service } = buildService();

    const { policy, controls } = await service.posture('admin-1');

    expect(controls.find((c) => c.id === 'ip-allowlist')).toBeUndefined();
    expect(controls.some((c) => c.setting === ('ipAllowlistEnabled' as never))).toBe(false);
    expect(policy).not.toHaveProperty('ipAllowlistEnabled');
    expect(policy).not.toHaveProperty('ipAllowlist');
  });

  it('answers the same shape as an update does', async () => {
    // One envelope, so the page can apply either reply the same way.
    const { service } = buildService();

    const read = await service.posture('admin-1');
    const written = await service.update('admin-1', {}, '10.0.0.1');

    expect(Object.keys(read).sort()).toEqual(Object.keys(written).sort());
  });

  it('falls back to safe defaults when the workspace row is missing', async () => {
    // Nothing enforced that nobody asked for, and sign-in still possible.
    const { service } = buildService(null);

    const { policy } = await service.posture('admin-1');

    expect(policy.requireMfa).toBe(false);
    expect(policy.allowOauthSignIn).toBe(true);
  });
});

/**
 * MSA-42 — the switch could write the workspace out of its own console.
 *
 * Enforcement at sign-in has worked all along; what was missing was any check
 * that the admin throwing the switch could still get back in. An unenrolled
 * super admin who turned it on was refused their own next sign-in by the rule
 * they had just written, and no other account could lift it. That is the same
 * failure the IP allowlist was withdrawn for, so this one is guarded rather
 * than withdrawn: the control is real and worth having, it just must not be
 * settable from an account that has not enrolled.
 */
describe('requiring MFA of the workspace', () => {
  const enrolled = { mfaEnabledAt: new Date() };
  const notEnrolled = { mfaEnabledAt: null };
  const OFF = { requireMfa: false, allowOauthSignIn: true };

  it('is refused when the admin asking has no authenticator of their own', async () => {
    const { service, prisma } = buildService(OFF, notEnrolled);

    await expect(service.update('admin-1', { requireMfa: true })).rejects.toThrow(
      /before requiring one of the workspace/i,
    );
    // Refused before the write, so the policy is untouched rather than rolled
    // back — a rollback that itself failed would leave the workspace locked.
    expect(prisma.organization.upsert).not.toHaveBeenCalled();
  });

  it('is refused when there is no identifiable admin behind the change', async () => {
    const { service, prisma } = buildService(OFF, null);

    await expect(service.update(null, { requireMfa: true })).rejects.toThrow(
      /authenticator app/i,
    );
    expect(prisma.organization.upsert).not.toHaveBeenCalled();
  });

  it('goes through once that admin has enrolled', async () => {
    const { service, prisma } = buildService(OFF, enrolled);

    await service.update('admin-1', { requireMfa: true }, '10.0.0.1');

    expect(prisma.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ requireMfa: true }),
      }),
    );
  });

  it('never blocks turning it back off', async () => {
    // The way out of a workspace that requires more than it can supply. An
    // unenrolled admin holding a session got there before the policy changed,
    // and lifting it must not need the factor the policy is demanding.
    const { service, prisma } = buildService(STORED, notEnrolled);

    await service.update('admin-1', { requireMfa: false }, '10.0.0.1');

    expect(prisma.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ requireMfa: false }),
      }),
    );
  });

  it('leaves unrelated controls alone', async () => {
    // The guard is about one field. Saving the OAuth switch from an unenrolled
    // account is not a lockout and must not be refused as one.
    const { service, prisma } = buildService(OFF, notEnrolled);

    await service.update('admin-1', { allowOauthSignIn: false }, '10.0.0.1');

    expect(prisma.organization.upsert).toHaveBeenCalled();
  });
});

describe('what the page is told about readiness', () => {
  it('reports whether the reader has enrolled, so the switch can say why it is held', async () => {
    const { service } = buildService(
      { requireMfa: false, allowOauthSignIn: true },
      { mfaEnabledAt: null },
    );

    const { mfa } = await service.posture('admin-1');

    expect(mfa.actorEnrolled).toBe(false);
  });

  it('counts the password accounts that would be shut out', async () => {
    const { service, prisma } = buildService(
      { requireMfa: false, allowOauthSignIn: true },
      { mfaEnabledAt: new Date() },
    );
    // Six password accounts, two of them enrolled.
    prisma.user.count
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2);

    const { mfa } = await service.posture('admin-1');

    expect(mfa).toMatchObject({
      actorEnrolled: true,
      passwordMembers: 6,
      enrolledMembers: 2,
    });
  });

  it('counts only the accounts the policy actually reaches', async () => {
    // Administrators with a password, and nobody else.
    //
    // OAuth sign-in does not consult the policy, so an SSO-only account is not
    // one the switch turns away. Neither is a patient or a pharmacy: the policy
    // is scoped to SUPER_ADMIN, and everybody else uses the opt-in emailed
    // link. Counting either would report a lockout that cannot happen, and stop
    // an administrator enabling a control that was safe.
    const { service, prisma } = buildService();

    await service.posture('admin-1');

    expect(prisma.user.count).toHaveBeenCalled();
    for (const call of prisma.user.count.mock.calls) {
      expect(call[0].where).toMatchObject({
        isActive: true,
        role: 'SUPER_ADMIN',
        passwordHash: { not: null },
      });
    }
  });
});
