import { describe, it, expect } from 'vitest'
import { TRANSLATIONS, LANG_NAMES, LANG_DIR, DEFAULT_LANG, dirFor, isSupported } from '@/locales'

/**
 * Locale parity and direction.
 *
 * English is the source locale. A translation that silently loses a key would
 * render English mid-sentence in an otherwise translated screen, so parity is
 * pinned here rather than left to review.
 */

const LOCALES = Object.keys(TRANSLATIONS)
const enKeys = Object.keys(TRANSLATIONS.en)

describe('locale registry', () => {
  it('ships the eight Phase 1 languages', () => {
    expect(LOCALES.sort()).toEqual(['ar', 'en', 'es', 'fr', 'hi', 'pt', 'te', 'zh'])
  })

  it('keeps English as the default', () => {
    expect(DEFAULT_LANG).toBe('en')
  })

  it('names every locale in the picker', () => {
    for (const l of LOCALES) expect(LANG_NAMES[l]).toBeTruthy()
    // No orphan names for locales that do not exist.
    expect(Object.keys(LANG_NAMES).sort()).toEqual(LOCALES.sort())
  })

  it('recognises supported locales and rejects unknown ones', () => {
    expect(isSupported('fr')).toBe(true)
    expect(isSupported('ar')).toBe(true)
    expect(isSupported('xx')).toBe(false)
  })
})

describe('translation coverage', () => {
  it.each(LOCALES)('%s defines every English key', (lang) => {
    const missing = enKeys.filter((k) => !(k in TRANSLATIONS[lang]))
    expect(missing).toEqual([])
  })

  it.each(LOCALES)('%s defines no keys English does not have', (lang) => {
    const extra = Object.keys(TRANSLATIONS[lang]).filter((k) => !enKeys.includes(k))
    expect(extra).toEqual([])
  })

  it.each(LOCALES)('%s has no empty strings', (lang) => {
    const blank = Object.entries(TRANSLATIONS[lang])
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k)
    expect(blank).toEqual([])
  })

  it.each(LOCALES.filter((l) => l !== 'en'))(
    '%s is actually translated, not an English copy',
    (lang) => {
      // Trademarks and a few tokens are identical by design; anything beyond a
      // small overlap means a locale was stubbed out with English.
      const identical = enKeys.filter((k) => TRANSLATIONS[lang][k] === TRANSLATIONS.en[k])
      expect(identical.length).toBeLessThan(enKeys.length * 0.1)
    },
  )

  // hi and te transliterate the mark into their own script (ज़ोइको सिग्नल™,
  // జోయికో సిగ్నల్™) — a deliberate choice made when those locales were written
  // and deliberately left alone. The Latin-script locales keep it as the mark.
  it.each(['en', 'es', 'fr', 'ar', 'zh', 'pt'])(
    '%s leaves the ZoikoSignal™ trademark untranslated',
    (lang) => {
      expect(TRANSLATIONS[lang].zoikoSignal).toBe('ZoikoSignal™')
    },
  )
})

describe('writing direction', () => {
  it('marks Arabic as right-to-left', () => {
    expect(dirFor('ar')).toBe('rtl')
    expect(LANG_DIR.ar).toBe('rtl')
  })

  it.each(['en', 'fr', 'zh', 'pt', 'hi', 'te', 'es'])('leaves %s left-to-right', (lang) => {
    expect(dirFor(lang)).toBe('ltr')
  })

  it('defaults an unknown locale to ltr rather than undefined', () => {
    // A new LTR language needs no LANG_DIR entry at all.
    expect(dirFor('xx')).toBe('ltr')
  })
})
