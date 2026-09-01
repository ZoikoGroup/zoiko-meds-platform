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

function buildService(row: Record<string, unknown> | null = STORED) {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn(),
      upsert: jest.fn(),
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

    const posture = await service.posture();

    expect(posture.policy).toMatchObject(STORED);
    expect(Array.isArray(posture.controls)).toBe(true);
  });

  it('describes the MFA control the page can still set', async () => {
    const { service } = buildService();

    const control = (await service.posture()).controls.find((c) => c.id === 'mfa');

    expect(control).toMatchObject({ setting: 'requireMfa', enabled: true });
  });

  it('offers no IP allowlist control, because there is no longer one', async () => {
    // Withdrawn after a saved subnet mask locked the workspace out of its own
    // console. A control the page cannot set must not appear as one it can.
    const { service } = buildService();

    const { policy, controls } = await service.posture();

    expect(controls.find((c) => c.id === 'ip-allowlist')).toBeUndefined();
    expect(controls.some((c) => c.setting === ('ipAllowlistEnabled' as never))).toBe(false);
    expect(policy).not.toHaveProperty('ipAllowlistEnabled');
    expect(policy).not.toHaveProperty('ipAllowlist');
  });

  it('answers the same shape as an update does', async () => {
    // One envelope, so the page can apply either reply the same way.
    const { service } = buildService();

    const read = await service.posture();
    const written = await service.update(null, {}, '10.0.0.1');

    expect(Object.keys(read).sort()).toEqual(Object.keys(written).sort());
  });

  it('falls back to safe defaults when the workspace row is missing', async () => {
    // Nothing enforced that nobody asked for, and sign-in still possible.
    const { service } = buildService(null);

    const { policy } = await service.posture();

    expect(policy.requireMfa).toBe(false);
    expect(policy.allowOauthSignIn).toBe(true);
  });
});
