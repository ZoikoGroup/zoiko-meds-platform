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
  const listWith = (values: Record<string, string | undefined>) =>
    new SecurityPostureService(configFor(values)).list();

  it('offers nothing to toggle, because nothing here is toggleable', () => {
    const controls = listWith({});
    // The whole point: the old switches stored a preference that no code read.
    for (const control of controls) {
      expect(control).not.toHaveProperty('enabled');
      expect(control.configuredBy.length).toBeGreaterThan(0);
    }
  });

  it('does not report MFA as a setting that is merely switched off', () => {
    const mfa = listWith({}).find((c) => c.id === 'mfa');

    // "off" invites someone to turn it on. It is absent, which is a different
    // fact and the one an auditor needs.
    expect(mfa?.state).toBe('not-implemented');
    expect(mfa?.detail).toMatch(/not implemented/i);
  });

  it('says the IP allowlist belongs to the network, not the console', () => {
    const ip = listWith({}).find((c) => c.id === 'ip-allowlist');

    expect(ip?.state).toBe('not-implemented');
    expect(ip?.detail).toMatch(/load balancer|firewall/i);
  });

  it('reports a sign-in provider as available only with both credentials', () => {
    const withBoth = listWith({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    }).find((c) => c.id === 'sso-google');
    const withOne = listWith({ GOOGLE_CLIENT_ID: 'id' }).find(
      (c) => c.id === 'sso-google',
    );

    expect(withBoth?.state).toBe('available');
    expect(withOne?.state).toBe('not-implemented');
    // Which is exactly when the OAuth guard starts answering 503.
    expect(withOne?.detail).toMatch(/503/);
  });

  it('reads the session lifetime from the configuration that sets it', () => {
    const control = listWith({ JWT_EXPIRES_IN: '900s' }).find(
      (c) => c.id === 'session-lifetime',
    );

    expect(control?.detail).toContain('900s');
    expect(control?.state).toBe('enforced');
  });

  it('describes SSO as the OAuth this platform has, not the SAML it does not', () => {
    const labels = listWith({}).map((c) => c.label).join(' ');

    expect(labels).toMatch(/Google/);
    expect(labels).toMatch(/Microsoft/);
    expect(labels).not.toMatch(/SAML/);
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
