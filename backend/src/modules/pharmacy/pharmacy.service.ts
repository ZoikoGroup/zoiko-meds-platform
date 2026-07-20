import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AvailabilityConfidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

/**
 * Maps the pharmacy-facing status string to the AvailabilityConfidence enum
 * used by the AvailabilitySignal model.
 */
const STATUS_TO_CONFIDENCE: Record<string, AvailabilityConfidence> = {
  available: AvailabilityConfidence.HIGH,
  limited: AvailabilityConfidence.MODERATE,
  'out-of-stock': AvailabilityConfidence.LOW,
};

/** Maps AvailabilityConfidence back to the pharmacy-facing status string. */
const CONFIDENCE_TO_STATUS: Record<string, string> = {
  HIGH: 'available',
  MODERATE: 'limited',
  LOW: 'out-of-stock',
  UNKNOWN: 'out-of-stock',
  SUPPRESSED: 'out-of-stock',
};

/**
 * Pharmacy verification, participation & inventory management.
 *
 * Handles the pharmacy portal domain: registration, verification workflow,
 * participation status, and inventory-signal intake. Confidential inventory
 * (exact quantities) is stored but never exposed on public surfaces.
 */
@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Public pharmacy queries (existing)
  // ---------------------------------------------------------------------------

  async listVerified() {
    return this.prisma.pharmacy.findMany({
      where: { verificationStatus: 'VERIFIED', isParticipating: true },
      select: {
        id: true,
        name: true,
        city: true,
        region: true,
        reliabilityScore: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.pharmacy.findUnique({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Pharmacy-scoped inventory management
  // ---------------------------------------------------------------------------

  /**
   * Resolve the pharmacyId for the current user. If the user doesn't have one,
   * fall back to the first pharmacy in the database (development convenience).
   */
  async resolvePharmacyId(userPharmacyId: string | null): Promise<string> {
    if (userPharmacyId) return userPharmacyId;

    // Fallback: grab the first pharmacy (useful during dev / super-admin testing)
    const first = await this.prisma.pharmacy.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) {
      throw new BadRequestException(
        'No pharmacy is linked to your account and no pharmacies exist in the system.',
      );
    }
    return first.id;
  }

  /**
   * List all inventory items for a pharmacy. Each row joins MedicineEntity +
   * AvailabilitySignal to produce the shape the frontend DataTable expects.
   */
  async getInventory(pharmacyId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: { pharmacyId },
      include: {
        medicine: {
          select: {
            id: true,
            canonicalName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
      orderBy: { computedAt: 'desc' },
    });

    return signals.map((s) => ({
      id: s.id,
      medicineId: s.medicineId,
      name: s.medicine.canonicalName,
      generic: s.medicine.genericName || '',
      strength: s.medicine.strength || '',
      dosageForm: s.medicine.dosageForm || 'Tablet',
      status: CONFIDENCE_TO_STATUS[s.confidence] || 'out-of-stock',
      confidence: s.confidence.toLowerCase(),
      updated: this.timeAgo(s.computedAt),
    }));
  }

  /**
   * Get dynamic dashboard summary and statistics computed directly from PostgreSQL
   * for the given pharmacy.
   */
  async getDashboard(pharmacyId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: { pharmacyId },
      include: {
        medicine: {
          select: {
            canonicalName: true,
            genericName: true,
          },
        },
      },
      orderBy: { computedAt: 'desc' },
    });

    let available = 0;
    let limited = 0;
    let outOfStock = 0;
    let pending = 0;

    const recentUpdates: Array<{
      id: string;
      name: string;
      status: string;
      when: string;
      by: string;
    }> = [];

    const pendingUpdates: Array<{
      id: string;
      name: string;
      reason: string;
    }> = [];

    const now = Date.now();
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

    for (const s of signals) {
      const status = CONFIDENCE_TO_STATUS[s.confidence] || 'out-of-stock';
      if (status === 'available') available++;
      else if (status === 'limited') limited++;
      else outOfStock++;

      const isOld = now - new Date(s.computedAt).getTime() > TWENTY_FOUR_HOURS_MS;
      if (isOld || s.requiresConfirmation || status === 'out-of-stock' || status === 'limited') {
        pending++;
        if (pendingUpdates.length < 5) {
          let reason = 'Signal reconfirmation recommended';
          if (isOld) reason = 'Signal older than 24h — reconfirm availability';
          else if (status === 'out-of-stock') reason = 'Marked out of stock — update if restocked';
          else if (status === 'limited') reason = 'Limited stock — confirm quantity band';

          pendingUpdates.push({
            id: s.id,
            name: s.medicine.canonicalName,
            reason,
          });
        }
      }

      if (recentUpdates.length < 5) {
        recentUpdates.push({
          id: s.id,
          name: s.medicine.canonicalName,
          status,
          when: this.timeAgo(s.computedAt),
          by: 'Staff update',
        });
      }
    }

    const total = signals.length;

    return {
      stats: {
        total,
        available,
        limited,
        outOfStock,
        pending,
      },
      recentUpdates,
      pendingUpdates,
      notifications: [
        {
          id: 'n1',
          type: 'inventory',
          title: 'Inventory signals active',
          message: `${total} medicines currently tracked in PostgreSQL database.`,
          when: 'Just now',
          unread: false,
        },
        {
          id: 'n2',
          type: 'system',
          title: 'Real-time database sync',
          message: 'Dashboard cards are dynamically synchronized with live inventory records.',
          when: 'Just now',
          unread: false,
        },
      ],
    };
  }

  /**
   * Add a medicine to the pharmacy's inventory.
   * 1. Find or create the MedicineEntity.
   * 2. Create an InventorySignal (raw intake).
   * 3. Upsert an AvailabilitySignal (public-safe derived signal).
   */
  async addInventoryItem(pharmacyId: string, dto: AddInventoryDto) {
    // 1. Find or create the medicine entity
    let medicine = await this.prisma.medicineEntity.findFirst({
      where: {
        canonicalName: { equals: dto.name, mode: 'insensitive' },
        strength: dto.strength || undefined,
      },
    });

    if (!medicine) {
      medicine = await this.prisma.medicineEntity.create({
        data: {
          canonicalName: dto.name,
          genericName: dto.generic || null,
          strength: dto.strength || null,
          dosageForm: dto.dosageForm || 'Tablet',
        },
      });
    }

    const status = dto.status || 'available';
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;
    const reportedInStock = status !== 'out-of-stock';

    // 2. Create the raw inventory signal
    await this.prisma.inventorySignal.create({
      data: {
        pharmacyId,
        medicineId: medicine.id,
        uploadMethod: 'MANUAL',
        reportedInStock,
        quantityOnHand: null,
      },
    });

    // 3. Upsert the public availability signal
    const avail = await this.prisma.availabilitySignal.upsert({
      where: {
        medicineId_pharmacyId: {
          medicineId: medicine.id,
          pharmacyId,
        },
      },
      update: {
        confidence,
        computedAt: new Date(),
      },
      create: {
        medicineId: medicine.id,
        pharmacyId,
        confidence,
      },
    });

    return {
      id: avail.id,
      medicineId: medicine.id,
      name: medicine.canonicalName,
      generic: medicine.genericName || '',
      strength: medicine.strength || '',
      dosageForm: medicine.dosageForm || 'Tablet',
      status,
      confidence: confidence.toLowerCase(),
      updated: 'just now',
    };
  }

  /**
   * Update the availability status of an existing inventory item.
   */
  async updateInventoryItem(
    pharmacyId: string,
    signalId: string,
    dto: UpdateInventoryDto,
  ) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    const status = dto.status || 'available';
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;

    const updated = await this.prisma.availabilitySignal.update({
      where: { id: signalId },
      data: { confidence, computedAt: new Date() },
      include: {
        medicine: {
          select: {
            canonicalName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      medicineId: updated.medicineId,
      name: updated.medicine.canonicalName,
      generic: updated.medicine.genericName || '',
      strength: updated.medicine.strength || '',
      dosageForm: updated.medicine.dosageForm || 'Tablet',
      status,
      confidence: confidence.toLowerCase(),
      updated: 'just now',
    };
  }

  /**
   * Bulk import medicines from CSV content or parsed row objects into PostgreSQL.
   * Mode: 'merge' (default — keeps existing inventory, updates matching, adds new)
   * Mode: 'replace' (updates/adds, and prunes unlisted inventory for the pharmacy)
   */
  async importCsv(pharmacyId: string, input: string | any[], mode: 'merge' | 'replace' = 'merge') {
    let rawRows: any[] = [];

    if (typeof input === 'string') {
      const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new BadRequestException('The CSV file is empty.');
      }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      if (!headers.includes('name')) {
        throw new BadRequestException('CSV file missing required "name" header column.');
      }

      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',');
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = (cells[idx] || '').trim();
        });
        rawRows.push(row);
      }
    } else if (Array.isArray(input)) {
      rawRows = input;
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let totalProcessed = 0;
    const processedSignalIds = new Set<string>();

    console.log(`[CSV Import] Pharmacy ${pharmacyId} [Mode: ${mode}]: Received CSV containing ${rawRows.length} rows.`);

    for (const rawRow of rawRows) {
      totalProcessed++;
      const name = (rawRow.name || rawRow.Name || '').trim();
      if (!name) {
        skipped++;
        console.log(`[CSV Import] Row ${totalProcessed}: Skipped (missing name).`);
        continue;
      }

      const generic = (rawRow.generic || rawRow.Generic || '').trim();
      const strength = (rawRow.strength || rawRow.Strength || '').trim();
      const dosageForm = (rawRow.dosageform || rawRow.dosageForm || rawRow.DosageForm || 'Tablet').trim();
      let rawStatus = (rawRow.status || rawRow.Status || 'available').trim().toLowerCase();

      if (rawStatus === 'in-stock' || rawStatus === 'in stock') rawStatus = 'available';
      if (rawStatus === 'out of stock' || rawStatus === 'unavailable') rawStatus = 'out-of-stock';
      if (rawStatus === 'limited stock') rawStatus = 'limited';

      const validStatuses = ['available', 'limited', 'out-of-stock'];
      const status = validStatuses.includes(rawStatus) ? rawStatus : 'available';
      const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;
      const reportedInStock = status !== 'out-of-stock';

      try {
        // 1. Find or create MedicineEntity (unique by canonicalName, strength, dosageForm)
        let medicine = await this.prisma.medicineEntity.findFirst({
          where: {
            canonicalName: { equals: name, mode: 'insensitive' },
            strength: strength ? { equals: strength, mode: 'insensitive' } : null,
            dosageForm: dosageForm ? { equals: dosageForm, mode: 'insensitive' } : null,
          },
        });

        if (medicine) {
          if (generic && medicine.genericName !== generic) {
            await this.prisma.medicineEntity.update({
              where: { id: medicine.id },
              data: { genericName: generic },
            });
          }
        } else {
          medicine = await this.prisma.medicineEntity.create({
            data: {
              canonicalName: name,
              genericName: generic || null,
              strength: strength || null,
              dosageForm: dosageForm || 'Tablet',
            },
          });
        }

        // 2. Create raw InventorySignal intake
        await this.prisma.inventorySignal.create({
          data: {
            pharmacyId,
            medicineId: medicine.id,
            uploadMethod: 'CSV',
            reportedInStock,
            quantityOnHand: null,
          },
        });

        // 3. Check if AvailabilitySignal exists for (medicineId, pharmacyId)
        const existing = await this.prisma.availabilitySignal.findUnique({
          where: {
            medicineId_pharmacyId: {
              medicineId: medicine.id,
              pharmacyId,
            },
          },
        });

        if (existing) {
          const updatedSignal = await this.prisma.availabilitySignal.update({
            where: { id: existing.id },
            data: {
              confidence,
              computedAt: new Date(),
            },
          });
          processedSignalIds.add(updatedSignal.id);
          updated++;
        } else {
          const createdSignal = await this.prisma.availabilitySignal.create({
            data: {
              medicineId: medicine.id,
              pharmacyId,
              confidence,
            },
          });
          processedSignalIds.add(createdSignal.id);
          imported++;
        }
      } catch (err: any) {
        skipped++;
        console.error(`[CSV Import Error] Row ${totalProcessed} (${name}):`, err?.message || err);
      }
    }

    // 4. If mode is 'replace', prune unlisted availability signals for this pharmacy
    if (mode === 'replace') {
      const allPharmacySignals = await this.prisma.availabilitySignal.findMany({
        where: { pharmacyId },
        select: { id: true },
      });

      const idsToDelete = allPharmacySignals
        .map((s) => s.id)
        .filter((id) => !processedSignalIds.has(id));

      if (idsToDelete.length > 0) {
        await this.prisma.availabilitySignal.deleteMany({
          where: { id: { in: idsToDelete } },
        });
        console.log(`[CSV Import Prune] Mode 'replace' pruned ${idsToDelete.length} unlisted signals for pharmacy ${pharmacyId}.`);
      }
    }

    console.log(
      `[CSV Import Summary] Pharmacy ${pharmacyId} [${mode}]: Total: ${totalProcessed}, Imported: ${imported}, Updated: ${updated}, Skipped: ${skipped}`,
    );

    return {
      imported,
      updated,
      skipped,
      totalProcessed,
      mode,
    };
  }

  /**
   * Remove an inventory item (AvailabilitySignal) from the pharmacy.
   */
  async deleteInventoryItem(pharmacyId: string, signalId: string) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    await this.prisma.availabilitySignal.delete({ where: { id: signalId } });
    return { id: signalId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
}
