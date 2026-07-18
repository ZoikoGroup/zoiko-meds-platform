import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AggregateBucket } from '@prisma/client';
import { SignalAggregationService } from './signal-aggregation.service';

/**
 * Scheduled recompute for ZoikoSignal™. Periodically drains pending events into
 * DAY-bucketed aggregate cells so intelligence stays fresh without a per-event
 * write cost on the hot path.
 *
 * Implemented with a guarded interval (no external scheduler dependency).
 * Disabled by default; enable with `SIGNAL_AGGREGATION_ENABLED=true`. The run
 * lock prevents overlapping passes, which also keeps the NULL-scope cell
 * resolution in the aggregation job single-writer.
 */
@Injectable()
export class SignalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly aggregation: SignalAggregationService) {}

  onModuleInit(): void {
    if (process.env.SIGNAL_AGGREGATION_ENABLED !== 'true') {
      this.logger.log(
        'Scheduled aggregation disabled (set SIGNAL_AGGREGATION_ENABLED=true to enable)',
      );
      return;
    }
    const intervalMs = Math.max(
      Number(process.env.SIGNAL_AGGREGATION_INTERVAL_MS) || 300_000,
      30_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Don't hold the event loop open on this background timer.
    this.timer.unref?.();
    this.logger.log(`Scheduled aggregation every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.aggregation.runAggregation({
        bucket: AggregateBucket.DAY,
        prune: true,
      });
    } catch (err) {
      this.logger.error(
        `Scheduled aggregation failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
