import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PharmacyIntegrationService } from './pharmacy-integration.service';

/**
 * Ticks the pull feeds.
 *
 * A timer rather than @nestjs/schedule: this is the only recurring job in the
 * API, and one interval does not justify a dependency, a decorator scanner and
 * a second scheduling model for everyone reading the code afterwards. The
 * behaviour that actually matters — that two API instances never sync the same
 * pharmacy twice — comes from the database lock in PharmacyIntegrationService,
 * not from the scheduler, so it holds however this method is called.
 *
 * Off under NODE_ENV=test: a suite must not start a timer that outlives it and
 * dials the network.
 */

/** How often to look for due feeds. Not the sync interval — that is per feed. */
export const TICK_MS = 60_000;

@Injectable()
export class PharmacyIntegrationScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PharmacyIntegrationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly integrations: PharmacyIntegrationService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.PHARMACY_SYNC_SCHEDULER === 'off') {
      this.logger.log('Pharmacy feed scheduler disabled by PHARMACY_SYNC_SCHEDULER=off');
      return;
    }

    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Without this the interval keeps the process alive through a shutdown.
    this.timer.unref?.();
    this.logger.log(`Pharmacy feed scheduler started (every ${TICK_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass. Guarded against overlap in-process as well as in the database:
   * a tick that takes longer than TICK_MS should not start a second pass
   * competing with itself for the same locks.
   */
  async tick() {
    if (this.running) return 0;
    this.running = true;
    try {
      const ran = await this.integrations.runDueSyncs();
      if (ran > 0) this.logger.log(`Ran ${ran} scheduled pharmacy sync(s)`);
      return ran;
    } catch (err) {
      // A tick that throws must not stop the interval — the next one may work.
      this.logger.error(
        `Scheduled pharmacy sync pass failed: ${(err as Error)?.message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
