import { describe, expect, it } from 'vitest'
import { appSignInAfterResetUrl, isAndroidBrowser } from '@/lib/app-return'
import { routeForIncomingUrl } from '@/lib/native'

/**
 * The way back to the app after a reset finished in the browser.
 *
 * Held to three things: it opens the app at sign-in, it has somewhere safe to
 * go when the app cannot be opened, and it carries nothing that could sign
 * anybody in.
 */

const ORIGIN = 'https://app.zoikomeds.com'

describe('appSignInAfterResetUrl', () => {
  const url = appSignInAfterResetUrl(ORIGIN)

  it('is an Android intent for the app’s own scheme and package', () => {
    expect(url.startsWith('intent://auth/login?reset=success#Intent;')).toBe(true)
    expect(url).toContain(';scheme=com.zoikomeds.app;')
    // The package pins it to this app: no other app can answer the link.
    expect(url).toContain(';package=com.zoikomeds.app;')
    expect(url.endsWith(';end')).toBe(true)
  })

  it('falls back to this site’s sign-in when the app cannot be opened', () => {
    const fallback = /S\.browser_fallback_url=([^;]+);/.exec(url)?.[1]
    expect(decodeURIComponent(fallback)).toBe('https://app.zoikomeds.com/login?reset=success')
    // Encoded, so its own ? and = cannot be read as part of the intent.
    expect(fallback).not.toContain('?')
  })

  it('carries no token, no password and no session — only that a reset succeeded', () => {
    expect(url).not.toMatch(/token|password|session|jwt/i)
  })

  it('arrives in the app as its sign-in screen with the notice', () => {
    // What the app sees once Android resolves the intent: the scheme link.
    expect(routeForIncomingUrl('com.zoikomeds.app://auth/login?reset=success')).toBe(
      '/login?reset=success',
    )
  })
})

describe('isAndroidBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36', true],
    ['Mozilla/5.0 (Linux; Android 13; SM-S911B) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', false],
    ['', false],
  ])('%s → %s', (userAgent, expected) => {
    expect(isAndroidBrowser(userAgent)).toBe(expected)
  })
})
