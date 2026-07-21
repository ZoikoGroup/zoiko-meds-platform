import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { portalHome } from '@/lib/roles'

/**
 * Landing route for the OAuth browser flow. The backend redirects here with
 * `?token=<jwt>` on success (or `?error=` on failure). We adopt the token,
 * hydrate the session, and forward the user to their portal.
 */
export default function AuthCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithToken } = useAuth()
  const [error, setError] = useState('')
  // React 18 StrictMode double-invokes effects in dev; guard so we only run once.
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const token = params.get('token')
    const errParam = params.get('error')

    if (errParam || !token) {
      setError(
        'We could not complete sign-in with your provider. Please try again.'
      )
      const t = setTimeout(() => navigate('/login', { replace: true }), 2500)
      return () => clearTimeout(t)
    }

    loginWithToken(token)
      .then((user) => navigate(portalHome(user?.role), { replace: true }))
      .catch(() => {
        setError('Your sign-in session could not be verified. Please try again.')
        setTimeout(() => navigate('/login', { replace: true }), 2500)
      })
  }, [params, loginWithToken, navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      {error ? (
        <>
          <ShieldAlert className="size-8 text-destructive" />
          <p className="text-sm font-medium text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground">Redirecting to sign in…</p>
        </>
      ) : (
        <>
          <Loader2 className="size-8 animate-spin text-teal" />
          <p className="text-sm font-medium text-foreground">
            Completing sign-in…
          </p>
          <p className="text-xs text-muted-foreground">
            Verifying your account and preparing your portal.
          </p>
        </>
      )}
    </div>
  )
}
