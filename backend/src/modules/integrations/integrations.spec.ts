import { ConfigService } from '@nestjs/config';
import { NotificationDeliveryStatus, ProviderMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeConfig } from '../commercial/stripe/stripe.config';
import { MailService } from '../mail/mail.service';
import { VisionService } from '../scan/vision.service';
import { IntegrationsService } from './integrations.service';

const configOf = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

interface Options {
  env?: Record<string, string | undefined>;
  stripe?: Partial<{
    isConfigured: boolean;
    mode: ProviderMode;
    chargingBlockedReason: () => string | null;
  }>;
  mailEnabled?: boolean;
  visionEnabled?: boolean;
  deliveries?: { sent: number; failed: number };
}

function serviceFor(options: Options = {}) {
  const counts = options.deliveries ?? { sent: 0, failed: 0 };
  const prisma = {
    notificationDelivery: {
      count: jest.fn(({ where }: { where: { status: NotificationDeliveryStatus } }) =>
        Promise.resolve(
          where.status === NotificationDeliveryStatus.SENT ? counts.sent : counts.failed,
        ),
      ),
    },
  };

  const stripe = {
    isConfigured: options.stripe?.isConfigured ?? true,
    mode: options.stripe?.mode ?? ProviderMode.TEST,
    chargingBlockedReason: options.stripe?.chargingBlockedReason ?? (() => null),
  } as unknown as StripeConfig;

  return new IntegrationsService(
    configOf(options.env ?? {}),
    prisma as unknown as PrismaService,
    stripe,
    { isEnabled: options.mailEnabled ?? true } as unknown as MailService,
    { isEnabled: () => options.visionEnabled ?? true } as unknown as VisionService,
  );
}

const find = async (options: Options, id: string) =>
  (await serviceFor(options).list()).find((row) => row.id === id)!;

describe('IntegrationsService — the real dependencies, not a catalogue of names', () => {
  it('reports only services this platform actually talks to', async () => {
    // The page it replaces listed Epic, Cerner, SAP Ariba, Snowflake, ServiceNow,
    // Slack, Okta and Power BI. None of them appear anywhere in the schema.
    const ids = (await serviceFor().list()).map((row) => row.id);

    expect(ids).toEqual(['stripe', 'smtp', 'google', 'vision']);
  });

  describe('payments', () => {
    it('says which mode it is in, because test mode moves no money', async () => {
      const row = await find({ stripe: { mode: ProviderMode.TEST } }, 'stripe');

      expect(row.status).toBe('operational');
      expect(row.detail).toMatch(/test mode/i);
    });

    it('is degraded, not operational, when charging is blocked', async () => {
      const row = await find(
        { stripe: { chargingBlockedReason: () => 'Live mode is not authorised.' } },
        'stripe',
      );

      expect(row.status).toBe('degraded');
      expect(row.detail).toMatch(/Live mode is not authorised/);
    });

    it('is not configured when there is no key, and points at Commercial', async () => {
      const row = await find({ stripe: { isConfigured: false } }, 'stripe');

      expect(row.status).toBe('disabled');
      expect(row.configured).toBe(false);
      expect(row.manage).toBe('/admin/commercial');
    });
  });

  describe('email', () => {
    it('reports what was actually delivered rather than claiming health', async () => {
      // Configuration alone cannot tell a working transport from one that accepts
      // everything and delivers nothing.
      const row = await find({ deliveries: { sent: 40, failed: 2 } }, 'smtp');

      expect(row.status).toBe('operational');
      expect(row.detail).toMatch(/40 delivered and 2 failed/);
    });

    // NotificationDelivery is the template library's audit trail, and nothing
    // else writes to it. The welcome, reset, invite and credentials mail that
    // actually leaves this deployment goes out through MailService and records
    // no row — so a count presented as all outbound email reads as an outage on
    // any week the library happened not to fire.
    it('says which mail the count covers, on both branches', async () => {
      const idle = await find({ deliveries: { sent: 0, failed: 0 } }, 'smtp');
      const busy = await find({ deliveries: { sent: 40, failed: 2 } }, 'smtp');

      for (const row of [idle, busy]) {
        expect(row.detail).toMatch(/template[ -]library/i);
        expect(row.detail).toMatch(/sends directly and is not counted here/i);
      }
    });

    it('never claims that no email at all has been sent', async () => {
      // The old wording, which was false on any week that reset one password.
      const row = await find({ deliveries: { sent: 0, failed: 0 } }, 'smtp');

      expect(row.detail).not.toMatch(/nothing has been sent/i);
    });

    it('is degraded when failures are not the minority', async () => {
      const row = await find({ deliveries: { sent: 1, failed: 9 } }, 'smtp');

      expect(row.status).toBe('degraded');
    });

    it('says mail is only being logged when no SMTP host is set', async () => {
      const row = await find({ mailEnabled: false }, 'smtp');

      expect(row.status).toBe('disabled');
      expect(row.detail).toMatch(/written to the server log/i);
    });

    it('does not imply health from an idle week', async () => {
      const row = await find({ deliveries: { sent: 0, failed: 0 } }, 'smtp');

      expect(row.detail).toMatch(/No template-library mail in the last seven days/i);
    });
  });

  describe('identity providers', () => {
    it('is operational only when both client id and secret are set', async () => {
      const row = await find(
        { env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' } },
        'google',
      );

      expect(row.status).toBe('operational');
    });

    it('is not configured when only the id is set, and says what the button does', async () => {
      // Half-configured is exactly the state the OAuth guard answers 503 for.
      const row = await find({ env: { GOOGLE_CLIENT_ID: 'id' } }, 'google');

      expect(row.status).toBe('disabled');
      expect(row.detail).toMatch(/503/);
    });

    it('offers no Manage link, because the answer is a server credential', async () => {
      const row = await find({}, 'google');

      expect(row.manage).toBeNull();
      expect(row.configuredBy).toMatch(/GOOGLE_CLIENT_ID/);
    });
  });

  it('describes the scan fallback by what still works without it', async () => {
    const row = await find({ visionEnabled: false }, 'vision');

    expect(row.status).toBe('disabled');
    expect(row.detail).toMatch(/still runs in the browser/i);
  });

  it('gives every row something an operator can act on', async () => {
    for (const row of await serviceFor({ mailEnabled: false, visionEnabled: false }).list()) {
      // Never a bare adjective: a status with no explanation is what sent somebody
      // looking for a Manage button that was never going to do anything.
      expect(row.detail.length).toBeGreaterThan(20);
      expect(row.manage ?? row.configuredBy).toBeTruthy();
    }
  });

  // Every Manage button pointed outside the console it links into: the admin
  // pages are mounted under /admin, and these paths omitted it, so React Router
  // matched neither the admin subtree nor the patient portal and fell through to
  // the catch-all NotFound. A button that opens a 404 is the same broken promise
  // as the button with no handler that MSA-39 opened with.
  it('points every Manage link at a page inside the admin console', async () => {
    const rows = await serviceFor({ mailEnabled: true, visionEnabled: true }).list();
    const managed = rows.filter((row) => row.manage !== null);

    // Guards the assertion itself: were every row unmanaged, the loop below
    // would pass without checking anything.
    expect(managed.length).toBeGreaterThan(0);
    for (const row of managed) {
      expect(row.manage).toMatch(/^\/admin\/[a-z-]+$/);
    }
  });

  // The set is pinned rather than pattern-matched because the routes exist in
  // the frontend router, which this service cannot see. Changing either side
  // alone is what breaks the link, so the pairing is written down here.
  it('names only pages the admin console actually mounts', async () => {
    const rows = await serviceFor({ mailEnabled: true, visionEnabled: true }).list();
    const targets = new Set(rows.map((row) => row.manage).filter(Boolean));

    // frontend/src/routes/index.jsx — children of the '/admin' route.
    expect([...targets].sort()).toEqual(['/admin/commercial', '/admin/notifications']);
  });
});
