import { describe, it, expect } from 'vitest'
import { innFor, normalizeQuery, toSearchQuery, INN_NAMES } from '../inn'

/**
 * INN resolution for non-Latin queries.
 *
 * The guarantee that matters most is the negative one: a Latin-script query
 * must reach the API byte-identical, so every existing search behaves exactly
 * as it did before this layer was added.
 */

describe('Latin-script queries are never rewritten', () => {
  it.each([
    'Dolo 650',
    'Paracetamol',
    'acetaminophen',
    'Zifi 200',
    'amoxicillin 500 mg',
    'Betadine 10%',
    '',
  ])('passes %j through untouched', (q) => {
    expect(toSearchQuery(q)).toBe(q)
  })

  it('leaves accented French alone — the backend already matches it', () => {
    // Accents are Latin-1; MediBase sees the catalog and does better than a
    // fixed index would.
    expect(toSearchQuery('paracétamol')).toBe('paracétamol')
  })
})

describe('non-Latin queries resolve to an INN', () => {
  it.each([
    ['باراسيتامول', 'paracetamol'],
    ['对乙酰氨基酚', 'paracetamol'],
    ['扑热息痛', 'paracetamol'],
    ['布洛芬', 'ibuprofen'],
    ['إيبوبروفين', 'ibuprofen'],
    ['阿莫西林', 'amoxicillin'],
    ['二甲双胍', 'metformin'],
    ['胰岛素', 'insulin'],
    ['أسبرين', 'aspirin'],
  ])('%s → %s', (query, inn) => {
    expect(toSearchQuery(query)).toBe(inn)
  })

  it('resolves a name embedded in a dosage phrase', () => {
    expect(toSearchQuery('باراسيتامول 500')).toBe('paracetamol')
    expect(toSearchQuery('布洛芬 400mg')).toBe('ibuprofen')
  })

  it('passes an unknown non-Latin query through rather than guessing', () => {
    // Never substitute a different medicine just to return something.
    expect(toSearchQuery('دواء غير معروف')).toBe('دواء غير معروف')
    expect(toSearchQuery('未知药物')).toBe('未知药物')
  })
})

describe('INN equivalence', () => {
  it('maps the Arabic for acetaminophen onto paracetamol', () => {
    // Same active ingredient under its other international name.
    expect(innFor('اسيتامينوفين')).toBe('paracetamol')
    expect(innFor('باراسيتامول')).toBe('paracetamol')
  })

  it('resolves every listed synonym to its own INN', () => {
    for (const [inn, names] of Object.entries(INN_NAMES)) {
      for (const name of names) {
        expect(innFor(name)).toBe(inn)
      }
    }
  })

  it('resolves an INN to itself', () => {
    expect(innFor('paracetamol')).toBe('paracetamol')
    expect(innFor('Insulin Glargine')).toBe('insulin glargine')
  })

  it('returns null when nothing matches', () => {
    expect(innFor('not-a-medicine')).toBeNull()
    expect(innFor('')).toBeNull()
    expect(innFor(null)).toBeNull()
  })
})

describe('query normalization', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeQuery('Paracétamol,  650mg!')).toBe('paracetamol 650mg')
  })

  it('leaves Arabic and CJK characters intact', () => {
    expect(normalizeQuery('باراسيتامول')).toBe('باراسيتامول')
    expect(normalizeQuery('对乙酰氨基酚')).toBe('对乙酰氨基酚')
  })

  it('handles null and undefined', () => {
    expect(normalizeQuery(null)).toBe('')
    expect(normalizeQuery(undefined)).toBe('')
  })
})

describe('the index is name data only', () => {
  it('never maps one name onto two different active ingredients', () => {
    // The property that matters: no name may resolve to a different medicine
    // depending on iteration order, or a search could silently switch drugs.
    // Two spellings of the same INN folding together (ondansétron /
    // ondansetrón) is fine — they resolve to the same ingredient.
    const seen = new Map()
    for (const [inn, names] of Object.entries(INN_NAMES)) {
      for (const name of names) {
        const key = normalizeQuery(name)
        const owner = seen.get(key)
        expect(
          owner === undefined || owner === inn,
          `"${name}" is claimed by both ${owner} and ${inn}`,
        ).toBe(true)
        seen.set(key, inn)
      }
    }
  })

  it('resolves every synonym to its own INN, never a neighbour', () => {
    for (const [inn, names] of Object.entries(INN_NAMES)) {
      for (const name of names) {
        const resolved = innFor(name)
        expect(resolved).toBe(inn)
      }
    }
  })

  it('lists no empty or whitespace-only names', () => {
    for (const names of Object.values(INN_NAMES)) {
      for (const name of names) expect(name.trim()).not.toBe('')
    }
  })
})
