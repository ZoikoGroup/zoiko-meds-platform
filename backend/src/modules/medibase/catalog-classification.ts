import { Prisma } from '@prisma/client';

/**
 * MediBase™ catalog classification — the single definition of how a stored
 * medicine identity is presented on the governance surfaces.
 *
 * The database carries one governance dimension (`QualityState`) plus the
 * `isControlled` / `isSuppressed` flags. The admin catalog view presents three
 * derived views of that one dimension — governance state, normalization state,
 * and quality tier — so the mapping has to be defined once and reused, or the
 * donut, the tier bars, the governance tiles and the table would disagree with
 * each other while all claiming to describe the same catalog.
 *
 * It lives in SQL because every consumer is an aggregate: computing it in
 * TypeScript would mean loading the whole catalog to count it.
 *
 *   governance    suppressed → restricted → governed → in-review  (first match)
 *   normalization VERIFIED/MAPPED are resolved; INFERRED/PARTNER_SUPPLIED are
 *                 awaiting a mapping; the rest are in or out of review.
 *   quality tier  A verified · B provisional · C controlled or withheld,
 *                 derived from governance so the two columns cannot diverge.
 */
export const CLASSIFIED_CATALOG = Prisma.sql`
  SELECT
    m.id,
    m."canonicalName",
    m."brandNames",
    m.strength,
    m."dosageForm",
    m."jurisdictionId",
    -- A medicine with no generic recorded is its own generic root, so it still
    -- appears as an identity rather than collapsing into a null group.
    COALESCE(NULLIF(btrim(m."genericName"), ''), m."canonicalName") AS generic,
    CASE
      WHEN m."isSuppressed" OR m."qualityState" = 'SUPPRESSED' THEN 'suppressed'
      WHEN m."isControlled" THEN 'restricted'
      WHEN m."qualityState" = 'VERIFIED' THEN 'governed'
      ELSE 'in-review'
    END AS governance,
    CASE
      WHEN m."qualityState" IN ('VERIFIED', 'MAPPED') THEN 'normalized'
      WHEN m."qualityState" IN ('INFERRED', 'PARTNER_SUPPLIED') THEN 'pending'
      ELSE 'conflict'
    END AS normalization
  FROM "MedicineEntity" m
`;

/**
 * Every trade name the catalog knows, one row per (identity, brand).
 *
 * `canonicalName` is the trade name a pharmacy actually stocks ("Dolo 650")
 * while `genericName` is the INN root, so the canonical name counts as a brand
 * alongside the explicit `brandNames[]`. Lower-cased and trimmed so casing
 * variants do not inflate the count.
 */
export const BRAND_ROWS = Prisma.sql`
  SELECT DISTINCT c.generic, lower(btrim(b.name)) AS brand
  FROM classified c
  CROSS JOIN LATERAL (
    SELECT c."canonicalName" AS name
    UNION
    SELECT x FROM unnest(c."brandNames") AS x
  ) b
  WHERE btrim(b.name) <> ''
`;

/** Governance states, in the order the UI lists them. */
export type GovernanceState = 'governed' | 'in-review' | 'restricted' | 'suppressed';

/** Quality tier implied by a group's governance state. */
export function tierFor(governance: GovernanceState): 'A' | 'B' | 'C' {
  if (governance === 'governed') return 'A';
  if (governance === 'in-review') return 'B';
  return 'C';
}
