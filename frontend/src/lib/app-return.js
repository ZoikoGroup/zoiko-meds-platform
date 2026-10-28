// The way back to the ZoikoMeds Android app from a browser, after a password
// reset that was asked for in the app but finished in the browser.
//
// That happens more often than it should: mail clients commonly drop links on a
// custom scheme, so the email's "open the app" button can be dead and the web
// link is what gets tapped. The reset then succeeded in the browser and left the
// person there, signed out, with the app they started in still waiting.

import { APP_ID } from '@/lib/platform'

/**
 * An Android intent URL that opens the app at its sign-in screen, noting that
 * the password was just changed.
 *
 * intent:// rather than the bare `com.zoikomeds.app://` scheme, because it lets
 * the link say what to do when the app cannot be opened: Chrome (and the
 * browsers that follow it) go to `browser_fallback_url` instead of failing
 * silently or dropping the person on a Play Store page. The fallback is this
 * site's sign-in with the same notice, so a person without the app still ends
 * up somewhere useful.
 *
 * It carries no token and no password: only the fact that a reset succeeded.
 * The person signs in with the password they have just chosen. Nothing here can
 * sign anybody in.
 */
export function appSignInAfterResetUrl(webOrigin) {
  const fallback = `${webOrigin}/login?reset=success`
  return (
    'intent://auth/login?reset=success' +
    `#Intent;scheme=${APP_ID};package=${APP_ID};` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  )
}

/**
 * Is this page open in a browser on an Android phone?
 *
 * Only there can the app be opened from a link. On a computer — where someone
 * may well follow a reset email that came from the app — there is no app to
 * go back to, and offering one would be a dead button.
 */
export function isAndroidBrowser(userAgent = globalThis.navigator?.userAgent ?? '') {
  return /\bAndroid\b/i.test(userAgent)
}
