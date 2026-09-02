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

/**
 * Fetch a binary response (a document, an export) as a Blob.
 *
 * Separate from apiFetch, which parses every response as text. A protected file
 * cannot be reached with a plain <a href>: the link carries no Authorization
 * header, so the request arrives unauthenticated and the browser shows the 401
 * instead of the file.
 */
export async function apiFetchBlob(path, { headers = {} } = {}) {
  const finalHeaders = { ...headers }
  const token = getToken()
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: finalHeaders })
  } catch {
    throw new Error('Unable to reach the ZoikoMeds API. Please check your connection and try again.')
  }

  if (!res.ok) {
    // Error bodies are JSON even here, so the reason can still be shown.
    let message = res.statusText || 'Request failed'
    try {
      const body = await res.json()
      if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message
    } catch {
      /* keep the status text */
    }
    throw new Error(message)
  }

  return res.blob()
}

export async function apiFetch(
  path,
  {
    method = 'GET',
    body,
    auth = true,
    headers = {},
    // Optional AbortSignal. Requests have no deadline of their own — a caller
    // that needs one (prescription assisted reading, which waits on a model)
    // supplies it rather than every request in the app inheriting a timeout.
    signal,
  } = {}
) {
  // FormData carries its own multipart boundary, which only the browser can
  // generate: setting Content-Type by hand here produces a header with no
  // boundary and the server rejects the body as malformed.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const finalHeaders = { ...headers }
  if (body !== undefined && !isFormData) finalHeaders['Content-Type'] = 'application/json'

  const token = auth ? getToken() : null
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // An aborted request is the caller's own deadline firing, not an unreachable
    // API — it has a better message for the user than "check your connection".
    if (err?.name === 'AbortError') throw err
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
    const error = new Error(Array.isArray(raw) ? raw.join(', ') : raw)
    // The envelope, kept alongside the message. Some failures carry a fact the
    // caller has to act on rather than only display: a sign-in refused for want
    // of a second factor is not a wrong password, and the login form cannot
    // know to ask for a code unless it can read why it was refused (MSA-42).
    error.status = res.status
    error.body = data
    throw error
  }

  return data
}
