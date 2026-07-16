import { Injectable, Logger } from '@nestjs/common';
import { AggregateBucket, SignalEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AGGREGATION_BATCH_SIZE,
  bucketPeriod,
  kAnonymityThreshold,
  rawEventRetentionDays,
} from './signal.constants';

export interface AggregationResult {
  bucket: AggregateBucket;
  processedEvents: number;
  cellsTouched: number;
  suppressedCells: number;
  prunedEvents: number;
}

interface CellDraft {
  medicineId: string | null;
  jurisdictionId: string | null;
  periodStart: Date;
  periodEnd: Date;
  search: number;
  zero: number;
  restock: number;
  confirm: number;
  total: number;
}

/**
 * ZoikoSignal™ aggregation job. Folds pending SignalEvents into time-bucketed,
 * jurisdiction-scoped SignalAggregate cells and re-applies the k-anonymity
 * suppression gate so low-count cells can never be released.
 *
 * The job is idempotent per event: each event is marked `aggregatedAt` once
 * folded, so re-running only picks up new events. Aggregation is additive —
 * counts accumulate into the matching cell across runs.
 */
@Injectable()
export class SignalAggregationService {
  private readonly logger = new Logger(SignalAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runAggregation(opts: {
    bucket?: AggregateBucket;
    batchSize?: number;
    prune?: boolean;
  }): Promise<AggregationResult> {
    const bucket = opts.bucket ?? AggregateBucket.DAY;
    const batchSize = Math.min(
      Math.max(opts.batchSize ?? AGGREGATION_BATCH_SIZE, 1),
      50_000,
    );
    const k = kAnonymityThreshold();

    const pending = await this.prisma.signalEvent.findMany({
      where: { aggregatedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: batchSize,
    });

    if (pending.length === 0) {
      const prunedEvents = opts.prune ? await this.pruneRawEvents() : 0;
      return {
        bucket,
        processedEvents: 0,
        cellsTouched: 0,
        suppressedCells: 0,
        prunedEvents,
      };
    }

    // Group events into cell drafts keyed by (medicine, jurisdiction, period).
    const drafts = new Map<string, CellDraft>();
    for (const e of pending) {
      const { periodStart, periodEnd } = bucketPeriod(bucket, e.occurredAt);
      const key = [
        e.medicineId ?? '∅',
        e.jurisdictionId ?? '∅',
        periodStart.toISOString(),
      ].join('|');

      let draft = drafts.get(key);
      if (!draft) {
        draft = {
          medicineId: e.medicineId,
          jurisdictionId: e.jurisdictionId,
          periodStart,
          periodEnd,
          search: 0,
          zero: 0,
          restock: 0,
          confirm: 0,
          total: 0,
        };
        drafts.set(key, draft);
      }

      switch (e.type) {
        case SignalEventType.SEARCH:
          draft.search++;
          break;
        case SignalEventType.ZERO_RESULT:
          draft.zero++;
          break;
        case SignalEventType.RESTOCK:
          draft.restock++;
          break;
        case SignalEventType.CONFIRMATION:
          draft.confirm++;
          break;
      }
      draft.total++;
    }

    let cellsTouched = 0;
    let suppressedCells = 0;

    for (const draft of drafts.values()) {
      // Nullable scope fields make the composite unique index NULL-distinct in
      // Postgres, so we resolve the existing cell explicitly rather than relying
      // on upsert. The aggregation job runs serially (scheduler guards overlap).
      const existing = await this.prisma.signalAggregate.findFirst({
        where: {
          medicineId: draft.medicineId,
          jurisdictionId: draft.jurisdictionId,
          bucket,
          periodStart: draft.periodStart,
        },
      });

      const sampleSize = (existing?.sampleSize ?? 0) + draft.total;
      const suppressed = sampleSize < k;
      if (suppressed) suppressedCells++;

      if (existing) {
        await this.prisma.signalAggregate.update({
          where: { id: existing.id },
          data: {
            searchCount: { increment: draft.search },
            zeroResultCount: { increment: draft.zero },
            restockEvents: { increment: draft.restock },
            confirmationCount: { increment: draft.confirm },
            sampleSize: { increment: draft.total },
            suppressed,
          },
        });
      } else {
        await this.prisma.signalAggregate.create({
          data: {
            medicineId: draft.medicineId,
            jurisdictionId: draft.jurisdictionId,
            bucket,
            periodStart: draft.periodStart,
            periodEnd: draft.periodEnd,
            searchCount: draft.search,
            zeroResultCount: draft.zero,
            restockEvents: draft.restock,
            confirmationCount: draft.confirm,
            sampleSize: draft.total,
            suppressed,
          },
        });
      }
      cellsTouched++;
    }

    await this.prisma.signalEvent.updateMany({
      where: { id: { in: pending.map((e) => e.id) } },
      data: { aggregatedAt: new Date() },
    });

    const prunedEvents = opts.prune ? await this.pruneRawEvents() : 0;

    this.logger.log(
      `Aggregated ${pending.length} events into ${cellsTouched} ${bucket} cells ` +
        `(${suppressedCells} below k=${k}${prunedEvents ? `, pruned ${prunedEvents}` : ''})`,
    );

    return {
      bucket,
      processedEvents: pending.length,
      cellsTouched,
      suppressedCells,
      prunedEvents,
    };
  }

  /** Delete already-aggregated raw events past the retention window. */
  async pruneRawEvents(): Promise<number> {
    const cutoff = new Date(
      Date.now() - rawEventRetentionDays() * 86_400_000,
    );
    const result = await this.prisma.signalEvent.deleteMany({
      where: { aggregatedAt: { lt: cutoff } },
    });
    return result.count;
  }

  /** Count of raw events still awaiting aggregation. */
  async pendingCount(): Promise<number> {
    return this.prisma.signalEvent.count({ where: { aggregatedAt: null } });
  }
}
