import { describe, expect, it, vi } from 'vitest'

// The app build's values: deep links are checked against the public web origin,
// and the admin console is web-only.
vi.mock('@/lib/platform', () => ({
  APP_ID: 'com.zoikomeds.app',
  SUPPORTS_ADMIN_CONSOLE: false,
  WEB_ORIGIN: 'https://app.zoikomeds.com',
}))

const { routeForIncomingUrl } = await import('@/lib/native')

describe('routeForIncomingUrl — deep links are untrusted input', () => {
  it('takes only the path from a link on the published web origin', () => {
    expect(routeForIncomingUrl('https://app.zoikomeds.com/reset-password?token=abc')).toBe(
      '/reset-password?token=abc',
    )
    expect(routeForIncomingUrl('https://app.zoikomeds.com/medicine/42#stock')).toBe('/medicine/42#stock')
  })

  it('ignores any other origin, including lookalikes', () => {
    expect(routeForIncomingUrl('https://evil.example/dashboard')).toBeNull()
    expect(routeForIncomingUrl('https://app.zoikomeds.com.evil.example/dashboard')).toBeNull()
    expect(routeForIncomingUrl('http://app.zoikomeds.com/dashboard')).toBeNull()
    expect(routeForIncomingUrl('not a url')).toBeNull()
  })

  it('accepts the OAuth return only at auth/callback on the app scheme', () => {
    expect(routeForIncomingUrl('com.zoikomeds.app://auth/callback?token=jwt')).toBe(
      '/auth/callback?token=jwt',
    )
    expect(routeForIncomingUrl('com.zoikomeds.app://auth/callback?error=oauth')).toBe(
      '/auth/callback?error=oauth',
    )
    expect(routeForIncomingUrl('com.zoikomeds.app://pharmacy/billing')).toBeNull()
    expect(routeForIncomingUrl('com.zoikomeds.app://auth/other?token=jwt')).toBeNull()
  })

  it('sends admin links to the web-only notice instead of a missing console', () => {
    expect(routeForIncomingUrl('https://app.zoikomeds.com/admin/users')).toBe('/app/web-only')
  })
})
