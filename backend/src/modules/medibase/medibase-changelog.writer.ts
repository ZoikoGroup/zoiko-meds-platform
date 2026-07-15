import { Injectable } from '@nestjs/common';
import { Prisma, QualityState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Writes the MediBase™ change-log: an immutable, field-level lineage trail for
 * every mutation to a governed medicine identity. Also mirrors a coarse entry
 * into the platform-wide AuditLog so governance/observability sees MediBase
 * curation alongside all other sensitive actions.
 *
 * Change-logging is best-effort with respect to the caller: a logging failure
 * must never roll back a successful curation write, so callers await this after
 * the primary mutation and it swallows its own errors defensively.
 */

export interface ChangeLogEntry {
  action: 'create' | 'update' | 'state_transition' | 'identifier.add' | 'identifier.remove';
  field?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  fromState?: QualityState;
  toState?: QualityState;
  schemaVersion?: number;
  note?: string;
}

@Injectable()
export class MedibaseChangeLogWriter {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    actorId: string | null,
    medicineId: string,
    entry: ChangeLogEntry,
  ): Promise<void> {
    const actorEmail = await this.resolveActorEmail(actorId);
    await this.prisma.medicineChangeLog.create({
      data: {
        medicineId,
        action: entry.action,
        field: entry.field ?? null,
        previousValue: entry.previousValue ?? Prisma.JsonNull,
        newValue: entry.newValue ?? Prisma.JsonNull,
        fromState: entry.fromState ?? null,
        toState: entry.toState ?? null,
        schemaVersion: entry.schemaVersion ?? 1,
        actorId,
        actorEmail,
        note: entry.note ?? null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorEmail,
        action: `medibase.${entry.action}`,
        entityType: 'MedicineEntity',
        entityId: medicineId,
        severity: entry.action === 'state_transition' ? 'WARNING' : 'INFO',
        metadata: {
          field: entry.field ?? null,
          fromState: entry.fromState ?? null,
          toState: entry.toState ?? null,
          note: entry.note ?? null,
        },
      },
    });
  }

  private async resolveActorEmail(actorId: string | null): Promise<string | null> {
    if (!actorId) return null;
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { email: true },
    });
    return actor?.email ?? null;
  }
}
