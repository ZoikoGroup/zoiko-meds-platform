import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';

const MS_PER_MINUTE = 60_000;
const DEFAULT_INTERVAL_MINUTES = 60;

/**
 * Advances commercial state on a timer.
 *
 * `expireEvaluations` and `advanceDelinquency` existed for months with zero
 * callers: no cron, no controller, no job runner, nothing. The effect was not a
 * crash but silence — a 30-day trial never ended, so every pharmacy that
 * started one kept Intelligence Pro free and indefinitely, and a card that
 * failed never progressed past day 0. Logic that is only correct when something
 * calls it is not correct; this is the something.
 *
 * Deliberately a plain interval rather than a new scheduling dependency. The
 * platform runs as a single API process on one VM (see backend/scripts/
 * deploy.sh, which restarts exactly one docker service, pm2 process or systemd
 * unit), so there is no second instance to coordinate with, and adding a
 * package to own one timer buys nothing. Both jobs are idempotent and
 * date-driven, so a duplicate run — from a restart, or from a second instance
 * if this ever scales out — re-reads the same rows and finds nothing left to
 * do. If it does scale out, this is the place that needs a lock.
 *
 * Nothing here decides visibility. Visibility is computed from subscription
 * dates on every query (see commerciallyEligibleWhere), so a pharmacy whose
 * trial lapses stops being searchable immediately, whether or not this has run.
 * What this does is make the stored classification agree with that, and move
 * delinquency along its timeline.
 */
@Injectable()
export class CommercialLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialLifecycleScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  /** Guards against a slow sweep overlapping the next tick. */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        'Commercial lifecycle scheduler is disabled. Trials will not expire and ' +
          'delinquency will not advance until it is enabled.',
      );
      return;
    }

    const minutes = this.intervalMinutes;
    this.timer = setInterval(() => {
      void this.tick();
    }, minutes * MS_PER_MINUTE);

    // Never hold the process open. A timer that keeps the event loop alive
    // turns a clean shutdown into a hang, and makes every test suite that
    // imports this module wait for it.
    this.timer.unref?.();

    this.logger.log(`Commercial lifecycle scheduler started; sweeping every ${minutes}m.`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One sweep. Public so an operator-triggered run or a test can drive exactly
   * what the timer drives, rather than a re-implementation of it.
   *
   * Never throws: a failed sweep must not take the process down, and the next
   * tick retries the same rows anyway because both jobs work from dates rather
   * than from a cursor.
   */
  async tick(
    now: Date = new Date(),
  ): Promise<{ expired: number; transitioned: number; restricted: number; failed: number }> {
    if (this.running) {
      this.logger.warn('Previous commercial sweep is still running; skipping this tick.');
      return { expired: 0, transitioned: 0, restricted: 0, failed: 0 };
    }
    this.running = true;
    try {
      // Order matters only for reporting: the three are independent. An
      // evaluation has no payment to be delinquent on, and the eligibility
      // sweep asks about verification rather than about payment.
      const { expired } = await this.subscriptions.expireEvaluations(now);
      const { transitioned } = await this.subscriptions.advanceDelinquency(now);
      // S-B4: stop charging pharmacies the platform has deliberately switched
      // off. Reports its own failures rather than throwing, so one unreachable
      // provider call does not cost the whole tick.
      const { restricted, failed } = await this.subscriptions.restrictIneligibleSubscriptions();

      if (expired > 0 || transitioned > 0 || restricted > 0 || failed > 0) {
        this.logger.log(
          `Commercial sweep: ${expired} evaluation(s) expired, ` +
            `${transitioned} delinquent subscription(s) advanced, ` +
            `${restricted} ineligible subscription(s) stopped from renewing` +
            (failed > 0 ? `, ${failed} provider call(s) failed and will be retried.` : '.'),
        );
      }
      return { expired, transitioned, restricted, failed };
    } catch (err) {
      // The message only: a provider or database error can carry row contents,
      // and this log is not a place for them.
      this.logger.error(
        `Commercial sweep failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return { expired: 0, transitioned: 0, restricted: 0, failed: 0 };
    } finally {
      this.running = false;
    }
  }

  /**
   * On unless switched off, and off by default under test.
   *
   * Opt-out rather than opt-in on purpose: the failure this exists to fix was
   * a job nobody had turned on, and a flag that must be remembered in every
   * environment would reproduce it exactly.
   */
  private get enabled(): boolean {
    const raw = this.config.get<string>('COMMERCIAL_LIFECYCLE_ENABLED', '');
    if (raw.trim()) return raw.trim().toLowerCase() === 'true';
    return this.config.get<string>('NODE_ENV', 'development') !== 'test';
  }

  private get intervalMinutes(): number {
    const raw = Number(this.config.get<string>('COMMERCIAL_LIFECYCLE_INTERVAL_MINUTES', ''));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MINUTES;
    // A sweep more often than once a minute is a mistake, not a configuration.
    return Math.max(1, Math.floor(raw));
  }
}
