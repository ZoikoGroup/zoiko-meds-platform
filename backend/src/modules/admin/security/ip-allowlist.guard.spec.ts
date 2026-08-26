import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { IpAllowlistGuard } from './ip-allowlist.guard';

const contextFor = (ip: string | undefined, originalUrl = '/api/me/saved') =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ ip, originalUrl, method: 'GET' }),
    }),
  }) as unknown as ExecutionContext;

describe('IpAllowlistGuard', () => {
  let findUnique: jest.Mock;
  let guard: IpAllowlistGuard;

  const policy = (over: Partial<{ ipAllowlistEnabled: boolean; ipAllowlist: string[] }>) =>
    findUnique.mockResolvedValue({
      ipAllowlistEnabled: false,
      ipAllowlist: [],
      ...over,
    });

  beforeEach(() => {
    findUnique = jest.fn();
    guard = new IpAllowlistGuard(
      { organization: { findUnique } } as unknown as PrismaService,
      new Reflector(),
    );
  });

  it('allows everything while the policy is off', async () => {
    policy({ ipAllowlistEnabled: false, ipAllowlist: ['203.0.113.0/24'] });
    await expect(guard.canActivate(contextFor('198.51.100.1'))).resolves.toBe(true);
  });

  it('allows an address inside the list', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await expect(guard.canActivate(contextFor('203.0.113.9'))).resolves.toBe(true);
  });

  it('refuses an address outside it', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await expect(guard.canActivate(contextFor('198.51.100.1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // Switching the allowlist on before adding anything would otherwise deny the
  // very request that adds the first entry — including the one switching it off.
  it('treats an enabled but empty list as not configured', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: [] });
    await expect(guard.canActivate(contextFor('198.51.100.1'))).resolves.toBe(true);
  });

  // A load balancer that starts getting 403s pulls the instance out of service,
  // turning a wrong entry into a total outage rather than a lockout.
  it.each(['/api/health', '/api/health/ready', '/api/health/schema'])(
    'always answers %s',
    async (url) => {
      policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
      await expect(guard.canActivate(contextFor('198.51.100.1', url))).resolves.toBe(true);
    },
  );

  it('does not treat a path merely containing "health" as a probe', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await expect(
      guard.canActivate(contextFor('198.51.100.1', '/api/me/healthcheck')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ignores the query string when matching the probe paths', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await expect(
      guard.canActivate(contextFor('198.51.100.1', '/api/health?verbose=1')),
    ).resolves.toBe(true);
  });

  it('refuses a request with no address once a list is in force', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // A database blip must not become a total outage; the request will fail on
  // its own if the database really is gone.
  it('lets the request through when the policy cannot be read', async () => {
    findUnique.mockRejectedValue(new Error('connection refused'));
    await expect(guard.canActivate(contextFor('198.51.100.1'))).resolves.toBe(true);
  });

  it('lets the request through when there is no organization row', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextFor('198.51.100.1'))).resolves.toBe(true);
  });

  it('ignores non-http contexts', async () => {
    const ctx = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  // Caching would mean an operator switching the allowlist off to recover and
  // the instance ignoring them until the cache expired.
  it('reads the policy per request rather than caching it', async () => {
    policy({ ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
    await guard.canActivate(contextFor('203.0.113.9'));
    await guard.canActivate(contextFor('203.0.113.9'));
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
