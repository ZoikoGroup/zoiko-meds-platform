import { describe, it, expect } from 'vitest'
import { TRANSLATIONS } from '@/locales'

/**
 * Interpolated messages.
 *
 * "Removed Dolo 650 from your saved medicines." used to be built by string
 * concatenation, so the sentence stayed English in every locale while only the
 * medicine name varied. The sentence now lives in the locale file with a
 * {name} token, which also lets word order differ per language — in French the
 * name leads, in Chinese it sits mid-sentence.
 */

const LOCALES = Object.keys(TRANSLATIONS)

/** Keys whose text carries a runtime value, and the tokens each must contain. */
const INTERPOLATED = {
  savedRemovedNamed: ['name'],
  savedAddedNamed: ['name'],
  savedRemoveFailedNamed: ['name'],
  savedNamedToMedicines: ['name'],
  savedNamedOffCatalog: ['name'],
  removeNamedFromSaved: ['name'],
  deleteNotificationNamed: ['title'],
  voiceErrorNamed: ['error'],
  saveFailedReason: ['reason'],
  prioritySetNamed: ['name', 'priority'],
}

const tokensIn = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('interpolated message keys', () => {
  it.each(Object.entries(INTERPOLATED))(
    '%s carries its tokens in every locale',
    (key, tokens) => {
      for (const lang of LOCALES) {
        const value = TRANSLATIONS[lang][key]
        expect(value, `${lang}.${key} is missing`).toBeTruthy()
        expect(tokensIn(value), `${lang}.${key} lost a token`).toEqual([...tokens].sort())
      }
    },
  )

  it('never leaves an unbalanced or stray placeholder anywhere', () => {
    for (const lang of LOCALES) {
      for (const [key, value] of Object.entries(TRANSLATIONS[lang])) {
        const declared = INTERPOLATED[key]
        // A brace in a string that is not an interpolated key means a typo.
        if (!declared) {
          expect(value.includes('{'), `${lang}.${key} has a stray {`).toBe(false)
        }
      }
    }
  })

  it('keeps the dynamic value out of the translated text itself', () => {
    // The medicine name must be a token, never baked into a locale string.
    for (const lang of LOCALES) {
      expect(TRANSLATIONS[lang].savedRemovedNamed).toContain('{name}')
      expect(TRANSLATIONS[lang].savedRemovedNamed).not.toMatch(/Dolo/i)
    }
  })
})

describe('the reported bug, in every language', () => {
  // Exactly the string from the Portuguese screenshot.
  const render = (lang, name) =>
    TRANSLATIONS[lang].savedRemovedNamed.replace('{name}', name)

  it('translates the sentence while keeping the medicine name verbatim', () => {
    expect(render('en', 'Dolo 650')).toBe('Removed Dolo 650 from your saved medicines.')
    expect(render('pt', 'Dolo 650')).toBe('Removido Dolo 650 dos seus medicamentos guardados.')
  })

  it.each(LOCALES)('%s renders no English leftovers around the name', (lang) => {
    const out = render(lang, 'Dolo 650')
    expect(out).toContain('Dolo 650')
    if (lang !== 'en') {
      expect(out).not.toContain('from your saved medicines')
    }
  })
})
