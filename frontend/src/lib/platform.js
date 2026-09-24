// Build-time platform flags.
//
// The two roots, __ZM_NATIVE__ and __ZM_ADMIN_CONSOLE__, are Vite defines (see
// ../platform-defines.js): literal true/false in the source text. Anything that
// must be REMOVED from a bundle — a route group, a plugin import — tests the
// define itself at the call site, because the bundler does not fold a flag
// imported from another module. The exports below are for everything else:
// ordinary runtime branches where a few dead bytes do not matter.
//
// Flags are named for the CAPABILITY, not the platform, so a call site reads as
// a statement about what is possible ("can we check out in place?") rather than
// a guess about where it runs. Each one is a separate judgement; do not fold
// unrelated decisions into a shared boolean.

/** True in the Android app build (`vite build --mode mobile`). */
export const IS_NATIVE = __ZM_NATIVE__

/**
 * The public web origin, e.g. https://app.zoikomeds.com. Used for deep-link
 * validation and for any URL that must make sense outside the app (canonical
 * tags, links shared to other devices). On the web it is simply where we are.
 */
export const WEB_ORIGIN = IS_NATIVE
  ? import.meta.env.VITE_WEB_ORIGIN
  : typeof window !== 'undefined'
    ? window.location.origin
    : ''

/** The Android application id; also the custom scheme for the OAuth return. */
export const APP_ID = 'com.zoikomeds.app'

/**
 * Play payments policy: an app may not run a third-party checkout in place.
 * The billing page ships in the app; only the payment step leaves it, for the
 * user's real browser.
 */
export const SUPPORTS_IN_APP_CHECKOUT = !IS_NATIVE

/**
 * Google (and most providers) block sign-in inside embedded WebViews. In the
 * app the consent screen opens in a Custom Tab and returns via a deep link.
 */
export const SUPPORTS_IN_PAGE_OAUTH = !IS_NATIVE

/** The Super Admin console. Web-only unless VITE_ADMIN_CONSOLE=true. */
export const SUPPORTS_ADMIN_CONSOLE = __ZM_ADMIN_CONSOLE__

/**
 * Web Speech recognition. Android's WebView exposes `webkitSpeechRecognition`
 * but it does not work there, so the microphone button would be present and
 * broken. Absent is better than broken.
 */
export const SUPPORTS_VOICE_SEARCH = !IS_NATIVE

/**
 * `<a download>` of a blob. A WebView has no download manager, so in the app a
 * generated file is written to the cache and handed to the share sheet instead.
 */
export const SUPPORTS_BLOB_DOWNLOAD = !IS_NATIVE
