import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationStatus,
  NotificationType,
  VerificationRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateNotificationDto } from './dto/create-notification.dto';

/** Verification-request states that are still waiting on a reviewer. */
const OPEN_REVIEW_STATUSES = [
  VerificationRequestStatus.PENDING,
  VerificationRequestStatus.UNDER_REVIEW,
  VerificationRequestStatus.ESCALATED,
  VerificationRequestStatus.REQUEST_INFO,
];

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * What the Super Admin console's bell should be telling an administrator.
   *
   * The bell used to read only `list()` — the broadcast outbox an admin
   * composes into. So a pharmacy could upload its licence, submit for
   * verification and sit in the queue with nobody told: there was no producer
   * for a verification submission anywhere in the platform, and no admin inbox
   * for one to write to.
   *
   * These rows are derived from the queue itself rather than written when a
   * submission happens. That is deliberate, and it is what makes the
   * "exactly one notification" rule hold by construction:
   *
   *  - one row per request still awaiting review, so a pharmacy that saves its
   *    profile ten times cannot produce ten notifications;
   *  - an autosave or a field edit that does not submit changes no request, so
   *    it raises nothing;
   *  - a failed upload throws before anything is written, so there is no row to
   *    describe a submission that did not happen;
   *  - reviewing a request removes it from the queue, and with it the reminder.
   *
   * Read-only, and SUPER_ADMIN/ADMIN only — it names pharmacies under review.
   */
  async inbox() {
    const requests = await this.prisma.verificationRequest.findMany({
      where: { status: { in: OPEN_REVIEW_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        pharmacyId: true,
        pharmacyName: true,
        docName: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (requests.length === 0) return [];

    // How many requests each pharmacy has ever filed, which is what separates a
    // first submission from a resubmission without storing a flag for it.
    const pharmacyIds = requests
      .map((r) => r.pharmacyId)
      .filter((id): id is string => id !== null);
    const priorCounts = new Map<string, number>();
    if (pharmacyIds.length > 0) {
      const grouped = await this.prisma.verificationRequest.groupBy({
        by: ['pharmacyId'],
        where: { pharmacyId: { in: pharmacyIds } },
        _count: { _all: true },
      });
      for (const g of grouped) {
        if (g.pharmacyId) priorCounts.set(g.pharmacyId, g._count._all);
      }
    }

    return requests.map((r) => {
      const name = r.pharmacyName || 'A pharmacy';
      const attached = !!r.docName;
      // A note per resubmission is appended to a reused request, so more than
      // one line is itself evidence of a resubmission.
      const appended = (r.notes ?? '').split('\n').filter(Boolean).length > 1;
      const resubmitted =
        appended || (r.pharmacyId ? (priorCounts.get(r.pharmacyId) ?? 1) > 1 : false);

      const message = resubmitted
        ? `${name} updated and resubmitted its verification request.`
        : attached
          ? `${name} submitted verification documents for review.`
          : `${name} submitted a verification request. No document is attached.`;

      return {
        // Prefixed so nothing mistakes a derived row for a broadcast it could
        // delete, and so the bell can key on it stably across polls.
        id: `verification-${r.id}`,
        kind: 'verification' as const,
        requestId: r.id,
        title: `${name} — verification review needed`,
        message,
        // No document on a request needing review is the case a reviewer has to
        // act on differently, so it reads as a warning rather than as news.
        severity: attached ? 'serious' : 'warning',
        status: r.status,
        documentAttached: attached,
        date: r.updatedAt,
      };
    });
  }

  async list() {
    const rows = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => this.toDto(n));
  }

  async create(
    actorId: string,
    actorEmail: string,
    dto: CreateNotificationDto,
    ipAddress?: string,
  ) {
    // Only an emergency alert carries a safety category. Dropping it on the
    // other three types is deliberate: a stored classification on a broadcast
    // that is not a safety alert would be a value nothing consults, and the
    // next reader would have to guess whether it meant anything.
    const safetyKind =
      dto.type === NotificationType.EMERGENCY_ALERT ? (dto.safetyKind ?? null) : null;

    const notification = await this.prisma.notification.create({
      data: {
        title: dto.title,
        message: dto.message,
        type: dto.type,
        target: dto.target,
        safetyKind,
        status: dto.status ?? NotificationStatus.DISPATCHED,
        createdBy: actorEmail,
      },
    });
    await this.audit.write(
      actorId,
      'admin.notification.create',
      'Notification',
      notification.id,
      {
        title: notification.title,
        target: notification.target,
        type: notification.type,
        // Recorded because it decides which patients are eligible to receive
        // the broadcast at all.
        safetyKind: notification.safetyKind,
      },
      ipAddress,
    );
    return this.toDto(notification);
  }

  async remove(actorId: string, id: string, ipAddress?: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Notification not found');
    await this.prisma.notification.delete({ where: { id } });
    await this.audit.write(
      actorId,
      'admin.notification.delete',
      'Notification',
      id,
      undefined,
      ipAddress,
    );
    return { id, deleted: true };
  }

  private toDto(n: Notification) {
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      target: n.target,
      safetyKind: n.safetyKind,
      status: n.status,
      date: n.createdAt,
      createdBy: n.createdBy,
    };
  }
}
