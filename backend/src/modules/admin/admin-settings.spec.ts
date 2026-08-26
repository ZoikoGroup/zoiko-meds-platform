import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from './audit.writer';
import { OrganizationService } from './organization/organization.service';
import { SecurityPostureService } from './security/security-posture.service';
import { HelpResourcesService } from './help/help-resources.service';

const configFor = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('MSA-40 · organization profile', () => {
  let prisma: {
    organization: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let audit: { write: jest.Mock };
  let service: OrganizationService;

  const ROW = {
    id: 'singleton',
    name: 'Zoiko Group',
    slug: 'zoikomeds',
    dataResidency: 'India (ap-south-1)',
    organizationType: 'Pharmacy network',
    updatedAt: new Date('2026-08-26T10:00:00Z'),
    updatedById: 'user_1',
    updatedBy: { email: 'root@zoikomeds.test' },
  };

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    audit = { write: jest.fn() };
    service = new OrganizationService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
  });

  it('returns the stored profile, not an invented one', async () => {
    prisma.organization.findUnique.mockResolvedValue(ROW);

    const profile = await service.get();

    expect(profile.name).toBe('Zoiko Group');
    expect(profile.dataResidency).toBe('India (ap-south-1)');
    expect(profile.updatedByEmail).toBe('root@zoikomeds.test');
    // The fixture the page used to render for every deployment.
    expect(profile.name).not.toBe('Meridian Health Network');
  });

  it('answers with defaults rather than failing when the row is absent', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    const profile = await service.get();

    // The page is asking what this workspace is called; "ZoikoMeds, nobody has
    // changed it" is a true answer and a 404 is not.
    expect(profile.name).toBe('ZoikoMeds');
    expect(profile.updatedAt).toBeNull();
  });

  it('saves what was sent and reports it back', async () => {
    prisma.organization.upsert.mockResolvedValue(undefined);
    prisma.organization.findUnique.mockResolvedValue({
      ...ROW,
      name: 'Zoiko Health',
    });

    const profile = await service.update('user_1', { name: 'Zoiko Health' }, '10.0.0.1');

    expect(prisma.organization.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.organization.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'singleton' });
    expect(call.update.name).toBe('Zoiko Health');
    expect(profile.name).toBe('Zoiko Health');
  });

  it('leaves fields the form did not send alone', async () => {
    prisma.organization.upsert.mockResolvedValue(undefined);
    prisma.organization.findUnique.mockResolvedValue(ROW);

    await service.update('user_1', { name: 'Zoiko Health' });

    const { update } = prisma.organization.upsert.mock.calls[0][0];
    // A PATCH that omits residency must not blank the residency an auditor was
    // shown last week.
    expect(update).not.toHaveProperty('dataResidency');
    expect(update).not.toHaveProperty('organizationType');
  });

  it('trims, and stores an emptied optional field as null rather than ""', async () => {
    prisma.organization.upsert.mockResolvedValue(undefined);
    prisma.organization.findUnique.mockResolvedValue(ROW);

    await service.update('user_1', { name: '  Zoiko  ', dataResidency: '   ' });

    const { update } = prisma.organization.upsert.mock.calls[0][0];
    expect(update.name).toBe('Zoiko');
    expect(update.dataResidency).toBeNull();
  });

  it('never writes the slug, so the workspace handle survives a rename', async () => {
    prisma.organization.upsert.mockResolvedValue(undefined);
    prisma.organization.findUnique.mockResolvedValue(ROW);

    await service.update('user_1', {
      name: 'Renamed',
      // Sent anyway, as an over-posting attempt would.
      slug: 'something-else',
    } as never);

    const { update } = prisma.organization.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty('slug');
  });

  it('records who changed it', async () => {
    prisma.organization.upsert.mockResolvedValue(undefined);
    prisma.organization.findUnique.mockResolvedValue(ROW);

    await service.update('user_1', { name: 'Zoiko Health' }, '10.0.0.1');

    expect(audit.write).toHaveBeenCalledWith(
      'user_1',
      'admin.organization.update',
      'Organization',
      'singleton',
      expect.objectContaining({ module: 'Settings' }),
      '10.0.0.1',
    );
  });
});

describe('MSA-42 · security posture', () => {
  let prisma: {
    organization: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let audit: { write: jest.Mock };

  const POLICY = {
    requireMfa: false,
    ipAllowlistEnabled: false,
    ipAllowlist: [] as string[],
    allowOauthSignIn: true,
  };

  const serviceWith = (
    env: Record<string, string | undefined> = {},
    policy: Partial<typeof POLICY> = {},
  ) => {
    prisma.organization.findUnique.mockResolvedValue({ ...POLICY, ...policy });
    return new SecurityPostureService(
      configFor(env),
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
  };

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
    };
    audit = { write: jest.fn() };
  });

  it('marks only the controls this page can decide as settable', async () => {
    const controls = await serviceWith().list();

    const settable = controls.filter((c) => c.setting);
    expect(settable.map((c) => c.id).sort()).toEqual([
      'ip-allowlist',
      'mfa',
      'oauth-sign-in',
    ]);
    // Everything else is decided in configuration or in code, so the page must
    // not render a switch that could only misreport it.
    for (const control of controls.filter((c) => !c.setting)) {
      expect(control.enabled).toBeUndefined();
      expect(control.configuredBy.length).toBeGreaterThan(0);
    }
  });

  it('reports MFA as enforced once the workspace requires it', async () => {
    const off = (await serviceWith({}, { requireMfa: false }).list()).find((c) => c.id === 'mfa');
    const on = (await serviceWith({}, { requireMfa: true }).list()).find((c) => c.id === 'mfa');

    expect(off?.state).toBe('available');
    expect(off?.enabled).toBe(false);
    expect(on?.state).toBe('enforced');
    expect(on?.enabled).toBe(true);
    expect(on?.detail).toMatch(/refused a session/i);
  });

  it('counts the ranges actually in force', async () => {
    const control = (
      await serviceWith({}, {
        ipAllowlistEnabled: true,
        ipAllowlist: ['203.0.113.0/24', '10.0.0.0/8'],
      }).list()
    ).find((c) => c.id === 'ip-allowlist');

    expect(control?.state).toBe('enforced');
    expect(control?.detail).toContain('2 approved ranges');
    // Said on the page, because it is what stops a wrong entry taking the
    // service out of its load balancer.
    expect(control?.detail).toMatch(/health probes/i);
  });

  it('still names SAML as absent, since sign-on here is OAuth', async () => {
    const saml = (await serviceWith().list()).find((c) => c.id === 'saml');

    expect(saml?.state).toBe('not-implemented');
    expect(saml?.detail).toMatch(/OAuth against Google and Microsoft/);
  });

  it('reports a sign-in provider as available only with both credentials', async () => {
    const withBoth = (
      await serviceWith({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).list()
    ).find((c) => c.id === 'sso-google');
    const withOne = (await serviceWith({ GOOGLE_CLIENT_ID: 'id' }).list()).find(
      (c) => c.id === 'sso-google',
    );

    expect(withBoth?.state).toBe('available');
    expect(withOne?.state).toBe('not-implemented');
    expect(withOne?.detail).toMatch(/503/);
  });

  it('reads the session lifetime from the configuration that sets it', async () => {
    const control = (await serviceWith({ JWT_EXPIRES_IN: '900s' }).list()).find(
      (c) => c.id === 'session-lifetime',
    );

    expect(control?.detail).toContain('900s');
    expect(control?.state).toBe('enforced');
  });

  describe('saving a policy', () => {
    it('writes only what was sent', async () => {
      const service = serviceWith();

      await service.update('u1', { requireMfa: true }, '10.0.0.1');

      const { update } = prisma.organization.upsert.mock.calls[0][0];
      expect(update.requireMfa).toBe(true);
      expect(update).not.toHaveProperty('allowOauthSignIn');
    });

    it('records who changed it', async () => {
      await serviceWith().update('u1', { requireMfa: true }, '10.0.0.1');

      expect(audit.write).toHaveBeenCalledWith(
        'u1',
        'admin.security.update',
        'Organization',
        'singleton',
        expect.objectContaining({ module: 'Settings' }),
        '10.0.0.1',
      );
    });

    // The page would read "restricted" while the guard, correctly, let
    // everything through. The two must not disagree.
    it('refuses an allowlist switched on with nothing in it', async () => {
      await expect(
        serviceWith().update('u1', { ipAllowlistEnabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.organization.upsert).not.toHaveBeenCalled();
    });

    it('accepts it when entries are supplied in the same save', async () => {
      await expect(
        serviceWith().update('u1', {
          ipAllowlistEnabled: true,
          ipAllowlist: ['203.0.113.0/24'],
        }),
      ).resolves.toBeDefined();
    });

    it('names the entry it could not parse', async () => {
      await expect(
        serviceWith().update('u1', { ipAllowlist: ['203.0.113.0/24', 'example.com'] }),
      ).rejects.toThrow(/example\.com/);
    });

    it('trims stored entries, so a pasted line still matches', async () => {
      await serviceWith().update('u1', { ipAllowlist: ['  203.0.113.0/24  '] });

      const { update } = prisma.organization.upsert.mock.calls[0][0];
      expect(update.ipAllowlist).toEqual(['203.0.113.0/24']);
    });

    it('can switch the allowlist off without restating the entries', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...POLICY,
        ipAllowlistEnabled: true,
        ipAllowlist: ['203.0.113.0/24'],
      });
      const service = new SecurityPostureService(
        configFor({}),
        prisma as unknown as PrismaService,
        audit as unknown as AuditWriter,
      );

      await expect(
        service.update('u1', { ipAllowlistEnabled: false }),
      ).resolves.toBeDefined();
    });
  });
});

describe('MSA-43 · help resources', () => {
  const get = (values: Record<string, string | undefined>) =>
    new HelpResourcesService(configFor(values)).get();

  it('always has an address for support', () => {
    expect(get({}).supportEmail).toBe('support@zoikomeds.com');
    expect(get({ SUPPORT_EMAIL: 'help@example.test' }).supportEmail).toBe(
      'help@example.test',
    );
  });

  // main.ts mounts Swagger only outside production, so on the live deployment
  // linking to it would be a tile that opens a 404 — the fault this fixes.
  it('offers no API reference on a production deployment', () => {
    expect(get({ NODE_ENV: 'production' }).apiReferenceUrl).toBeNull();
  });

  it('points at the mounted reference elsewhere, honouring the route prefix', () => {
    expect(get({ NODE_ENV: 'development' }).apiReferenceUrl).toBe('/api/docs');
    expect(get({ NODE_ENV: 'development', API_PREFIX: 'v2' }).apiReferenceUrl).toBe(
      '/v2/docs',
    );
  });

  it('uses the public API URL when the console is served from another origin', () => {
    expect(
      get({ NODE_ENV: 'development', API_PUBLIC_URL: 'https://get.example.test/' })
        .apiReferenceUrl,
    ).toBe('https://get.example.test/api/docs');
  });

  it('has no documentation site unless one is configured', () => {
    expect(get({}).documentationUrl).toBeNull();
    expect(get({ DOCS_URL: 'https://docs.example.test' }).documentationUrl).toBe(
      'https://docs.example.test',
    );
  });
});
