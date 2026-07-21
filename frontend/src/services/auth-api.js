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

export function loginRequest(email, password) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: { email, password },
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


