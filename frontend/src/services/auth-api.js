import { apiFetch, apiBaseUrl } from '@/lib/api-client'

// Auth endpoints exposed by the NestJS backend (see modules/auth).

// OAuth providers that map to backend /auth/<provider> redirect endpoints.
export const OAUTH_PROVIDERS = ['google']

/**
 * Full backend URL that begins an OAuth flow. This is a full-page browser
 * navigation (not fetch): the backend redirects to the provider and, on
 * success, back to the SPA /auth/callback with a token.
 */
export function oauthUrl(provider) {
  return `${apiBaseUrl()}/auth/${provider}`
}

/**
 * Exchange credentials for a token, with a second factor when the account has
 * one (MSA-42).
 *
 * `mfaCode` is omitted on the first attempt rather than sent empty: the client
 * cannot know whether this account is enrolled until it has tried, and the
 * server answers a missing factor with `mfaRequired` so the form knows to ask.
 * The same call is then repeated with the code.
 */
export function loginRequest(email, password, mfaCode) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: { email, password, ...(mfaCode ? { mfaCode } : {}) },
    auth: false,
  })
}

// --- Two-factor authentication (MSA-42) -------------------------------------
//
// Enrolment is two calls on purpose. `mfaSetupRequest` mints a secret and hands
// back the URI to scan; nothing is required of the account until
// `mfaConfirmRequest` proves a code against it. A setup that is begun and
// abandoned leaves sign-in exactly as it was.

export function mfaStatusRequest() {
  return apiFetch('/auth/mfa')
}

export function mfaSetupRequest() {
  return apiFetch('/auth/mfa/setup', { method: 'POST' })
}

export function mfaConfirmRequest(code) {
  return apiFetch('/auth/mfa/confirm', { method: 'POST', body: { code } })
}

// Requires a current code, not just a session: an unattended browser is the
// situation a second factor exists for, so removing it must not be the one
// thing that session can do unchallenged.
export function mfaDisableRequest(code) {
  return apiFetch('/auth/mfa/disable', { method: 'POST', body: { code } })
}

// --- The emailed second factor (MSA-42) -------------------------------------
//
// The factor a patient or a pharmacy can actually use: no app to install and no
// enrolment step, because the inbox is one the account already proved it owns.
// `loginRequest` answers with { mfaEmailSent: true } instead of a session, and
// the link the member opens is exchanged here for the real one.

export function verifyLoginLinkRequest(token) {
  return apiFetch('/auth/mfa/email/verify', {
    method: 'POST',
    body: { token },
    auth: false,
  })
}

export function emailFactorStatusRequest() {
  return apiFetch('/auth/mfa/email')
}

export function setEmailFactorRequest(enabled) {
  return apiFetch('/auth/mfa/email', { method: 'PATCH', body: { enabled } })
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
