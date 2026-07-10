import { Injectable } from '@nestjs/common';
import { AuditSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Centralized audit-log writer shared by every admin sub-service. Resolves the
 * actor's email for fast display and derives a severity from the action verb.
 */
@Injectable()
export class AuditWriter {
  constructor(private readonly prisma: PrismaService) {}

  async write(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Prisma.InputJsonValue,
    ipAddress?: string,
  ) {
    let actorEmail: string | null = null;
    if (actorId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { email: true },
      });
      actorEmail = actor?.email ?? null;
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorEmail,
        action,
        entityType,
        entityId,
        severity: this.severityFor(action),
        metadata,
        ipAddress,
      },
    });
  }

  private severityFor(action: string): AuditSeverity {
    const a = action.toLowerCase();
    if (/(role|password|delete)/.test(a)) return AuditSeverity.SECURITY_ALERT;
    if (/(deactivate|suspend|reject|escalate)/.test(a)) {
      return AuditSeverity.WARNING;
    }
    return AuditSeverity.INFO;
  }
}
