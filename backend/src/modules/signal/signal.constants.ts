import { AggregateBucket } from '@prisma/client';

/**
 * ZoikoSignal™ governance & aggregation constants.
 *
 * These encode the aggregate-only posture of the module: the k-anonymity
 * threshold below which a cell is suppressed, how long raw events are retained
 * before pruning, and how event timestamps are floored into bucket periods.
 */

/**
 * k-anonymity threshold. A SignalAggregate cell backed by fewer than this many
 * events is masked (its counts are never released). Overridable via
 * `SIGNAL_K_ANONYMITY`; never allowed below 2, which would defeat the purpose.
 */
export function kAnonymityThreshold(): number {
  const raw = Number(process.env.SIGNAL_K_ANONYMITY);
  if (!Number.isFinite(raw) || raw < 2) return 5;
  return Math.floor(raw);
}

/** How long raw, already-aggregated SignalEvents are kept before pruning (days). */
export function rawEventRetentionDays(): number {
  const raw = Number(process.env.SIGNAL_EVENT_RETENTION_DAYS);
  if (!Number.isFinite(raw) || raw < 1) return 90;
  return Math.floor(raw);
}

/** Max normalized length retained for a zero-result search term. */
export const MAX_TERM_LENGTH = 120;

/** Default number of aggregate cells returned by an intelligence query. */
export const DEFAULT_INTELLIGENCE_LIMIT = 100;
export const MAX_INTELLIGENCE_LIMIT = 1000;

/** Largest batch of pending events processed in a single aggregation pass. */
export const AGGREGATION_BATCH_SIZE = 10_000;

/**
 * Floor a timestamp to the start of its bucket period (UTC), and return the
 * matching period end. Weeks are ISO weeks starting Monday.
 */
export function bucketPeriod(bucket: AggregateBucket, at: Date): {
  periodStart: Date;
  periodEnd: Date;
} {
  const d = new Date(at.getTime());
  switch (bucket) {
    case 'HOUR': {
      const start = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          d.getUTCHours(),
        ),
      );
      return { periodStart: start, periodEnd: addHours(start, 1) };
    }
    case 'WEEK': {
      const day = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      // getUTCDay(): 0=Sun..6=Sat. Shift so Monday is the first day.
      const offset = (day.getUTCDay() + 6) % 7;
      const start = addDays(day, -offset);
      return { periodStart: start, periodEnd: addDays(start, 7) };
    }
    case 'DAY':
    default: {
      const start = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      return { periodStart: start, periodEnd: addDays(start, 1) };
    }
  }
}

function addHours(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 3_600_000);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
