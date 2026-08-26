import { apiFetch, apiBaseUrl } from '@/lib/api-client'

// Auth endpoints exposed by the NestJS backend (see modules/auth).

// OAuth providers that map to backend /auth/<provider> redirect endpoints.
export const OAUTH_PROVIDERS = ['google', 'microsoft']

/**
 * Full backend URL that begins an OAuth flow. This is a full-page browser
 * navigation (not fetch): the backend redirects to the provider and, on
 * success, back to the SPA /auth/callback with a token.
 */
export function oauthUrl(provider) {
  return `${apiBaseUrl()}/auth/${provider}`
}

export function loginRequest(email, password, mfaCode) {
  return apiFetch('/auth/login', {
    method: 'POST',
    // Omitted rather than sent empty: the field is optional on the API, and an
    // empty string would fail its format check instead of reading as absent.
    body: { email, password, ...(mfaCode ? { mfaCode } : {}) },
    auth: false,
  })
}

export function registerRequest({ email, fullName, password, phone }) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: { email, fullName, password, ...(phone ? { phone } : {}) },
    auth: false,
  })
}

export function meRequest() {
  return apiFetch('/auth/me')
}

export function updateProfileRequest({ fullName, phone }) {
  return apiFetch('/auth/me', {
    method: 'PATCH',
    body: { fullName, phone },
  })
}

// A wrong current password is answered with 400 "Current password is incorrect",
// so a 401 here only ever means the session itself is gone. This used to opt out
// of the shared 401 handling, which left an expired session showing the raw word
// "Unauthorized" in the form while the user stayed on a page they could no longer
// use (MP-18).
export function changePasswordRequest(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}

export function forgotPasswordRequest(email) {
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: { email },
    auth: false,
  })
}

export function resetPasswordRequest(token, newPassword) {
  return apiFetch('/auth/reset-password', {
    method: 'POST',
    body: { token, newPassword },
    auth: false,
  })
}

export function logoutRequest() {
  return apiFetch('/auth/logout', {
    method: 'POST',
  })
}



// --- Two-factor authentication (MSA-42) ------------------------------------
//
// Enrolment is two calls: setup mints a secret and returns the otpauth:// URI to
// scan, confirm proves a code against it. Nothing is required of the account
// until a code has been confirmed, so an abandoned setup changes nothing.

export const getMfaStatus = () => apiFetch('/auth/mfa')

export const beginMfaSetup = () => apiFetch('/auth/mfa/setup', { method: 'POST' })

export const confirmMfaSetup = (code) =>
  apiFetch('/auth/mfa/confirm', { method: 'POST', body: { code } })

export const disableMfa = (code) =>
  apiFetch('/auth/mfa/disable', { method: 'POST', body: { code } })
