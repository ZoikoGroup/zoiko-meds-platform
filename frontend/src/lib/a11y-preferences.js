// The accessibility preferences from Settings → Accessibility.
//
// These are device preferences, not account preferences — the same patient on a
// borrowed phone should not inherit the large text they set on their own — so
// they live in localStorage next to the theme and the saved location rather
// than on the profile.
//
// Both are applied as classes on <html>, which is what lets the boot script in
// index.html put them on before first paint. index.css carries the rules.
export const A11Y_PREFERENCES_KEY = 'zoiko-a11y'

/** Class name per preference key. Kept in step with index.css and index.html. */
export const A11Y_CLASSES = {
  largeText: 'a11y-large-text',
  reduceMotion: 'a11y-reduce-motion',
}

/**
 * Defaults for a device that has never been to Settings.
 *
 * Reduce motion starts on when the operating system already asks for it, so the
 * switch reports what the patient is actually getting instead of showing "off"
 * beside a UI that has stopped animating. They can still turn it off here; the
 * stored value wins from then on.
 */
export function defaultPreferences() {
  let reduceMotion = false
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // No matchMedia (older browser, or a test environment). Not reduced.
  }
  return { largeText: false, reduceMotion }
}

/** The stored preferences, falling back to the device defaults. */
export function readPreferences() {
  const defaults = defaultPreferences()
  try {
    const raw = localStorage.getItem(A11Y_PREFERENCES_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    return {
      largeText: Boolean(parsed.largeText ?? defaults.largeText),
      reduceMotion: Boolean(parsed.reduceMotion ?? defaults.reduceMotion),
    }
  } catch {
    // Private mode, disabled storage, or a value some older build wrote.
    return defaults
  }
}

/** Puts the preferences on <html> so the CSS in index.css takes effect. */
export function applyPreferences(prefs) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [key, className] of Object.entries(A11Y_CLASSES)) {
    root.classList.toggle(className, Boolean(prefs?.[key]))
  }
}

/** Persists and applies in one step — every caller wants both. */
export function savePreferences(prefs) {
  try {
    localStorage.setItem(A11Y_PREFERENCES_KEY, JSON.stringify(prefs))
  } catch {
    // Storage is unavailable, so the preference lasts for this session only.
    // Still worth applying: a refused write is not a refused preference.
  }
  applyPreferences(prefs)
}
