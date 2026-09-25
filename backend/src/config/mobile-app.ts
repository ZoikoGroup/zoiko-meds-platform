import { ConfigService } from '@nestjs/config';

/**
 * Settings for the ZoikoMeds Android app (Capacitor).
 *
 * The app is the same SPA, served to its WebView from the phone itself, so to
 * this API it is one more browser — whose origin happens to be localhost. Two
 * things follow, and both are kept apart from the web settings on purpose:
 *
 * - CORS. The WebView's origin has to be allowed or nobody can sign in. It is
 *   NOT added to CORS_ORIGIN: that list also decides where outbound links point
 *   (see app-urls.ts), and production refuses localhost there. Instead
 *   MOBILE_APP_ORIGINS is validated against the closed set of origins Capacitor
 *   actually uses, so the setting cannot become a way to put an arbitrary
 *   origin past the CORS policy.
 *
 * - The OAuth return. Google refuses sign-in inside a WebView, so the app opens
 *   the consent screen in the user's browser (a Custom Tab) and needs the
 *   session handed back to the app, not to the web callback page.
 */

/** Every origin a Capacitor WebView can report. Android: https; iOS: capacitor. */
export const KNOWN_CAPACITOR_ORIGINS = ['https://localhost', 'capacitor://localhost'] as const;

/** Split MOBILE_APP_ORIGINS into entries; returns the ones that are not allowed. */
export function invalidMobileAppOrigins(raw: string): string[] {
  return splitList(raw).filter(
    (o) => !(KNOWN_CAPACITOR_ORIGINS as readonly string[]).includes(o),
  );
}

/** The configured app origins, e.g. ['https://localhost']. Empty = no app. */
export function mobileAppOrigins(config: ConfigService): string[] {
  const entries = splitList(config.get<string>('MOBILE_APP_ORIGINS') ?? '');
  // Validation has already rejected anything else; filter again so a bypassed
  // validator can never widen CORS.
  return entries.filter((o) => (KNOWN_CAPACITOR_ORIGINS as readonly string[]).includes(o));
}

/**
 * A redirect target for the app's OAuth return must be a custom scheme owned by
 * the app (com.zoikomeds.app://auth/callback), never an http(s) URL: an http
 * target here would be an open redirect carrying a session token.
 */
export function isValidMobileOAuthRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    const scheme = url.protocol.replace(/:$/, '');
    // Reverse-DNS scheme: at least two dot-separated labels, no http(s)/file/js.
    return (
      /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(scheme) && url.host === 'auth' && url.pathname === '/callback'
    );
  } catch {
    return false;
  }
}

/** Where to send an app sign-in, or null when the app flow is not configured. */
export function mobileOAuthRedirect(config: ConfigService): string | null {
  const configured = config.get<string>('MOBILE_OAUTH_REDIRECT')?.trim();
  return configured && isValidMobileOAuthRedirect(configured) ? configured : null;
}

/** The OAuth `state` value that marks a sign-in started from the app. */
export const APP_OAUTH_STATE = 'app';

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
