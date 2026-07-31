// Thin fetch wrapper for the ZoikoMeds API. Handles the base URL, JSON
// encoding, bearer-token auth, and normalizing Nest error responses.

// Resolve the API base URL. Vite inlines env at build time, so a missing
// VITE_API_BASE_URL in a production build must NOT silently ship a localhost
// URL to users. In production we warn loudly and fall back to same-origin
// "/api" (correct when the SPA is served from the same domain as the API);
// only local dev defaults to the dev server.
function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL
  if (configured) return configured
  if (import.meta.env.PROD) {
    // eslint-disable-next-line no-console
    console.error(
      '[ZoikoMeds] VITE_API_BASE_URL was not set at build time. Falling back to same-origin "/api". Set VITE_API_BASE_URL to your API URL when building for production.'
    )
    return '/api'
  }
  return 'http://localhost:8000/api'
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

export async function apiFetch(
  path,
  { method = 'GET', body, auth = true, headers = {}, skipUnauthorizedHandler = false } = {}
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
    if (res.status === 401 && auth && token && unauthorizedHandler && !skipUnauthorizedHandler) {
      unauthorizedHandler()
    }
    // Nest validation errors arrive as { message: string[] }.
    const raw = (data && data.message) || res.statusText || 'Request failed'
    throw new Error(Array.isArray(raw) ? raw.join(', ') : raw)
  }

  return data
}
