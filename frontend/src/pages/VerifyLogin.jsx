import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, MailCheck, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { portalHome } from '@/lib/roles'
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Where an emailed sign-in link lands (MSA-42).
 *
 * The password was checked before the link was sent, so opening it is the
 * second factor and nothing more is asked for here. The token is single use:
 * this page exchanges it for a session and sends the member to their portal.
 *
 * There is no form and no button to press, because there is nothing left to
 * decide — the decision was made in the mail client. What this page owes the
 * member is a clear answer when the exchange fails, since a spent or expired
 * link is the common case (a second click, a link opened tomorrow) and it must
 * not read as the account being broken.
 */
export default function VerifyLogin() {
  const [searchParams] = useSearchParams()
  const { completeLoginLink } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  /**
   * The token is single use, so the exchange must happen exactly once.
   *
   * React 19 runs effects twice in development StrictMode. Without this the
   * first call spends the token and the second is refused, so a working link
   * would show an error on every developer's machine.
   */
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    const token = searchParams.get('token')
    if (!token) {
      setError('This link is missing its token. Open the link from your email in full.')
      return
    }

    let alive = true
    completeLoginLink(token)
      .then((user) => {
        if (!alive) return
        // `replace`, so Back does not return to a URL holding a spent token.
        navigate(portalHome(user?.role), { replace: true })
      })
      .catch((err) => {
        if (!alive) return
        setError(err?.message || 'This sign-in link is no longer valid.')
      })

    return () => {
      alive = false
    }
  }, [completeLoginLink, navigate, searchParams])

  return (
    <AuthLayout
      title="Finishing your sign-in"
      description="Opening the link we emailed you confirms this sign-in came from you, not from somebody who only knows your password."
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          {error ? (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                <ShieldAlert className="size-6 text-destructive" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  This link cannot be used
                </h2>
                <p role="alert" className="text-xs leading-relaxed text-muted-foreground">
                  {error}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2">
                <Button asChild variant="teal" className="w-full">
                  <Link to="/login">Sign in again</Link>
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Signing in sends a fresh link. Each one can be used once, and they expire
                  quickly on purpose.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-teal/10">
                <MailCheck className="size-6 text-teal" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-semibold text-foreground">Signing you in</h2>
                <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Confirming your sign-in link…
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
