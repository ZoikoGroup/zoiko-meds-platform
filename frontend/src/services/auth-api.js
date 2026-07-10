import { apiFetch } from '@/lib/api-client'

// Auth endpoints exposed by the NestJS backend (see modules/auth).

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
