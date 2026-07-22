import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AvailabilityConfidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriter,
  ) {}

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
   * Resolve the pharmacyId for the current user. The caller MUST be linked to a
   * pharmacy — there is no fallback. Returning some other pharmacy's id when the
   * user has none would let any authenticated account read and mutate a
   * pharmacy's inventory, so a missing link is a hard authorization failure.
   */
  async resolvePharmacyId(userPharmacyId: string | null): Promise<string> {
    if (userPharmacyId) return userPharmacyId;
    throw new ForbiddenException(
      'Your account is not linked to a pharmacy. Ask a platform administrator to associate your account with a pharmacy.',
    );
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

  private async getPharmacyName(pharmacyId: string): Promise<string> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { name: true },
    });
    return pharmacy?.name || 'Pharmacy';
  }

  /**
   * Add a medicine to the pharmacy's inventory.
   * 1. Find or create the MedicineEntity.
   * 2. Create an InventorySignal (raw intake).
   * 3. Upsert an AvailabilitySignal (public-safe derived signal).
   * 4. Audit-log the operation.
   */
  async addInventoryItem(
    pharmacyId: string,
    dto: AddInventoryDto,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
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

    // 4. Audit log entry
    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.create',
      'Medicine Inventory',
      avail.id,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Create',
        entityType: 'Medicine Inventory',
        entityId: avail.id,
        medicineId: medicine.id,
        medicineName: medicine.canonicalName,
        genericName: medicine.genericName || '',
        strength: medicine.strength || '',
        dosageForm: medicine.dosageForm || 'Tablet',
        newValues: { status, confidence: confidence.toLowerCase() },
        status: 'Success',
      },
      ipAddress,
    );

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
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    const oldStatus = CONFIDENCE_TO_STATUS[signal.confidence] || 'out-of-stock';
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

    // Audit log entry
    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.update',
      'Medicine Inventory',
      signalId,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Update',
        entityType: 'Medicine Inventory',
        entityId: signalId,
        medicineId: updated.medicineId,
        medicineName: updated.medicine.canonicalName,
        genericName: updated.medicine.genericName || '',
        strength: updated.medicine.strength || '',
        dosageForm: updated.medicine.dosageForm || 'Tablet',
        previousValues: { status: oldStatus, confidence: signal.confidence.toLowerCase() },
        newValues: { status, confidence: confidence.toLowerCase() },
        status: 'Success',
      },
      ipAddress,
    );

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
  async importCsv(
    pharmacyId: string,
    input: string | any[],
    mode: 'merge' | 'replace' = 'merge',
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
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
        const parts = lines[i].split(',').map((p) => p.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] || '';
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

    for (const row of rawRows) {
      totalProcessed++;
      const name = row.name || row.canonicalName || row.medicineName;
      if (!name) {
        skipped++;
        continue;
      }
      const generic = row.generic || row.genericName || '';
      const strength = row.strength || '';
      const dosageForm = row.dosageForm || row.form || 'Tablet';
      const statusRaw = (row.status || row.availability || 'available').toLowerCase();
      const confidence = STATUS_TO_CONFIDENCE[statusRaw] || AvailabilityConfidence.HIGH;
      const reportedInStock = statusRaw !== 'out-of-stock';

      try {
        let medicine = await this.prisma.medicineEntity.findFirst({
          where: {
            canonicalName: { equals: name, mode: 'insensitive' },
            strength: strength || undefined,
          },
        });

        if (!medicine) {
          medicine = await this.prisma.medicineEntity.create({
            data: {
              canonicalName: name,
              genericName: generic || null,
              strength: strength || null,
              dosageForm,
            },
          });
        }

        await this.prisma.inventorySignal.create({
          data: {
            pharmacyId,
            medicineId: medicine.id,
            uploadMethod: 'CSV',
            reportedInStock,
          },
        });

        const existingSignal = await this.prisma.availabilitySignal.findUnique({
          where: {
            medicineId_pharmacyId: {
              medicineId: medicine.id,
              pharmacyId,
            },
          },
        });

        if (existingSignal) {
          const updatedSignal = await this.prisma.availabilitySignal.update({
            where: { id: existingSignal.id },
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
      }
    }

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
      }
    }

    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.import',
      'Medicine Inventory',
      null,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Import',
        entityType: 'Medicine Inventory',
        imported,
        updated,
        skipped,
        totalProcessed,
        mode,
        status: 'Success',
      },
      ipAddress,
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
  async deleteInventoryItem(
    pharmacyId: string,
    signalId: string,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
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
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    await this.prisma.availabilitySignal.delete({ where: { id: signalId } });

    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.delete',
      'Medicine Inventory',
      signalId,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Delete',
        entityType: 'Medicine Inventory',
        entityId: signalId,
        medicineId: signal.medicineId,
        medicineName: signal.medicine?.canonicalName || 'Unknown',
        genericName: signal.medicine?.genericName || '',
        strength: signal.medicine?.strength || '',
        dosageForm: signal.medicine?.dosageForm || 'Tablet',
        status: 'Success',
      },
      ipAddress,
    );

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
