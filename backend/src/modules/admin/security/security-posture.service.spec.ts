import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { SecurityPostureService } from './security-posture.service';

/**
 * What GET /admin/security answers with.
 *
 * It used to return the controls alone. The approved-networks editor therefore
 * had nothing to open with: the stored ranges came back only in the reply to the
 * next save, so a workspace that already had some was shown an empty box and a
 * careless save would wipe them. It now answers with the same
 * { policy, controls } envelope PATCH does.
 */

const STORED = {
  requireMfa: false,
  ipAllowlistEnabled: true,
  ipAllowlist: ['203.0.113.0/24', '2001:db8::/32'],
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

  it('includes the approved ranges, so the editor can open with them', async () => {
    // The whole reason for the change.
    const { service } = buildService();

    expect((await service.posture()).policy.ipAllowlist).toEqual([
      '203.0.113.0/24',
      '2001:db8::/32',
    ]);
  });

  it('still describes the IP allowlist control', async () => {
    const { service } = buildService();

    const control = (await service.posture()).controls.find((c) => c.id === 'ip-allowlist');

    expect(control).toMatchObject({ setting: 'ipAllowlistEnabled', enabled: true });
  });

  it('answers the same shape as an update does', async () => {
    // One envelope, so the page can apply either reply the same way.
    const { service } = buildService();

    const read = await service.posture();
    const written = await service.update(null, {}, '10.0.0.1');

    expect(Object.keys(read).sort()).toEqual(Object.keys(written).sort());
  });

  it('falls back to safe defaults when the workspace row is missing', async () => {
    // Nothing enforced, nothing listed — never an allowlist switched on with an
    // empty list, which would refuse every request.
    const { service } = buildService(null);

    const { policy } = await service.posture();

    expect(policy.ipAllowlistEnabled).toBe(false);
    expect(policy.ipAllowlist).toEqual([]);
  });
});
