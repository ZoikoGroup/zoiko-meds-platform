import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationGate,
  NotificationStream,
  NotificationSuppressionReason,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { findTemplate } from './catalog';
import { renderTemplate, TemplateRenderError } from './template.renderer';
import type { EmailTemplate } from './template.types';

/**
 * ZM-NOT-EMAIL-02 dispatch.
 *
 * One authoritative state transition produces one immutable NotificationEvent;
 * every channel is rendered from that record. Retries of the same transition
 * collapse onto the same idempotency key rather than re-sending.
 */

export interface Recipient {
  email: string;
  userId?: string;
  /** First name used for the greeting. */
  firstName?: string;
}

export interface EmitArgs {
  /** Deployable template ID, e.g. "REG-004". */
  templateId: string;
  /** Merge data. Keys are placeholder names without braces. */
  payload: Record<string, unknown>;
  recipients: Recipient[];
  /** Record that caused the transition — the application, case, or request id. */
  workflowRef?: string;
  workflowType?: string;
  /** Actor for administrator-generated events. Null for system events. */
  actor?: { id?: string; email?: string };
  /**
   * Overrides the derived idempotency key. Supply when the natural key is not
   * (template, workflowRef) — for example a recurring reminder that legitimately
   * sends more than once per workflow record.
   */
  idempotencyKey?: string;
  locale?: string;
  /**
   * Re-checks the authoritative state immediately before dispatch. Returning
   * false suppresses delivery with STATE_REVALIDATION_FAILED — this is what
   * stops a queued "information still outstanding" reminder from going out
   * after the applicant has already responded.
   */
  revalidate?: () => Promise<boolean>;
}

export interface EmitResult {
  eventId: string;
  /** False when an event with the same idempotency key already existed. */
  created: boolean;
  delivered: number;
  suppressed: number;
  failed: number;
}

/** Streams a recipient may never opt out of while a workflow is enabled. */
const ESSENTIAL_STREAMS: NotificationStream[] = [
  NotificationStream.TRANSACTIONAL,
  NotificationStream.SECURITY,
  NotificationStream.LEGAL,
  NotificationStream.OPERATIONAL,
  NotificationStream.INTERNAL,
];

/** Suppression reasons that block delivery even on an essential stream. */
const HARD_SUPPRESSIONS: NotificationSuppressionReason[] = [
  NotificationSuppressionReason.RECIPIENT_BOUNCED,
  NotificationSuppressionReason.RECIPIENT_COMPLAINED,
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Gates cleared for dispatch. CONDITIONAL stays closed until commercial sign-off. */
  private readonly releasedGates: Set<NotificationGate>;
  private readonly allowedLinkHosts: string[];
  private readonly supportEmail: string;
  private readonly supportCenterLink: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    const configured = (
      this.config.get<string>('NOTIFICATION_RELEASED_GATES') ?? 'P0,P1,P2,INTERNAL'
    )
      .split(',')
      .map((gate) => gate.trim().toUpperCase())
      .filter((gate): gate is NotificationGate =>
        Object.values(NotificationGate).includes(gate as NotificationGate),
      );
    this.releasedGates = new Set(configured);

    const appBaseUrl = (
      this.config.get<string>('APP_BASE_URL') || 'https://app.zoikomeds.com'
    ).replace(/\/+$/, '');
    const derivedHost = safeHostname(appBaseUrl);
    this.allowedLinkHosts = (
      this.config.get<string>('NOTIFICATION_ALLOWED_LINK_HOSTS') ?? ''
    )
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
      .concat(derivedHost ? [derivedHost] : []);

    this.supportEmail =
      this.config.get<string>('SUPPORT_EMAIL') || 'support@zoikomeds.com';
    this.supportCenterLink =
      this.config.get<string>('SUPPORT_CENTER_LINK') || `${appBaseUrl}/support`;

    if (this.releasedGates.has(NotificationGate.CONDITIONAL)) {
      this.logger.warn(
        'CONDITIONAL gate is released — commercial templates will dispatch. Confirm commercial, tax, payment, refund, and regulatory sign-off is in place.',
      );
    }
  }

  /**
   * Records the event and dispatches every channel the template declares.
   *
   * Never throws for delivery problems: a failed send is recorded on the
   * delivery row so the primary workflow (application submitted, password
   * changed) is not rolled back by a mail outage. Programming errors —
   * unknown template, inactive template, missing merge field — do throw,
   * because those are release defects that must fail loudly in test.
   */
  async emit(args: EmitArgs): Promise<EmitResult> {
    const template = this.resolveTemplate(args.templateId);
    const idempotencyKey = args.idempotencyKey ?? deriveIdempotencyKey(args);

    const existing = await this.prisma.notificationEvent.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `Duplicate notification suppressed for ${template.id} (key=${idempotencyKey})`,
      );
      return {
        eventId: existing.id,
        created: false,
        delivered: 0,
        suppressed: 1,
        failed: 0,
      };
    }

    const event = await this.prisma.notificationEvent.create({
      data: {
        templateId: template.id,
        templateVersion: template.version,
        baseEvent: template.baseEvent,
        stream: template.stream,
        gate: template.gate,
        idempotencyKey,
        workflowRef: args.workflowRef ?? null,
        workflowType: args.workflowType ?? null,
        payload: args.payload as Prisma.InputJsonValue,
        locale: args.locale ?? 'en-US',
        actorId: args.actor?.id ?? null,
        actorEmail: args.actor?.email ?? null,
      },
      select: { id: true },
    });

    const blanketSuppression = await this.blanketSuppressionFor(template, args);

    let delivered = 0;
    let suppressed = 0;
    let failed = 0;

    for (const recipient of args.recipients) {
      for (const channel of template.channels) {
        const outcome = await this.deliver({
          eventId: event.id,
          template,
          channel,
          recipient,
          payload: args.payload,
          blanketSuppression,
        });
        if (outcome === NotificationDeliveryStatus.SENT) delivered++;
        else if (outcome === NotificationDeliveryStatus.SUPPRESSED) suppressed++;
        else if (outcome === NotificationDeliveryStatus.FAILED) failed++;
      }
    }

    if (args.recipients.length === 0) {
      await this.prisma.notificationDelivery.create({
        data: {
          eventId: event.id,
          channel: NotificationChannel.EMAIL,
          recipientResolution: template.recipientResolution,
          status: NotificationDeliveryStatus.SUPPRESSED,
          suppressionReason:
            NotificationSuppressionReason.NO_RESOLVED_RECIPIENT,
        },
      });
      suppressed++;
      this.logger.warn(
        `${template.id} emitted with no resolved recipient (workflowRef=${args.workflowRef ?? 'n/a'})`,
      );
    }

    return { eventId: event.id, created: true, delivered, suppressed, failed };
  }

  // --- internals -------------------------------------------------------------

  private resolveTemplate(templateId: string): EmailTemplate {
    const template = findTemplate(templateId);
    if (!template) {
      throw new Error(
        `Unknown or unauthored notification template "${templateId}". ` +
          'Templates must be registered in the catalog with accepted copy before use.',
      );
    }
    if (!template.active) {
      throw new Error(
        `Notification template "${templateId}" is registered but not active.`,
      );
    }
    return template;
  }

  /**
   * Suppression that applies to the whole event rather than one recipient:
   * an unreleased gate, or authoritative state that no longer holds.
   */
  private async blanketSuppressionFor(
    template: EmailTemplate,
    args: EmitArgs,
  ): Promise<NotificationSuppressionReason | null> {
    if (!this.releasedGates.has(template.gate)) {
      return NotificationSuppressionReason.GATE_NOT_RELEASED;
    }
    if (args.revalidate) {
      const stillValid = await args.revalidate();
      if (!stillValid) {
        return NotificationSuppressionReason.STATE_REVALIDATION_FAILED;
      }
    }
    return null;
  }

  private async deliver(input: {
    eventId: string;
    template: EmailTemplate;
    channel: NotificationChannel;
    recipient: Recipient;
    payload: Record<string, unknown>;
    blanketSuppression: NotificationSuppressionReason | null;
  }): Promise<NotificationDeliveryStatus> {
    const { eventId, template, channel, recipient, payload } = input;

    const suppression =
      input.blanketSuppression ??
      (channel === NotificationChannel.EMAIL
        ? await this.recipientSuppressionFor(template, recipient.email)
        : null);

    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        eventId,
        channel,
        recipientEmail: maskEmail(recipient.email),
        recipientUserId: recipient.userId ?? null,
        recipientResolution: template.recipientResolution,
        status: suppression
          ? NotificationDeliveryStatus.SUPPRESSED
          : NotificationDeliveryStatus.PENDING,
        suppressionReason: suppression,
      },
      select: { id: true },
    });

    if (suppression) return NotificationDeliveryStatus.SUPPRESSED;

    // IN_APP is recorded here and surfaced by the in-app notification reader;
    // there is no external provider to call.
    if (channel === NotificationChannel.IN_APP) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          attempts: 1,
          sentAt: new Date(),
        },
      });
      return NotificationDeliveryStatus.SENT;
    }

    try {
      const rendered = renderTemplate(template, {
        payload: { ...payload, 'Recipient First Name': recipient.firstName ?? '' },
        allowedLinkHosts: this.allowedLinkHosts,
        supportEmail: this.supportEmail,
        supportCenterLink: this.supportCenterLink,
      });

      await this.mail.sendRendered({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        stream: template.stream,
      });

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          attempts: 1,
          sentAt: new Date(),
        },
      });
      return NotificationDeliveryStatus.SENT;
    } catch (err) {
      const message = (err as Error).message;
      // A render error is a release defect, not a transient failure. Record it
      // and re-throw so it surfaces in test rather than silently degrading.
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          attempts: 1,
          lastError: message.slice(0, 500),
        },
      });
      if (err instanceof TemplateRenderError) throw err;
      this.logger.error(`${template.id} delivery failed: ${message}`);
      return NotificationDeliveryStatus.FAILED;
    }
  }

  private async recipientSuppressionFor(
    template: EmailTemplate,
    email: string,
  ): Promise<NotificationSuppressionReason | null> {
    const record = await this.prisma.notificationSuppression.findUnique({
      where: { email: email.toLowerCase() },
      select: { reason: true },
    });
    if (!record) return null;

    // Hard bounces and complaints always block — continuing to send damages
    // domain reputation for every other stream.
    if (HARD_SUPPRESSIONS.includes(record.reason)) return record.reason;

    // An unsubscribe cannot stop a message the workflow requires.
    if (ESSENTIAL_STREAMS.includes(template.stream)) return null;

    return record.reason;
  }
}

// --- helpers ------------------------------------------------------------------

/**
 * Natural key for a transition: template + workflow record. Hashed so a long
 * reference cannot overflow the column, and prefixed so keys stay readable in
 * the audit view.
 */
function deriveIdempotencyKey(args: EmitArgs): string {
  const basis = [
    args.templateId,
    args.workflowType ?? '',
    args.workflowRef ?? '',
    args.workflowRef ? '' : JSON.stringify(args.payload),
  ].join('|');
  const digest = createHash('sha256').update(basis).digest('hex').slice(0, 32);
  return `${args.templateId}:${digest}`;
}

/** Masks an address for the audit view — `j****e@example.com`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
