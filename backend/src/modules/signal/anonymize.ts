import { SignalAggregate } from '@prisma/client';
import { MAX_TERM_LENGTH } from './signal.constants';

/**
 * Anonymization helpers enforcing ZoikoSignal™'s aggregate-only contract.
 *
 * Two guarantees live here:
 *  1. Inbound free text (zero-result search terms) is normalized and capped so
 *     nothing resembling a payload/identifier is retained.
 *  2. Outbound cells below the k-anonymity threshold are masked — their counts
 *     are stripped so a low-count cell can never be used to single anyone out.
 */

/** Normalize a search term for demand analysis. Returns null if it is empty. */
export function normalizeTerm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TERM_LENGTH);
  return t.length ? t : null;
}

/** Public-safe shape of an aggregate cell released to a contract consumer. */
export interface IntelligenceCell {
  medicineId: string | null;
  medicineName: string | null;
  jurisdictionId: string | null;
  bucket: SignalAggregate['bucket'];
  periodStart: Date;
  periodEnd: Date;
  suppressed: boolean;
  // Null on suppressed cells (below k-anonymity).
  searchCount: number | null;
  zeroResultCount: number | null;
  restockEvents: number | null;
  confirmationCount: number | null;
  // Derived shortage-pressure index in [0,1]: zero-results / searches. Null
  // when suppressed or when there were no searches to divide by.
  shortagePressure: number | null;
}

/**
 * Project a raw aggregate row into a public-safe cell. Suppressed cells keep
 * their period/scope metadata (so consumers know a bucket exists) but have all
 * counts masked to null. `medicineName` is resolved by the caller and is left
 * null for MediBase-suppressed identities.
 */
export function toIntelligenceCell(
  a: SignalAggregate,
  medicineName: string | null,
): IntelligenceCell {
  const base = {
    medicineId: a.medicineId,
    medicineName,
    jurisdictionId: a.jurisdictionId,
    bucket: a.bucket,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    suppressed: a.suppressed,
  };

  if (a.suppressed) {
    return {
      ...base,
      searchCount: null,
      zeroResultCount: null,
      restockEvents: null,
      confirmationCount: null,
      shortagePressure: null,
    };
  }

  return {
    ...base,
    searchCount: a.searchCount,
    zeroResultCount: a.zeroResultCount,
    restockEvents: a.restockEvents,
    confirmationCount: a.confirmationCount,
    shortagePressure:
      a.searchCount > 0
        ? Math.round((a.zeroResultCount / a.searchCount) * 100) / 100
        : null,
  };
}
