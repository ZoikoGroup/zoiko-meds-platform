import { Injectable, Logger } from '@nestjs/common';
import { MedicineEntity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Links name-only saved medicines to a governed MediBase identity, and raises
 * the "now available" alert for the patients who were waiting on it.
 *
 * A patient may save a medicine the catalog has never seen. That row carries a
 * normalized name and no `medicineId`. The first time a verified pharmacy adds
 * that medicine — which is also the moment `MedicineEntity` is created — this
 * service attaches the identity and notifies whoever was following it.
 *
 * Everything downstream is existing machinery: the notification is a normal
 * SignalNotification whose `@@unique([userId, dedupeKey])` makes it idempotent,
 * and once `medicineId` is set the medicine flows through the regular
 * availability regeneration like any other saved medicine.
 */

/**
 * Matching key for a medicine name: lower-cased, with every non-alphanumeric
 * character removed. Deliberately conservative — it absorbs case, spacing,
 * hyphens and punctuation ("Volini Gel" / "volini-gel" / "VOLINI  GEL") but
 * never guesses at spelling. Fuzzy correction belongs at the point a human can
 * confirm it, not in a silent background link.
 *
 * MUST stay in step with the backfill expression in the
 * 20260814120000_saved_medicine_off_catalog migration.
 */
export function normalizeMedicineName(name: string): string {
  return (name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class SavedMedicineLinkService {
  private readonly logger = new Logger(SavedMedicineLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attach `medicine` to every unlinked save whose normalized name matches, and
   * alert those patients that it is now available.
   *
   * Call after a medicine is created or confirmed by a pharmacy inventory
   * update. Never throws into the caller: a failure here must not roll back the
   * pharmacy's inventory write.
   *
   * @returns the number of saved rows linked.
   */
  async linkPendingSaves(medicine: Pick<MedicineEntity, 'id' | 'canonicalName'>): Promise<number> {
    try {
      const normalizedName = normalizeMedicineName(medicine.canonicalName);
      if (!normalizedName) return 0;

      const pending = await this.prisma.savedMedicine.findMany({
        where: { medicineId: null, normalizedName },
        select: { id: true, userId: true, medicineName: true, alertsEnabled: true },
      });
      if (pending.length === 0) return 0;

      const linkedAt = new Date();
      await this.prisma.savedMedicine.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: {
          medicineId: medicine.id,
          linkedAt,
          // Clear the notified state so the regular availability generator
          // treats this as a fresh transition rather than a repeat.
          notifiedStatus: null,
        },
      });

      for (const row of pending) {
        // Respect the patient's own switch. An unsaved medicine is not in
        // `pending` at all, so unsaving equally stops the alert.
        if (!row.alertsEnabled) continue;
        await this.notifyNowAvailable(row.userId, medicine, row.medicineName);
      }

      this.logger.log(
        `Linked ${pending.length} saved medicine(s) to ${medicine.canonicalName} (${medicine.id}).`,
      );
      return pending.length;
    } catch (err) {
      this.logger.error(
        `Failed to link saved medicines for "${medicine.canonicalName}": ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return 0;
    }
  }

  /**
   * Raise the one-off "now available" alert.
   *
   * The dedupe key is scoped to the medicine, so re-running the link (a second
   * pharmacy adding the same medicine, a retried request, a replayed import)
   * updates the existing row in place instead of stacking notifications. Read /
   * dismissed / archived state is deliberately left untouched.
   */
  private async notifyNowAvailable(
    userId: string,
    medicine: Pick<MedicineEntity, 'id' | 'canonicalName'>,
    savedAs: string,
  ): Promise<void> {
    // Honour the patient's category preference for restock alerts. Absent
    // preferences mean defaults, which enable it.
    const preference = await this.prisma.signalNotificationPreference.findUnique({
      where: { userId },
      select: { backInStock: true },
    });
    if (preference && !preference.backInStock) return;

    const dedupeKey = `saved-linked:${medicine.id}`;
    const displayName = savedAs || medicine.canonicalName;

    await this.prisma.signalNotification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey } },
      create: {
        userId,
        dedupeKey,
        type: 'BACK_IN_STOCK',
        medicineId: medicine.id,
        medicineName: medicine.canonicalName,
        title: `${displayName} is now available`,
        description: `${displayName} is now available at a nearby pharmacy. Availability is a confidence signal from verified pharmacies — please confirm with the pharmacy before visiting.`,
        actionLabel: 'Check availability',
        actionKind: 'search',
        actionQuery: medicine.canonicalName,
      },
      // Refresh the copy only. Never resurrect a notification the patient has
      // already read, dismissed or archived.
      update: {
        title: `${displayName} is now available`,
        occurredAt: new Date(),
      },
    });
  }
}
