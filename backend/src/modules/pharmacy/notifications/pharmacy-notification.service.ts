import { Injectable, Logger } from '@nestjs/common';
import { SignalNotificationType, UserRole } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Writes the pharmacy portal's own notification rows.
 *
 * The portal reads SignalNotification scoped to the logged-in user, and a row's
 * category is derived from its `dedupeKey` prefix rather than from a stored
 * column (see `notificationCategory` in pharmacy.service.ts). These two
 * prefixes are therefore the contract between this writer and that reader, and
 * they are exported so neither side hard-codes the string — a typo in one of
 * them is a silently empty filter tab, which is exactly how the Inventory and
 * Uploads tabs came to read as broken.
 *
 * `SignalNotificationType` describes patient availability signals and has no
 * member for "a pharmacy uploaded a file". The type is a carrier here, the way
 * the verification workflow already uses SAFETY: the prefix is the honest
 * discriminator, and the type only has to be a value the column accepts.
 *
 * Nothing in here throws into its caller. A pharmacy's inventory write is the
 * authoritative act; failing to tell them about it afterwards must not roll it
 * back.
 */

/** Availability events about this pharmacy's own stock — the Inventory tab. */
export const PHARMACY_INVENTORY_KEY_PREFIX = 'inventory:';

/** Bulk import outcomes — the Uploads tab. */
export const PHARMACY_UPLOAD_KEY_PREFIX = 'upload:';

/** Roles that hold a pharmacy portal seat, and so should see these rows. */
const PORTAL_ROLES: UserRole[] = [UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF];

export interface BulkUploadOutcome {
  imported: number;
  updated: number;
  skipped: number;
  totalProcessed: number;
  mode: 'merge' | 'replace';
}

interface RowContent {
  dedupeKey: string;
  type: SignalNotificationType;
  medicineId?: string | null;
  medicineName: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionKind?: string;
  actionQuery?: string;
}

@Injectable()
export class PharmacyNotificationService {
  private readonly logger = new Logger(PharmacyNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A medicine this pharmacy holds is now visible to patients as available.
   *
   * Raised on the transition, not on every save: a row re-saved as available
   * when it was already available is not news, and repeating it would bury the
   * transitions that are. The key carries `occurredAtMs` so each genuine
   * transition is its own unread row rather than upserting over one the
   * pharmacy has already read.
   */
  async inventoryBecameAvailable(
    pharmacyId: string,
    medicine: { id: string; canonicalName: string; strength?: string | null },
    occurredAtMs: number,
  ): Promise<void> {
    const label = this.labelFor(medicine);

    await this.fanOut(pharmacyId, {
      dedupeKey: `${PHARMACY_INVENTORY_KEY_PREFIX}${medicine.id}:available:${occurredAtMs}`,
      type: SignalNotificationType.BACK_IN_STOCK,
      medicineId: medicine.id,
      medicineName: medicine.canonicalName,
      title: `${label} is now available to patients`,
      description:
        'Patients searching for this medicine can now see your pharmacy as a place to get it. Keep the status current — an availability signal patients cannot rely on is worse than none.',
      actionLabel: 'Review inventory',
      actionKind: 'inventory',
      actionQuery: medicine.canonicalName,
    });
  }

  /**
   * A medicine this pharmacy holds is no longer fully available to patients.
   *
   * The counterpart transition. A pharmacy that marked something out of stock
   * from a CSV it did not read closely needs to see that as plainly as it sees
   * the additions.
   */
  async inventoryBecameUnavailable(
    pharmacyId: string,
    medicine: { id: string; canonicalName: string; strength?: string | null },
    status: string,
    occurredAtMs: number,
  ): Promise<void> {
    const label = this.labelFor(medicine);
    const limited = status === 'limited';

    await this.fanOut(pharmacyId, {
      dedupeKey: `${PHARMACY_INVENTORY_KEY_PREFIX}${medicine.id}:${status}:${occurredAtMs}`,
      type: limited ? SignalNotificationType.LIMITED : SignalNotificationType.RUNNING_LOW,
      medicineId: medicine.id,
      medicineName: medicine.canonicalName,
      title: limited
        ? `${label} is now showing limited availability`
        : `${label} is no longer available to patients`,
      description: limited
        ? 'Patients see this medicine as available in limited quantity at your pharmacy.'
        : 'Patients searching for this medicine will no longer see your pharmacy. Set it back to available as soon as you restock.',
      actionLabel: 'Review inventory',
      actionKind: 'inventory',
      actionQuery: medicine.canonicalName,
    });
  }

  /**
   * Outcome of a bulk CSV import.
   *
   * Wording follows the three approved INV-006/INV-007 directory outcomes —
   * completed, completed with errors, failed — so the in-app row and the email
   * template that eventually covers the same event cannot describe one import
   * two different ways. Rows the importer skipped are reported rather than
   * rounded away: a file where half the lines were dropped must not read as a
   * clean upload.
   */
  async bulkUploadCompleted(
    pharmacyId: string,
    outcome: BulkUploadOutcome,
    occurredAtMs: number,
  ): Promise<void> {
    const { imported, updated, skipped, totalProcessed, mode } = outcome;
    const applied = imported + updated;
    const failed = applied === 0 && skipped > 0;
    const rows = `${totalProcessed} row${totalProcessed === 1 ? '' : 's'}`;

    const title = failed
      ? 'Bulk inventory upload failed'
      : skipped > 0
        ? 'Bulk upload completed with errors'
        : 'Bulk inventory upload completed';

    const description = failed
      ? `None of the ${rows} in your file could be applied. Check that every row carries a name — or a medicineId the catalog recognises — then upload the file again.`
      : skipped > 0
        ? `${imported} added, ${updated} updated, ${skipped} skipped of ${rows}. Skipped rows were left out of your inventory rather than guessed at — re-upload them once corrected.`
        : `${imported} added, ${updated} updated of ${rows}. Your inventory is live for patients${
            mode === 'replace' ? ', and medicines absent from the file were removed' : ''
          }.`;

    await this.fanOut(pharmacyId, {
      dedupeKey: `${PHARMACY_UPLOAD_KEY_PREFIX}${pharmacyId}:${occurredAtMs}`,
      type: SignalNotificationType.SAFETY,
      medicineName: 'Inventory Upload',
      title,
      description,
      actionLabel: 'View inventory',
      actionKind: 'inventory',
    });
  }

  // ---------------------------------------------------------------------------

  private labelFor(medicine: { canonicalName: string; strength?: string | null }): string {
    const strength = (medicine.strength ?? '').trim();
    return strength ? `${medicine.canonicalName} ${strength}` : medicine.canonicalName;
  }

  /**
   * Write one row per portal user at this pharmacy.
   *
   * Every seat, including whoever performed the action: a manager who uploaded
   * a file wants the counts back, and staff on another terminal have no other
   * way to learn what changed. Upserted on (userId, dedupeKey) so a retried
   * request refreshes a row instead of stacking duplicates, and — as everywhere
   * else in this table — an update never resurrects read, dismissed or archived
   * state.
   */
  private async fanOut(pharmacyId: string, content: RowContent): Promise<void> {
    try {
      const recipients = await this.prisma.user.findMany({
        where: { pharmacyId, role: { in: PORTAL_ROLES } },
        select: { id: true },
      });

      if (recipients.length === 0) {
        this.logger.warn(
          `No portal user linked to pharmacy ${pharmacyId} — "${content.title}" has nowhere to go.`,
        );
        return;
      }

      for (const recipient of recipients) {
        await this.prisma.signalNotification.upsert({
          where: {
            userId_dedupeKey: { userId: recipient.id, dedupeKey: content.dedupeKey },
          },
          create: {
            userId: recipient.id,
            dedupeKey: content.dedupeKey,
            type: content.type,
            medicineId: content.medicineId ?? null,
            medicineName: content.medicineName,
            title: content.title,
            description: content.description,
            actionLabel: content.actionLabel ?? null,
            actionKind: content.actionKind ?? null,
            actionQuery: content.actionQuery ?? null,
          },
          // Refresh the copy only. Never resurrect a row the pharmacy has
          // already read, dismissed or archived.
          update: {
            title: content.title,
            description: content.description,
            occurredAt: new Date(),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to raise pharmacy notification "${content.title}" for ${pharmacyId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }
}
