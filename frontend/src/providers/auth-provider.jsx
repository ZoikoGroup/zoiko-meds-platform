import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getToken, setToken, setUnauthorizedHandler } from '@/lib/api-client'
import {
  loginRequest,
  registerRequest,
  meRequest,
  updateProfileRequest,
  changePasswordRequest,
  verifyLoginLinkRequest,
} from '@/services/auth-api'
import {
  roleLabel,
  isSuperAdmin as roleIsSuperAdmin,
  isPharmacy as roleIsPharmacy,
  portalHome,
} from '@/lib/roles'

const AuthContext = createContext(null)

function getInitials(name) {
  if (!name) return 'U'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

/** Map the backend user record onto the shape the UI expects. */
function toClientUser(apiUser) {
  if (!apiUser) return null
  return {
    id: apiUser.id,
    name: apiUser.fullName,
    email: apiUser.email,
    phone: apiUser.phone || '',
    role: apiUser.role, // raw enum, e.g. 'SUPER_ADMIN' / 'PUBLIC'
    roleLabel: roleLabel(apiUser.role),
    isSuperAdmin: roleIsSuperAdmin(apiUser.role),
    isPharmacy: roleIsPharmacy(apiUser.role),
    initials: getInitials(apiUser.fullName),
    isActive: apiUser.isActive,
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // While validating a stored token against /auth/me, routes must not redirect.
  const [bootstrapping, setBootstrapping] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!getToken()) {
        setBootstrapping(false)
        return
      }
      try {
        const apiUser = await meRequest()
        if (!cancelled) setUser(toClientUser(apiUser))
      } catch {
        setToken(null)
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Sign in, which does not always end in a session (MSA-42).
   *
   * `mfaCode` is passed on the retry the form makes after the server answers
   * `mfaRequired` — it is never known on the first attempt.
   *
   * An account using the emailed factor gets `{ mfaEmailSent: true }` and no
   * token: the password was right, and the sign-in finishes when the link is
   * opened. Returned as-is rather than thrown, and no token is stored, so a
   * half-finished sign-in cannot leave the app looking signed in.
   */
  const login = useCallback(async (email, password, mfaCode) => {
    const result = await loginRequest(email, password, mfaCode)
    if (result?.mfaEmailSent) return result

    const { accessToken, user: apiUser } = result
    setToken(accessToken)
    const clientUser = toClientUser(apiUser)
    setUser(clientUser)
    return clientUser
  }, [])

  // Finish a sign-in from an emailed link. The token in the URL is single use
  // and is exchanged for the session here.
  const completeLoginLink = useCallback(async (token) => {
    const { accessToken, user: apiUser } = await verifyLoginLinkRequest(token)
    setToken(accessToken)
    const clientUser = toClientUser(apiUser)
    setUser(clientUser)
    return clientUser
  }, [])

  const register = useCallback(async (formData) => {
    const { name, fullName, email, phone, password } = formData
    const { accessToken, user: apiUser } = await registerRequest({
      email,
      fullName: fullName || name,
      password,
      phone,
    })
    setToken(accessToken)
    const clientUser = toClientUser(apiUser)
    setUser(clientUser)
    return clientUser
  }, [])

  // Adopt a token minted by an OAuth callback: store it, then hydrate the user
  // from /auth/me. Returns the client user, or throws if the token is invalid.
  const loginWithToken = useCallback(async (token) => {
    setToken(token)
    try {
      const apiUser = await meRequest()
      const clientUser = toClientUser(apiUser)
      setUser(clientUser)
      return clientUser
    } catch (err) {
      setToken(null)
      setUser(null)
      throw err
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  // Auto-logout when an authenticated request returns 401 (expired token).
  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const updateProfile = useCallback(async ({ fullName, phone }) => {
    const apiUser = await updateProfileRequest({ fullName, phone })
    const clientUser = toClientUser(apiUser)
    setUser(clientUser)
    return clientUser
  }, [])

  const changePassword = useCallback(
    (currentPassword, newPassword) =>
      changePasswordRequest(currentPassword, newPassword),
    []
  )

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isSuperAdmin: !!user?.isSuperAdmin,
      isPharmacy: !!user?.isPharmacy,
      // Landing path for this user's portal (used by guards + post-login).
      homePath: portalHome(user?.role),
      bootstrapping,
      login,
      loginWithToken,
      completeLoginLink,
      register,
      logout,
      updateProfile,
      changePassword,
    }),
    [
      user,
      bootstrapping,
      login,
      loginWithToken,
      completeLoginLink,
      register,
      logout,
      updateProfile,
      changePassword,
    ]
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

/**
 * The session when there is one, or null outside a provider.
 *
 * For components that are better off with the signed-in user but must not
 * require one. useAuth throws, which is right where the session is the point of
 * the component and wrong where it only sharpens something — the Help Center
 * prefills a support email with who is reporting, and should still open for
 * anyone rendering the sidebar without an AuthProvider.
 */
export function useOptionalAuth() {
  return useContext(AuthContext)
}
