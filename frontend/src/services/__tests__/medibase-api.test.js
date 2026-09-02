import { describe, it, expect } from 'vitest'
import {
  apportion,
  compact,
  governanceSeries,
  identifierSeries,
  identityGraphFor,
  normalizationSeries,
  qualitySeries,
  share,
} from '../medibase-api'

/**
 * The MediBase page used to ship a hardcoded catalog: Amoxicillin at 87%
 * normalized, 1.34M brands, tiers at 62/29/9. Every one of those numbers is
 * now a projection of an API response, and these tests hold that line — an
 * absent response must produce nothing, never a plausible-looking figure.
 */

/** An overview exactly as /medibase/admin/catalog/overview returns it. */
const overview = (over = {}) => ({
  total: 200,
  identifierMapping: {
    brands: 1_340_000, generics: 312_400, strengths: 48_200, dosageForms: 11_700, markets: 148, identifiers: 9,
  },
  normalization: { normalized: 174, pending: 18, conflict: 8 },
  governance: { governed: 150, inReview: 30, restricted: 14, suppressed: 6 },
  quality: { A: 150, B: 30, C: 20 },
  topIdentity: {
    id: 'Amoxicillin', generic: 'Amoxicillin', entities: 9, brands: 214,
    strengths: 6, dosageForms: 5, markets: 92, normalization: 99,
    governance: 'governed', quality: 'A',
  },
  ...over,
})

describe('percentages are derived, never assumed', () => {
  it('computes each normalization band as a share of the catalog', () => {
    expect(normalizationSeries(overview())).toEqual([
      { label: 'Fully normalized', value: 87, severity: 'good' },
      { label: 'Pending mapping', value: 9, severity: 'warning' },
      { label: 'Conflict / review', value: 4, severity: 'serious' },
    ])
  })

  it('moves with the data rather than holding at 87/9/4', () => {
    const [normalized] = normalizationSeries(
      overview({ total: 10, normalization: { normalized: 1, pending: 4, conflict: 5 } }),
    )
    expect(normalized.value).toBe(10)
  })

  it('computes quality tiers as shares, not the old 62/29/9', () => {
    expect(qualitySeries(overview()).map((q) => q.value)).toEqual([75, 15, 10])
  })

  it('gives each governance tile its live share of the catalog', () => {
    expect(governanceSeries(overview())).toEqual([
      { label: 'Governed identities', value: '150', hint: '75% of catalog' },
      { label: 'In review', value: '30', hint: '15% of catalog' },
      { label: 'Restricted', value: '14', hint: '7% of catalog' },
      { label: 'Suppressed', value: '6', hint: '3% of catalog' },
    ])
  })

  it('survives an empty catalog without dividing by zero', () => {
    const empty = overview({
      total: 0,
      normalization: { normalized: 0, pending: 0, conflict: 0 },
      governance: { governed: 0, inReview: 0, restricted: 0, suppressed: 0 },
      quality: { A: 0, B: 0, C: 0 },
    })
    expect(normalizationSeries(empty).map((n) => n.value)).toEqual([0, 0, 0])
    expect(governanceSeries(empty)[0].hint).toBe('0% of catalog')
    expect(share(5, 0)).toBe(0)
  })
})

describe('identifier mapping', () => {
  it('abbreviates counts the way the cards always displayed them', () => {
    expect(identifierSeries(overview()).map((l) => l.count)).toEqual([
      '1.34M', '312.4K', '48.2K', '11.7K', '148',
    ])
  })

  it('abbreviates small and round numbers without trailing noise', () => {
    expect(compact(0)).toBe('0')
    expect(compact(54)).toBe('54')
    expect(compact(1000)).toBe('1K')
    expect(compact(2_000_000)).toBe('2M')
  })
})

describe('identity graph', () => {
  it('is built from the identity the backend chose', () => {
    const graph = identityGraphFor(overview().topIdentity)
    expect(graph.root.label).toBe('Amoxicillin')
    expect(graph.branches.map((b) => b.value)).toEqual([
      '214 trade names',
      '6 dose strengths',
      '5 presentations',
      '92 jurisdictions',
      'Tier A · governed',
    ])
  })

  it('singularises a count of one instead of saying "1 trade names"', () => {
    const graph = identityGraphFor({
      id: 'X', generic: 'X', brands: 1, strengths: 1, dosageForms: 1, markets: 1,
      governance: 'in-review', quality: 'B',
    })
    expect(graph.branches.map((b) => b.value)).toEqual([
      '1 trade name', '1 dose strength', '1 presentation', '1 jurisdiction', 'Tier B · in-review',
    ])
  })

  it('renders no graph at all when the catalog is empty', () => {
    expect(identityGraphFor(null)).toBeNull()
  })
})

describe('a missing response yields nothing, not a fallback', () => {
  it.each([
    ['normalization', normalizationSeries],
    ['identifier mapping', identifierSeries],
    ['quality tiers', qualitySeries],
    ['governance tiles', governanceSeries],
  ])('%s is empty when the overview failed to load', (_label, build) => {
    expect(build(null)).toEqual([])
    expect(build(undefined)).toEqual([])
    expect(build({})).toEqual([])
  })
})

describe('bands that partition the catalog always display as 100%', () => {
  // The live catalog: 10 governed / 43 in review / 0 restricted / 1 suppressed
  // of 54. Rounding each band on its own printed 19 + 80 + 2 = 101%.
  const skewed = overview({
    total: 54,
    normalization: { normalized: 10, pending: 0, conflict: 44 },
    governance: { governed: 10, inReview: 43, restricted: 0, suppressed: 1 },
    quality: { A: 10, B: 43, C: 1 },
  })

  const sum = (xs) => xs.reduce((a, b) => a + b, 0)

  it('quality tiers no longer sum to 101', () => {
    const values = qualitySeries(skewed).map((q) => q.value)
    expect(sum(values)).toBe(100)
    // 18.5 / 79.6 / 1.9 — the two largest remainders take the spare points, so
    // A rounds down to 18 rather than every band rounding up to 19+80+2=101.
    expect(values).toEqual([18, 80, 2])
  })

  it('governance tile shares sum to 100', () => {
    const pcts = governanceSeries(skewed).map((g) => Number(g.hint.replace('% of catalog', '')))
    expect(sum(pcts)).toBe(100)
  })

  it('normalization bands sum to 100', () => {
    expect(sum(normalizationSeries(skewed).map((n) => n.value))).toBe(100)
  })

  it('keeps counts exact even where a percentage was rounded down', () => {
    // 43 of 54 is 79.6%, shown as 79 so the column adds up. The count itself
    // is never adjusted.
    expect(governanceSeries(skewed)[1].value).toBe('43')
  })

  it.each([
    [[1, 1, 1], 3],
    [[1, 0, 0], 1],
    [[33, 33, 34], 100],
    [[7, 11, 13, 23], 54],
    [[1, 2, 3, 4, 5, 6], 21],
  ])('apportions %j over %i to exactly 100', (values, total) => {
    expect(sum(apportion(values, total))).toBe(100)
  })

  it('gives the leftover point to the largest fractional part', () => {
    // 1/3 each: 33.33 → floors 33,33,33 with 1 point left; the tie breaks to
    // the largest band, and all three are equal, so the first one takes it.
    expect(apportion([1, 1, 1], 3)).toEqual([34, 33, 33])
  })

  it('returns zeros for an empty catalog rather than forcing 100', () => {
    expect(apportion([0, 0, 0], 0)).toEqual([0, 0, 0])
  })

  it('leaves a genuine shortfall visible instead of papering over it', () => {
    // Bands that do not account for every record must not be scaled up to
    // 100% — that would hide a backend bug behind a tidy total.
    expect(apportion([10, 10], 100)).toEqual([10, 10])
  })
})
