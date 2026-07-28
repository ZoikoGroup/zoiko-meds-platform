import {
  NotificationDeliveryStatus,
  NotificationSuppressionReason,
} from '@prisma/client';

import { NotificationsService, type Recipient } from './notifications.service';

/**
 * Dispatch behaviour: idempotency, gating, suppression policy, and the audit
 * trail. Prisma and the mailer are faked so these run without a database.
 */

interface FakeEvent {
  id: string;
  idempotencyKey: string;
  templateId: string;
}
interface FakeDelivery {
  id: string;
  eventId: string;
  channel: string;
  recipientEmail: string | null;
  status: NotificationDeliveryStatus;
  suppressionReason: NotificationSuppressionReason | null;
  attempts: number;
  lastError: string | null;
}

function makeHarness(options?: {
  releasedGates?: string;
  suppression?: { email: string; reason: NotificationSuppressionReason };
  failSend?: boolean;
}) {
  const events: FakeEvent[] = [];
  const deliveries: FakeDelivery[] = [];
  let seq = 0;

  const prisma = {
    notificationEvent: {
      findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        return events.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event: FakeEvent = {
          id: `evt_${++seq}`,
          idempotencyKey: data.idempotencyKey as string,
          templateId: data.templateId as string,
        };
        events.push(event);
        return event;
      }),
    },
    notificationDelivery: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const delivery: FakeDelivery = {
          id: `dlv_${++seq}`,
          eventId: data.eventId as string,
          channel: data.channel as string,
          recipientEmail: (data.recipientEmail as string) ?? null,
          status: (data.status as NotificationDeliveryStatus) ?? 'PENDING',
          suppressionReason:
            (data.suppressionReason as NotificationSuppressionReason) ?? null,
          attempts: 0,
          lastError: null,
        };
        deliveries.push(delivery);
        return delivery;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const delivery = deliveries.find((d) => d.id === where.id)!;
          Object.assign(delivery, data);
          return delivery;
        },
      ),
    },
    notificationSuppression: {
      findUnique: jest.fn(async ({ where }: { where: { email: string } }) => {
        if (options?.suppression && options.suppression.email === where.email) {
          return { reason: options.suppression.reason };
        }
        return null;
      }),
    },
  };

  const mail = {
    sendRendered: jest.fn(async () => {
      if (options?.failSend) throw new Error('smtp unavailable');
      return { providerMessageId: 'msg_1' };
    }),
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'NOTIFICATION_RELEASED_GATES') {
        return options?.releasedGates ?? 'P0,P1,P2,INTERNAL';
      }
      if (key === 'APP_BASE_URL') return 'https://app.zoikomeds.com';
      if (key === 'SUPPORT_EMAIL') return 'support@zoikomeds.com';
      if (key === 'SUPPORT_CENTER_LINK') return 'https://app.zoikomeds.com/support';
      return undefined;
    }),
  };

  const service = new NotificationsService(
    prisma as never,
    mail as never,
    config as never,
  );

  return { service, prisma, mail, events, deliveries };
}

const RECIPIENT: Recipient = {
  email: 'Amara@Example.com',
  userId: 'usr_1',
  firstName: 'Amara',
};

const REG_004 = {
  templateId: 'REG-004',
  payload: {
    'Organization Name': 'Northside Pharmacy',
    'Organization Type': 'Community pharmacy',
    'Registration Reference': 'ZM-REG-10241',
    'Submission Date': 'July 24, 2026',
    'Registration Status Link': 'https://app.zoikomeds.com/registration/10241',
  },
  workflowType: 'registration',
  workflowRef: 'app_10241',
};

describe('NotificationsService.emit', () => {
  it('creates one event and dispatches every declared channel', async () => {
    const h = makeHarness();
    const result = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(result.created).toBe(true);
    // REG-004 declares EMAIL + IN_APP.
    expect(result.delivered).toBe(2);
    expect(result.suppressed).toBe(0);
    expect(h.events).toHaveLength(1);
    expect(h.mail.sendRendered).toHaveBeenCalledTimes(1);
  });

  it('collapses a retry of the same transition onto the existing event', async () => {
    const h = makeHarness();
    await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });
    const second = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(second.created).toBe(false);
    expect(h.events).toHaveLength(1);
    // No second send — that is the whole point of the idempotency key.
    expect(h.mail.sendRendered).toHaveBeenCalledTimes(1);
  });

  it('records the audit fields the engineering pack requires', async () => {
    const h = makeHarness();
    await h.service.emit({
      ...REG_004,
      recipients: [RECIPIENT],
      actor: { id: 'adm_1', email: 'reviewer@zoikomeds.com' },
    });

    const created = h.prisma.notificationEvent.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      templateId: 'REG-004',
      templateVersion: '1.0',
      baseEvent: 'REG-004',
      stream: 'TRANSACTIONAL',
      gate: 'P0',
      workflowType: 'registration',
      workflowRef: 'app_10241',
      actorId: 'adm_1',
      actorEmail: 'reviewer@zoikomeds.com',
      locale: 'en-US',
    });
    expect(created.idempotencyKey).toMatch(/^REG-004:[0-9a-f]{32}$/);
  });

  it('masks the recipient address on the delivery record', async () => {
    const h = makeHarness();
    await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    const emailDelivery = h.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(emailDelivery.recipientEmail).toBe('A***a@Example.com');
    expect(emailDelivery.recipientEmail).not.toContain('Amara@');
  });

  it('records the resolution rule so a misdirected message is traceable', async () => {
    const h = makeHarness();
    await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    const call = h.prisma.notificationDelivery.create.mock.calls[0][0].data;
    expect(call.recipientResolution).toBe('application.primaryContact');
  });

  it('suppresses dispatch when the template gate is not released', async () => {
    const h = makeHarness({ releasedGates: 'P1,P2' }); // P0 withheld
    const result = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(result.delivered).toBe(0);
    expect(result.suppressed).toBe(2);
    expect(h.mail.sendRendered).not.toHaveBeenCalled();
    expect(h.deliveries[0].suppressionReason).toBe('GATE_NOT_RELEASED');
  });

  it('suppresses when revalidation shows the state no longer holds', async () => {
    const h = makeHarness();
    const result = await h.service.emit({
      ...REG_004,
      recipients: [RECIPIENT],
      revalidate: async () => false,
    });

    expect(result.delivered).toBe(0);
    expect(h.deliveries[0].suppressionReason).toBe('STATE_REVALIDATION_FAILED');
    expect(h.mail.sendRendered).not.toHaveBeenCalled();
  });

  it('still records an event when there is no resolved recipient', async () => {
    const h = makeHarness();
    const result = await h.service.emit({ ...REG_004, recipients: [] });

    expect(result.created).toBe(true);
    expect(result.suppressed).toBe(1);
    expect(h.deliveries[0].suppressionReason).toBe('NO_RESOLVED_RECIPIENT');
  });

  it('ignores an unsubscribe on an essential stream', async () => {
    // A registration decision is transactional — the user cannot opt out of it
    // while the workflow is enabled.
    const h = makeHarness({
      suppression: {
        email: 'amara@example.com',
        reason: NotificationSuppressionReason.RECIPIENT_UNSUBSCRIBED,
      },
    });
    const result = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(result.delivered).toBe(2);
    expect(h.mail.sendRendered).toHaveBeenCalledTimes(1);
  });

  it('honors a hard bounce even on an essential stream', async () => {
    const h = makeHarness({
      suppression: {
        email: 'amara@example.com',
        reason: NotificationSuppressionReason.RECIPIENT_BOUNCED,
      },
    });
    const result = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(h.mail.sendRendered).not.toHaveBeenCalled();
    const emailDelivery = h.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(emailDelivery.suppressionReason).toBe('RECIPIENT_BOUNCED');
    // The in-app channel is unaffected by an email bounce.
    expect(result.delivered).toBe(1);
  });

  it('honors a spam complaint even on an essential stream', async () => {
    const h = makeHarness({
      suppression: {
        email: 'amara@example.com',
        reason: NotificationSuppressionReason.RECIPIENT_COMPLAINED,
      },
    });
    await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });
    expect(h.mail.sendRendered).not.toHaveBeenCalled();
  });

  it('records a transport failure without throwing, so the workflow survives', async () => {
    const h = makeHarness({ failSend: true });
    const result = await h.service.emit({ ...REG_004, recipients: [RECIPIENT] });

    expect(result.failed).toBe(1);
    const emailDelivery = h.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(emailDelivery.status).toBe('FAILED');
    expect(emailDelivery.lastError).toContain('smtp unavailable');
  });

  it('throws on a render defect rather than sending a broken message', async () => {
    const h = makeHarness();
    await expect(
      h.service.emit({
        templateId: 'REG-004',
        payload: { 'Organization Name': 'Northside Pharmacy' }, // rest missing
        recipients: [RECIPIENT],
        workflowRef: 'app_1',
      }),
    ).rejects.toThrow(/missing required field/);
  });

  it('refuses an unknown template ID', async () => {
    const h = makeHarness();
    await expect(
      h.service.emit({ templateId: 'NOPE-001', payload: {}, recipients: [] }),
    ).rejects.toThrow(/Unknown or unauthored/);
  });

  it('refuses a template that is registered but has no authored copy', async () => {
    // REG-014 is in the directory but its copy was never authored.
    const h = makeHarness();
    await expect(
      h.service.emit({ templateId: 'REG-014', payload: {}, recipients: [] }),
    ).rejects.toThrow(/Unknown or unauthored/);
  });

  it('keeps commercial templates undeliverable under the default gate set', async () => {
    // COM-* are CONDITIONAL and must stay disabled until commercial sign-off.
    const h = makeHarness();
    await expect(
      h.service.emit({ templateId: 'COM-003', payload: {}, recipients: [] }),
    ).rejects.toThrow(/Unknown or unauthored/);
  });
});
