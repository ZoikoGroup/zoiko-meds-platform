import en from './en'
import hi from './hi'
import te from './te'
import es from './es'
import fr from './fr'
import ar from './ar'
import zh from './zh'
import pt from './pt'

/**
 * Locale registry.
 *
 * Adding a language is two lines here plus one file next to this one — no
 * component, layout or stylesheet is touched. English stays the source locale
 * and the fallback for any key a translation has not caught up with yet.
 */
export const TRANSLATIONS = { en, hi, te, es, fr, ar, zh, pt }

/** Names shown in the language picker, each in its own script. */
export const LANG_NAMES = {
  en: 'English',
  hi: 'हिन्दी (Hindi)',
  te: 'తెలుగు (Telugu)',
  es: 'Español (Spanish)',
  fr: 'Français (French)',
  ar: 'العربية (Arabic)',
  zh: '简体中文 (Simplified Chinese)',
  pt: 'Português (Portuguese)',
}

/**
 * Writing direction per locale. Anything absent is left-to-right, so a new LTR
 * language needs no entry at all — only an RTL one does.
 */
export const LANG_DIR = { ar: 'rtl' }

export const DEFAULT_LANG = 'en'

/** Direction for a locale, defaulting to ltr. */
export const dirFor = (lang) => LANG_DIR[lang] ?? 'ltr'

/** True when `lang` is a locale we actually ship. */
export const isSupported = (lang) => Object.hasOwn(TRANSLATIONS, lang)
