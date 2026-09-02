import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  NotificationTarget,
  NotificationType,
  SafetyAlertKind,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationService } from './notification.service';

/**
 * Saying which safety category an emergency broadcast is, instead of guessing.
 *
 * ZoikoSignal split a dispatched EMERGENCY_ALERT into the patient's two safety
 * categories with `/recall/i.test(title)`. So which of a patient's two toggles
 * governed a broadcast depended on how an administrator worded its heading:
 * "Urgent product withdrawal" was filed as a government advisory, and a recall
 * *drill* announcement was filed as a recall. The administrator dispatching it
 * now says which it is, and the classification is a stored enum.
 */

const ACTOR = { id: 'admin_1', email: 'ops@zoikomeds.io' };

function buildService() {
  const prisma: any = {
    notification: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'bc_1',
        createdAt: new Date(),
        safetyKind: null,
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    verificationRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { write: jest.fn() };
  const service = new NotificationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
  );
  return { service, prisma, audit };
}

const body = (over: Record<string, unknown> = {}) => ({
  title: 'Urgent product withdrawal',
  message: 'Return affected packs to your pharmacy.',
  type: NotificationType.EMERGENCY_ALERT,
  target: NotificationTarget.ALL_USERS,
  ...over,
});

const errorsFor = async (over: Record<string, unknown> = {}) =>
  validate(plainToInstance(CreateNotificationDto, body(over)));

const fieldsWithErrors = async (over: Record<string, unknown> = {}) =>
  (await errorsFor(over)).map((e) => e.property);

describe('an emergency alert must state its safety category', () => {
  it('is refused without one', async () => {
    // Validated on the backend, not only in the compose dialog: a client that
    // skips the field must be refused rather than silently guessed at.
    expect(await fieldsWithErrors()).toContain('safetyKind');
  });

  it('names both allowed values in the message', async () => {
    const [error] = (await errorsFor()).filter((e) => e.property === 'safetyKind');

    expect(Object.values(error.constraints ?? {}).join(' ')).toMatch(
      /MEDICINE_RECALL.*GOVERNMENT_SAFETY/,
    );
  });

  it('is refused with a value that is not a safety category', async () => {
    expect(await fieldsWithErrors({ safetyKind: 'PRODUCT_WITHDRAWAL' })).toContain(
      'safetyKind',
    );
  });

  it.each([SafetyAlertKind.MEDICINE_RECALL, SafetyAlertKind.GOVERNMENT_SAFETY])(
    'accepts %s',
    async (safetyKind) => {
      expect(await fieldsWithErrors({ safetyKind })).not.toContain('safetyKind');
    },
  );
});

describe('the other three channels do not carry one', () => {
  it.each([
    NotificationType.PLATFORM_UPDATE,
    NotificationType.MAINTENANCE,
    NotificationType.SYSTEM_ANNOUNCEMENT,
  ])('%s validates without a safety category', async (type) => {
    expect(await fieldsWithErrors({ type })).not.toContain('safetyKind');
  });

  it.each([
    NotificationType.PLATFORM_UPDATE,
    NotificationType.MAINTENANCE,
    NotificationType.SYSTEM_ANNOUNCEMENT,
  ])('%s stores null even when one is sent', async (type) => {
    // Ignored rather than stored: a classification on a broadcast that never
    // becomes a patient safety notification is a value nothing consults.
    const { service, prisma } = buildService();

    await service.create(
      ACTOR.id,
      ACTOR.email,
      body({ type, safetyKind: SafetyAlertKind.MEDICINE_RECALL }) as CreateNotificationDto,
    );

    expect(prisma.notification.create.mock.calls[0][0].data.safetyKind).toBeNull();
  });
});

describe('what gets stored', () => {
  it('stores MEDICINE_RECALL when that is what was chosen', async () => {
    // The title says "withdrawal", not "recall". The choice decides, not the
    // wording — which is the whole point of the change.
    const { service, prisma } = buildService();

    await service.create(
      ACTOR.id,
      ACTOR.email,
      body({
        title: 'Urgent product withdrawal',
        safetyKind: SafetyAlertKind.MEDICINE_RECALL,
      }) as CreateNotificationDto,
    );

    const { data } = prisma.notification.create.mock.calls[0][0];
    expect(data.safetyKind).toBe(SafetyAlertKind.MEDICINE_RECALL);
    expect(data.title).toBe('Urgent product withdrawal');
  });

  it('stores GOVERNMENT_SAFETY when that is what was chosen', async () => {
    const { service, prisma } = buildService();

    await service.create(
      ACTOR.id,
      ACTOR.email,
      body({
        title: 'National regulator advisory',
        safetyKind: SafetyAlertKind.GOVERNMENT_SAFETY,
      }) as CreateNotificationDto,
    );

    expect(prisma.notification.create.mock.calls[0][0].data.safetyKind).toBe(
      SafetyAlertKind.GOVERNMENT_SAFETY,
    );
  });

  it('keeps the existing dispatch default', async () => {
    const { service, prisma } = buildService();

    await service.create(
      ACTOR.id,
      ACTOR.email,
      body({ safetyKind: SafetyAlertKind.MEDICINE_RECALL }) as CreateNotificationDto,
    );

    const { data } = prisma.notification.create.mock.calls[0][0];
    expect(data.status).toBe('DISPATCHED');
    expect(data.target).toBe(NotificationTarget.ALL_USERS);
    expect(data.createdBy).toBe(ACTOR.email);
  });

  it('returns it, so the console can show what was sent', async () => {
    const { service, prisma } = buildService();
    prisma.notification.create.mockResolvedValue({
      id: 'bc_1',
      title: 'Urgent product withdrawal',
      message: 'Return affected packs.',
      type: NotificationType.EMERGENCY_ALERT,
      target: NotificationTarget.ALL_USERS,
      safetyKind: SafetyAlertKind.MEDICINE_RECALL,
      status: 'DISPATCHED',
      createdBy: ACTOR.email,
      createdAt: new Date(),
    });

    const dto = await service.create(
      ACTOR.id,
      ACTOR.email,
      body({ safetyKind: SafetyAlertKind.MEDICINE_RECALL }) as CreateNotificationDto,
    );

    expect(dto.safetyKind).toBe(SafetyAlertKind.MEDICINE_RECALL);
  });
});

describe('the existing audit trail records it', () => {
  it('names the category on the existing action', async () => {
    // Reused writer, existing action — it decides which patients are eligible
    // to receive the broadcast, so it belongs in the entry.
    const { service, audit } = buildService();

    await service.create(
      ACTOR.id,
      ACTOR.email,
      body({ safetyKind: SafetyAlertKind.GOVERNMENT_SAFETY }) as CreateNotificationDto,
    );

    const [actorId, action, entity, , meta] = audit.write.mock.calls[0];
    expect(actorId).toBe(ACTOR.id);
    expect(action).toBe('admin.notification.create');
    expect(entity).toBe('Notification');
    expect(meta).toMatchObject({
      type: NotificationType.EMERGENCY_ALERT,
      safetyKind: SafetyAlertKind.GOVERNMENT_SAFETY,
    });
  });
});
