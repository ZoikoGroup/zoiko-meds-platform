import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import {
  DEFAULT_LANG,
  LANG_NAMES,
  TRANSLATIONS,
  dirFor,
  isSupported,
} from '@/locales'

/**
 * UI language and writing direction.
 *
 * Translations live in src/locales — one flat key→string file per language —
 * so adding a locale never touches a component. This file owns only the
 * behaviour: which locale is active, how it persists, how `t()` falls back, and
 * keeping <html lang>/<html dir> in step so RTL works without any component
 * knowing about it.
 */

const LanguageContext = createContext(null)

const STORAGE_KEY = 'zoiko-lang'

export { LANG_NAMES }

/** The stored locale, or English when nothing valid is stored. */
function readStoredLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    // An unknown code (a removed locale, a hand-edited value) must not leave
    // the UI keyless — fall back rather than render raw key names.
    return saved && isSupported(saved) ? saved : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

/**
 * Point the document at the active locale.
 *
 * `dir` is what actually flips the layout: with logical CSS properties
 * (padding-inline, inset-inline, text-align: start) the whole dashboard mirrors
 * from this one attribute.
 */
function applyDocumentLocale(lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.documentElement.dir = dirFor(lang)
}

/**
 * Look a key up in `lang`, then English, then the caller's fallback.
 *
 * `params` fills `{placeholder}` tokens, which is how a message keeps its
 * dynamic parts — a medicine name, a count — while the sentence around them is
 * translated. Word order differs between languages, so the token has to travel
 * inside the translated string rather than being concatenated onto it.
 */
function translate(lang, key, fallback = '', params) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG]
  const template = dict[key] || TRANSLATIONS[DEFAULT_LANG][key] || fallback || key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, token) =>
    // An unknown token is left as written rather than blanked, so a typo shows
    // up as {name} on screen instead of a silently truncated sentence.
    Object.hasOwn(params, token) ? String(params[token]) : match,
  )
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang)

  // Apply on mount too: a locale restored from storage must set dir before
  // first paint, or an Arabic session flashes left-to-right on every reload.
  useEffect(() => {
    applyDocumentLocale(lang)
  }, [lang])

  useEffect(() => {
    const handleLangChange = () => setLangState(readStoredLang())

    window.addEventListener('zoiko-language-change', handleLangChange)
    window.addEventListener('storage', handleLangChange)
    return () => {
      window.removeEventListener('zoiko-language-change', handleLangChange)
      window.removeEventListener('storage', handleLangChange)
    }
  }, [])

  const setLanguage = useCallback((newLang) => {
    const next = isSupported(newLang) ? newLang : DEFAULT_LANG
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode — the choice still applies for this session */
    }
    setLangState(next)
    applyDocumentLocale(next)
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('zoiko-language-change'))
  }, [])

  const t = useCallback(
    (key, fallback = '', params) => translate(lang, key, fallback, params),
    [lang],
  )

  const value = useMemo(
    () => ({
      language: lang,
      setLanguage,
      t,
      dir: dirFor(lang),
      isRtl: dirFor(lang) === 'rtl',
      translations: TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG],
    }),
    [lang, setLanguage, t],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (ctx) return ctx

  // Rendered outside the provider (isolated tests, storybook-style mounts).
  // Reads the same storage so behaviour matches, just without subscriptions.
  const currentLang = readStoredLang()
  return {
    language: currentLang,
    setLanguage: (l) => {
      const next = isSupported(l) ? l : DEFAULT_LANG
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      applyDocumentLocale(next)
      window.dispatchEvent(new Event('zoiko-language-change'))
    },
    t: (k, fb, params) => translate(currentLang, k, fb, params),
    dir: dirFor(currentLang),
    isRtl: dirFor(currentLang) === 'rtl',
    translations: TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG],
  }
}
