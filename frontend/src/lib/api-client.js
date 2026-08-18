// Thin fetch wrapper for the ZoikoMeds API. Handles the base URL, JSON
// encoding, bearer-token auth, and normalizing Nest error responses.

// Resolve the API base URL. Vite inlines env at build time, so a missing
// VITE_API_BASE_URL in a production build defaults to the same-origin
// internal proxy route "/internal"; local dev also uses "/internal" proxied via Vite.
function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL
  if (configured) return configured
  return '/internal'
}

const BASE_URL = resolveApiBaseUrl()
const TOKEN_KEY = 'zoiko-token'

/** Absolute API base, e.g. for full-page redirects (OAuth). */
export function apiBaseUrl() {
  return BASE_URL
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore storage errors */
  }
}

// Registered by the auth provider — invoked when an authenticated request is
// rejected with 401 (expired / revoked token) so the app can log the user out.
let unauthorizedHandler = null
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

// Survives the logout and the redirect that follows it, so the login screen can
// say why the user is looking at it. Without this the session simply ends
// mid-action and the sign-in form appears with no explanation.
const SESSION_EXPIRED_KEY = 'zoiko-session-expired'

function markSessionExpired() {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, '1')
  } catch {
    /* ignore storage errors */
  }
}

/** True once, for the login screen: reading it clears the flag. */
export function consumeSessionExpired() {
  try {
    const expired = sessionStorage.getItem(SESSION_EXPIRED_KEY) === '1'
    if (expired) sessionStorage.removeItem(SESSION_EXPIRED_KEY)
    return expired
  } catch {
    return false
  }
}

export async function apiFetch(
  path,
  { method = 'GET', body, auth = true, headers = {} } = {}
) {
  const finalHeaders = { ...headers }
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'

  const token = auth ? getToken() : null
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(
      'Unable to reach the ZoikoMeds API. Please check your connection and try again.'
    )
  }

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    // An authenticated request rejected with 401 means the session is no
    // longer valid — trigger a logout. (Login/register use auth:false, so a
    // bad-credentials 401 there does not fire this.)
    //
    // Every authenticated route goes through here: a 401 from one of them is
    // always a dead session, never a rejected input. An endpoint that means
    // "these credentials are wrong" says so with 400, so nothing needs to opt
    // out of this — an opt-out only turns an expired session into a mystery.
    if (res.status === 401 && auth && token) {
      markSessionExpired()
      if (unauthorizedHandler) unauthorizedHandler()
      // Passport answers a rejected token with the bare word "Unauthorized",
      // which tells the person in front of the screen nothing at all.
      throw new Error('Your session has expired. Please sign in again.')
    }
    // Nest validation errors arrive as { message: string[] }.
    const raw = (data && data.message) || res.statusText || 'Request failed'
    throw new Error(Array.isArray(raw) ? raw.join(', ') : raw)
  }

  return data
}
