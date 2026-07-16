import { Injectable, Logger } from '@nestjs/common';
import { SignalEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeTerm } from './anonymize';

/**
 * ZoikoSignal™ event ingestion. Records the anonymized events that feed the
 * aggregation pipeline: medicine searches, zero-results, restocks and signal
 * confirmations.
 *
 * Ingestion is BEST-EFFORT with respect to the caller: it must never fail or
 * slow a user-facing request, so every method swallows its own errors and the
 * hot-path emitters (search/portal) call it fire-and-forget. It records NO
 * user, session, IP or patient data — only the governed scope of the event.
 */
@Injectable()
export class SignalIngestService {
  private readonly logger = new Logger(SignalIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A medicine search resolved to `medicineId` (or null when unresolved). */
  async recordSearch(medicineId?: string | null): Promise<void> {
    await this.emit(SignalEventType.SEARCH, { medicineId: medicineId ?? null });
  }

  /** A search that returned no governed identity. Retains the term (anonymized). */
  async recordZeroResult(term?: string | null): Promise<void> {
    await this.emit(SignalEventType.ZERO_RESULT, {
      searchTerm: normalizeTerm(term),
    });
  }

  /** A pharmacy reported a medicine back in stock. */
  async recordRestock(
    medicineId: string,
    pharmacyId?: string | null,
  ): Promise<void> {
    await this.emit(SignalEventType.RESTOCK, {
      medicineId,
      pharmacyId: pharmacyId ?? null,
    });
  }

  /** An availability signal was confirmed (freshness/accuracy check). */
  async recordConfirmation(
    medicineId: string,
    pharmacyId?: string | null,
  ): Promise<void> {
    await this.emit(SignalEventType.CONFIRMATION, {
      medicineId,
      pharmacyId: pharmacyId ?? null,
    });
  }

  /**
   * Low-level emit used by the admin/backfill surface. Resolves the medicine's
   * jurisdiction (for scoped rollups) and persists a single event.
   */
  async emit(
    type: SignalEventType,
    data: {
      medicineId?: string | null;
      jurisdictionId?: string | null;
      pharmacyId?: string | null;
      searchTerm?: string | null;
    },
  ): Promise<void> {
    try {
      const jurisdictionId =
        data.jurisdictionId ??
        (await this.resolveJurisdiction(data.medicineId ?? null));

      await this.prisma.signalEvent.create({
        data: {
          type,
          medicineId: data.medicineId ?? null,
          jurisdictionId,
          pharmacyId: data.pharmacyId ?? null,
          searchTerm: data.searchTerm ?? null,
        },
      });
    } catch (err) {
      // Never let intelligence ingestion break a user-facing flow.
      this.logger.warn(
        `Failed to record ${type} signal event: ${(err as Error).message}`,
      );
    }
  }

  private async resolveJurisdiction(
    medicineId: string | null,
  ): Promise<string | null> {
    if (!medicineId) return null;
    const medicine = await this.prisma.medicineEntity.findUnique({
      where: { id: medicineId },
      select: { jurisdictionId: true },
    });
    return medicine?.jurisdictionId ?? null;
  }
}
