import { Injectable, Logger } from '@nestjs/common';
import { MedibaseService } from '../medibase/medibase.service';
import { parseStrength } from '../medibase/normalize';
import type { ExtractedMedicine } from './gemini-prescription.service';

/**
 * Decides what each thing read off a prescription actually is.
 *
 * The reader (gemini-prescription.service.ts) is allowed to transcribe and
 * nothing else. This is where a transcription becomes an identity, and the only
 * source of an identity is MediBase. A medicine the catalog cannot verify is
 * returned as NOT_FOUND with the raw text intact, never as a best guess: the
 * patient can search by hand from there, which is a worse experience and a far
 * better outcome than a confident wrong name.
 *
 * Three outcomes, and the distinction between the last two is the point:
 *
 *   MATCHED     one catalog entry is clearly strongest and nothing contradicts it
 *   AMBIGUOUS   several entries are plausible, or the strength disagrees — the
 *               patient chooses, this service does not
 *   NOT_FOUND   the catalog has nothing; the reading is returned for manual search
 */

export type VerificationStatus =
  | 'MATCHED'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  /**
   * The reading itself is in doubt, so no catalog answer can be trusted yet.
   *
   * Distinct from AMBIGUOUS on purpose. AMBIGUOUS means we read the line and
   * the catalog offers several answers; this means we could not read the line,
   * so even a single confident-looking catalog hit would be confirming a guess
   * about what the page says. The patient is asked what the medicine is, not
   * merely which of several it is.
   */
  | 'USER_CONFIRMATION_REQUIRED';

/** The catalog's answer, reduced to what a patient-facing client needs. */
export interface CanonicalMedicine {
  id: string;
  brandName: string;
  genericName: string | null;
  strength: string | null;
  manufacturer: string | null;
  dosageForm: string | null;
}

export interface VerifiedMedicine {
  extracted: ExtractedMedicine;
  verification: {
    status: VerificationStatus;
    medicine: CanonicalMedicine | null;
    candidates: CanonicalMedicine[];
    /** Why this landed where it did. Shown to the patient when it is not MATCHED. */
    reason: string | null;
  };
}

/** Below this a catalog hit is not a plausible reading of the line at all. */
const PLAUSIBLE_FLOOR = 0.45;

/** A single candidate must reach this to be accepted without the patient choosing. */
const CONFIDENT_SCORE = 0.8;

/** ...and must beat the runner-up by this much, or the two are a choice, not an answer. */
const LEAD_MARGIN = 0.12;

/** Catalog rows fetched per extracted line. */
const CANDIDATES_PER_QUERY = 5;

/** Concurrent catalog lookups. Enough to keep a long prescription quick, bounded so a
 *  twenty-line page cannot open twenty database queries at once. */
const MATCH_CONCURRENCY = 4;

/** Mass and volume units reduced to a common base, so 0.65 g and 650 mg compare equal. */
const BASE_UNITS: Record<string, { base: string; factor: number }> = {
  mcg: { base: 'mg', factor: 0.001 },
  mg: { base: 'mg', factor: 1 },
  g: { base: 'mg', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
};

/** Floating-point slack for a strength comparison (0.65 g -> 650.00000000000006 mg). */
const STRENGTH_EPSILON = 1e-6;

type Scored = { score: number; medicine: CanonicalMedicine; strength: 'match' | 'mismatch' | 'unknown' };

/**
 * Compare two strengths after reducing both to a base unit.
 *
 * Returns 'unknown' when either side has no parseable strength — absence is not
 * disagreement, and a catalog entry with no recorded strength should not be
 * rejected because the page had one.
 */
export function compareStrength(
  extracted: string | null,
  catalog: string | null,
): 'match' | 'mismatch' | 'unknown' {
  const a = reduce(extracted);
  const b = reduce(catalog);
  if (!a.length || !b.length) return 'unknown';
  // A prescription line can carry more than one number ("250mg/5ml"); the
  // strengths agree if any reduced pair agrees.
  for (const left of a) {
    for (const right of b) {
      if (left.unit === right.unit && Math.abs(left.value - right.value) < STRENGTH_EPSILON) {
        return 'match';
      }
    }
  }
  return 'mismatch';
}

function reduce(value: string | null): Array<{ value: number; unit: string }> {
  if (!value) return [];
  return parseStrength(value).map((parsed) => {
    const conversion = BASE_UNITS[parsed.unit];
    return conversion
      ? { value: parsed.value * conversion.factor, unit: conversion.base }
      : { value: parsed.value, unit: parsed.unit };
  });
}

/**
 * Drop the marks a reader uses for glyphs it could not make out.
 *
 * "Amo... 500" searched literally matches nothing; "Amo 500" at least lets the
 * catalog offer the patient something to choose between. The placeholders are
 * removed, never filled in — this widens the search, it does not complete the
 * word.
 */
function stripPlaceholders(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[?]{1,}/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/[_~*]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

/**
 * One candidate per distinct strength, strongest first.
 *
 * When the dose is what could not be read, the patient is choosing between
 * doses — showing three entries that are all 650 mg asks them a question they
 * cannot answer.
 */
function distinctStrengths(candidates: Scored[]): CanonicalMedicine[] {
  const seen = new Set<string>();
  const out: CanonicalMedicine[] = [];
  for (const candidate of candidates) {
    const key = (candidate.medicine.strength ?? '').toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate.medicine);
  }
  return out;
}

/** Safe formatting only — never a spelling change. */
function normalizeQueryText(value: string): string {
  return value
    .replace(/[‐-―]/g, '-') // typographic dashes
    .replace(/[^\p{L}\p{N}%./+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class PrescriptionMatcherService {
  private readonly logger = new Logger(PrescriptionMatcherService.name);

  constructor(private readonly medibase: MedibaseService) {}

  /**
   * Verify every reading against the catalog.
   *
   * The catalog is called in-process rather than over HTTP: it is the same
   * application, and a loopback request would add a hop, a second auth path and
   * a timeout for nothing.
   */
  async verifyAll(extracted: ExtractedMedicine[]): Promise<VerifiedMedicine[]> {
    const unique = dedupe(extracted);
    const out: VerifiedMedicine[] = new Array(unique.length);

    let next = 0;
    const workers = Array.from({ length: Math.min(MATCH_CONCURRENCY, unique.length) }, async () => {
      for (let i = next++; i < unique.length; i = next++) {
        out[i] = await this.verifyOne(unique[i]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  private async verifyOne(extracted: ExtractedMedicine): Promise<VerifiedMedicine> {
    const candidates = await this.lookup(extracted);
    const nameUnreadable = extracted.name === null || extracted.uncertainFields.includes('name');
    const strengthUnreadable = extracted.uncertainFields.includes('strength');

    // The identity itself could not be read. Whatever the catalog returns is a
    // suggestion about what the page *might* say, so it is offered as a choice
    // and never settled automatically — "Amo... 500" must not become
    // Amoxicillin 500 mg because that is the nearest thing in the catalog.
    if (nameUnreadable) {
      return {
        extracted,
        verification: {
          status: 'USER_CONFIRMATION_REQUIRED',
          medicine: null,
          candidates: candidates.map((c) => c.medicine),
          reason: candidates.length
            ? "We couldn't confidently read this medicine. Confirm which one it is, or search for it."
            : "We couldn't confidently read this medicine. Search for it to add it.",
        },
      };
    }

    if (!candidates.length) {
      return {
        extracted,
        verification: {
          status: 'NOT_FOUND',
          medicine: null,
          candidates: [],
          reason: 'This medicine is not in the ZoikoMeds catalog. Search by name to check.',
        },
      };
    }

    // The name reads clearly but the dose does not. "Dolo ?50" is Dolo — the
    // catalog can say which Dolo exists, but only the patient can say which was
    // prescribed, and 500 against 650 is a different dose to take.
    if (strengthUnreadable) {
      const byStrength = distinctStrengths(candidates);
      return {
        extracted,
        verification: {
          status: 'USER_CONFIRMATION_REQUIRED',
          medicine: null,
          candidates: byStrength,
          reason:
            byStrength.length > 1
              ? "We couldn't confidently read the strength. Confirm which one was prescribed."
              : "We couldn't confidently read the strength. Confirm this is the right one.",
        },
      };
    }

    const hasStrength = Boolean(extracted.strength);
    const agreeing = candidates.filter((c) => c.strength === 'match');
    const conflicting = candidates.filter((c) => c.strength === 'mismatch');

    // A strength that disagrees is never quietly accepted. "Amoxicillin 500 mg"
    // against a 250 mg catalog entry is a different medicine to dispense, so the
    // patient is asked rather than told.
    if (hasStrength && !agreeing.length && conflicting.length) {
      return {
        extracted,
        verification: {
          status: 'AMBIGUOUS',
          medicine: null,
          candidates: conflicting.map((c) => c.medicine),
          reason: `The prescription says ${extracted.strength}, which does not match the strengths on record. Choose the right one.`,
        },
      };
    }

    const pool = hasStrength && agreeing.length ? agreeing : candidates;
    const [best, runnerUp] = pool;

    const clearlyStrongest =
      best.score >= CONFIDENT_SCORE && (!runnerUp || best.score - runnerUp.score >= LEAD_MARGIN);

    if (clearlyStrongest) {
      return {
        extracted,
        verification: { status: 'MATCHED', medicine: best.medicine, candidates: [], reason: null },
      };
    }

    return {
      extracted,
      verification: {
        status: 'AMBIGUOUS',
        medicine: null,
        candidates: pool.map((c) => c.medicine),
        reason: 'More than one medicine in the catalog could be this. Choose the right one.',
      },
    };
  }

  /**
   * Ask the catalog, best query first.
   *
   * Name plus strength is the most specific thing the page gave us; the raw line
   * is the most faithful; the bare name is the broadest. The first query that
   * returns anything plausible wins, so a precise reading is not diluted by a
   * vaguer one.
   */
  private async lookup(extracted: ExtractedMedicine): Promise<Scored[]> {
    // With a readable name, the name is the query. Without one, the best we
    // have is the line itself and whatever glyphs were legible — searched so
    // the patient can be offered something to choose from, never so a match can
    // be made on their behalf.
    const queries = (
      extracted.name
        ? [
            extracted.strength ? `${extracted.name} ${extracted.strength}` : null,
            extracted.rawText,
            extracted.name,
          ]
        : [stripPlaceholders(extracted.uncertainText), stripPlaceholders(extracted.rawText)]
    )
      .filter((q): q is string => Boolean(q))
      .map(normalizeQueryText)
      .filter(Boolean);

    const seen = new Set<string>();
    for (const query of [...new Set(queries)]) {
      let rows: unknown[];
      try {
        rows = (await this.medibase.matchMedicines(query, {
          limit: CANDIDATES_PER_QUERY,
        })) as unknown[];
      } catch (err) {
        // The catalog being down is not the patient's problem to debug, and it
        // must not fail the whole scan: the reading is still worth returning.
        this.logger.error(
          `Catalog lookup failed: ${err instanceof Error ? err.name : typeof err}`,
        );
        return [];
      }

      const scored = rows
        .map((row) => toScored(row, extracted))
        .filter((row): row is Scored => row !== null && row.score >= PLAUSIBLE_FLOOR)
        .filter((row) => !seen.has(row.medicine.id) && seen.add(row.medicine.id) !== undefined)
        .sort((a, b) => b.score - a.score);

      if (scored.length) return scored;
    }
    return [];
  }
}

function toScored(row: unknown, extracted: ExtractedMedicine): Scored | null {
  const r = row as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const brandName = typeof r.canonicalName === 'string' ? r.canonicalName : null;
  if (!id || !brandName) return null;

  const strength = typeof r.strength === 'string' ? r.strength : null;
  return {
    score: typeof r.score === 'number' ? r.score : 0,
    strength: compareStrength(extracted.strength, strength),
    medicine: {
      id,
      brandName,
      genericName: typeof r.genericName === 'string' ? r.genericName : null,
      strength,
      manufacturer: typeof r.manufacturer === 'string' ? r.manufacturer : null,
      dosageForm: typeof r.dosageForm === 'string' ? r.dosageForm : null,
    },
  };
}

/**
 * Collapse genuine repetitions, keep genuine differences.
 *
 * A multi-page PDF often restates the same line on a continuation sheet, and a
 * prescription legitimately carries the same medicine at two strengths (a taper,
 * say). Name alone would merge those two into one and lose a dose; name plus
 * strength keeps them apart.
 */
function dedupe(medicines: ExtractedMedicine[]): ExtractedMedicine[] {
  const seen = new Set<string>();
  const out: ExtractedMedicine[] = [];
  for (const medicine of medicines) {
    // An unreadable name falls back to the raw line: two lines the reader could
    // not read are two different medicines until someone says otherwise, and
    // collapsing them on a shared null would drop one from the prescription.
    const identity = (medicine.name ?? medicine.rawText).toLowerCase().replace(/\s+/g, '');
    const key = `${identity}|${(medicine.strength ?? '').toLowerCase().replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(medicine);
  }
  return out;
}
