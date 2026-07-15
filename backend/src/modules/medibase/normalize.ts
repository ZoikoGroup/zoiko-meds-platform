/**
 * MediBase™ normalization pipeline.
 *
 * Pure, dependency-free text utilities that turn free-text medicine queries and
 * labels into normalized, comparable forms. Used by the matching layer to rank
 * candidate entities. Contains NO clinical logic — it does not decide
 * equivalence, substitution, or interchangeability; it only measures textual
 * similarity to surface candidates a human/consumer can disambiguate.
 */

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Canonicalize free text for comparison: strip diacritics, lowercase, replace
 * punctuation with spaces, and collapse whitespace.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9%/.+ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split normalized text into meaningful tokens (drops 1-char noise). */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[\s-]+/)
    .filter((t) => t.length > 1);
}

// ---------------------------------------------------------------------------
// Strength parsing
// ---------------------------------------------------------------------------

export interface ParsedStrength {
  raw: string;
  value: number;
  unit: string;
  /** Normalized "value+unit" key, e.g. "650mg", used for exact comparison. */
  key: string;
}

// Recognized strength units, normalized to a canonical spelling.
const UNIT_ALIASES: Record<string, string> = {
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  mcg: 'mcg',
  microgram: 'mcg',
  micrograms: 'mcg',
  µg: 'mcg',
  ug: 'mcg',
  ml: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  l: 'l',
  iu: 'iu',
  u: 'u',
  unit: 'u',
  units: 'u',
  '%': '%',
};

const STRENGTH_RE =
  /(\d+(?:\.\d+)?)\s*(mg|milligrams?|mcg|micrograms?|µg|ug|gm|grams?|g|ml|milli(?:liter|litre)s?|iu|units?|u|l|%)(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|l|mg|dose|puff|tab|cap)?)?/gi;

/**
 * Extract all strength expressions from a string. Handles simple ("650 mg"),
 * ratio ("100 U/mL", "5 mg/5 ml") and percentage ("0.9%") forms.
 */
export function parseStrength(input: string): ParsedStrength[] {
  const out: ParsedStrength[] = [];
  const text = input.toLowerCase();
  for (const m of text.matchAll(STRENGTH_RE)) {
    const value = Number(m[1]);
    if (Number.isNaN(value)) continue;
    const unit = UNIT_ALIASES[m[2]] ?? m[2];
    const denomValue = m[3];
    const denomUnit = m[4] ? UNIT_ALIASES[m[4]] ?? m[4] : undefined;
    const key = denomUnit
      ? `${value}${unit}/${denomValue ?? ''}${denomUnit}`
      : `${value}${unit}`;
    out.push({ raw: m[0].trim(), value, unit, key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dosage-form parsing
// ---------------------------------------------------------------------------

// Maps common spellings/abbreviations to a canonical dosage form label.
const FORM_ALIASES: Record<string, string> = {
  tab: 'Tablet',
  tabs: 'Tablet',
  tablet: 'Tablet',
  tablets: 'Tablet',
  cap: 'Capsule',
  caps: 'Capsule',
  capsule: 'Capsule',
  capsules: 'Capsule',
  syrup: 'Syrup',
  susp: 'Suspension',
  suspension: 'Suspension',
  soln: 'Solution',
  solution: 'Solution',
  inj: 'Injection',
  injection: 'Injection',
  injectable: 'Injection',
  vial: 'Injection',
  pen: 'Injection pen',
  cream: 'Cream',
  ointment: 'Ointment',
  gel: 'Gel',
  drops: 'Drops',
  drop: 'Drops',
  spray: 'Spray',
  inhaler: 'Inhaler',
  patch: 'Patch',
  suppository: 'Suppository',
  powder: 'Powder',
  sachet: 'Sachet',
  lozenge: 'Lozenge',
};

/** Canonicalize a dosage-form token/phrase, or return null if unrecognized. */
export function parseDosageForm(input: string): string | null {
  const tokens = tokenize(input);
  for (const t of tokens) {
    const hit = FORM_ALIASES[t];
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spelling variants (non-clinical name synonyms & common typos)
// ---------------------------------------------------------------------------

/**
 * Bidirectional name-variant groups. These are well-established international
 * naming differences (INN vs USAN) and common consumer spellings — NOT clinical
 * substitution rules. They only widen the candidate net for matching.
 */
const VARIANT_GROUPS: string[][] = [
  ['paracetamol', 'acetaminophen'],
  ['salbutamol', 'albuterol'],
  ['adrenaline', 'epinephrine'],
  ['noradrenaline', 'norepinephrine'],
  ['frusemide', 'furosemide'],
  ['lignocaine', 'lidocaine'],
  ['glyceryl trinitrate', 'nitroglycerin'],
  ['rifampicin', 'rifampin'],
  ['ciclosporin', 'cyclosporine'],
  ['amoxycillin', 'amoxicillin'],
];

const VARIANT_INDEX: Map<string, string[]> = (() => {
  const idx = new Map<string, string[]>();
  for (const group of VARIANT_GROUPS) {
    for (const term of group) {
      idx.set(term, group.filter((t) => t !== term));
    }
  }
  return idx;
})();

/**
 * Expand a query into its normalized form plus any known name variants, so a
 * search for "acetaminophen" also matches entities labeled "paracetamol".
 */
export function expandVariants(query: string): string[] {
  const base = normalizeText(query);
  const variants = new Set<string>([base]);
  const hit = VARIANT_INDEX.get(base);
  if (hit) hit.forEach((v) => variants.add(v));
  return [...variants];
}

// ---------------------------------------------------------------------------
// Fuzzy similarity (typo tolerance)
// ---------------------------------------------------------------------------

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similarity in [0,1]: 1 = identical, degrading with edit distance. */
export function similarity(a: string, b: string): number {
  const an = normalizeText(a);
  const bn = normalizeText(b);
  if (!an && !bn) return 1;
  const maxLen = Math.max(an.length, bn.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(an, bn) / maxLen;
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

export interface ScorableEntity {
  canonicalName: string;
  genericName?: string | null;
  brandNames?: string[];
  strength?: string | null;
  dosageForm?: string | null;
}

/**
 * Relevance score in [0,1] for an entity against a normalized query. Combines
 * exact / prefix / substring / fuzzy signals across the canonical, generic and
 * brand names, with a bonus when a strength in the query aligns with the entity.
 */
export function scoreMatch(query: string, entity: ScorableEntity): number {
  const q = normalizeText(query);
  if (!q) return 0;

  const fields: Array<{ text: string; weight: number }> = [
    { text: normalizeText(entity.canonicalName), weight: 1 },
    { text: entity.genericName ? normalizeText(entity.genericName) : '', weight: 0.9 },
    ...(entity.brandNames ?? []).map((b) => ({
      text: normalizeText(b),
      weight: 0.85,
    })),
  ];

  let best = 0;
  for (const f of fields) {
    if (!f.text) continue;
    let s = 0;
    if (f.text === q) s = 1;
    else if (f.text.startsWith(q) || q.startsWith(f.text)) s = 0.82;
    else if (f.text.includes(q) || q.includes(f.text)) s = 0.7;
    else s = similarity(q, f.text) * 0.7; // fuzzy, capped below substring
    best = Math.max(best, s * f.weight);
  }

  // Strength alignment bonus: if the query mentions a strength the entity also
  // carries, nudge the score up (helps "paracetamol 650" over "paracetamol 500").
  const qStrengths = parseStrength(query).map((p) => p.key);
  if (qStrengths.length && entity.strength) {
    const eStrengths = parseStrength(entity.strength).map((p) => p.key);
    if (qStrengths.some((k) => eStrengths.includes(k))) {
      best = Math.min(1, best + 0.1);
    }
  }

  return Number(best.toFixed(4));
}
