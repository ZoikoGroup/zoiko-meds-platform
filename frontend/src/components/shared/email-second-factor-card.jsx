import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, MailCheck } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useFlash } from '@/components/shared/flash'
import { emailFactorStatusRequest, setEmailFactorRequest } from '@/services/auth-api'

/**
 * Turning the emailed sign-in link on, for accounts that can (MSA-42).
 *
 * The platform's other second factor is an authenticator app, and it was only
 * ever reachable by a super admin: enrolment needs a session, and the screen
 * that offers it is on the admin settings page. Requiring it of everybody
 * therefore refused a sign-in to every patient and every pharmacy, with nowhere
 * for any of them to enrol.
 *
 * This is the one they can use, and it is theirs to choose. Nothing enforces
 * it, nothing turns it on for them, and it can be switched off again from the
 * same row — a factor an account cannot undo for itself is a lockout waiting
 * for a lost phone or a closed mailbox.
 *
 * The card renders nothing at all where the factor does not apply, rather than
 * showing a disabled switch: an administrator reading this would be told about
 * a control that is not theirs, and their own is a better one.
 */
export function EmailSecondFactorCard() {
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [flashMsg, flash] = useFlash()

  const load = useCallback(async () => {
    setStatus(await emailFactorStatusRequest())
  }, [])

  useEffect(() => {
    let alive = true
    load().catch((err) => {
      // Reported, not swallowed. A card that quietly vanished when the read
      // failed would tell an account that had this on that it did not.
      if (alive) setError(err?.message || 'Could not load your sign-in settings.')
    })
    return () => {
      alive = false
    }
  }, [load])

  const save = async (next) => {
    setSaving(true)
    setError('')
    try {
      const result = await setEmailFactorRequest(next)
      setStatus((prev) => ({ ...prev, enabled: result.mfaEmailEnabled }))
      flash(
        result.mfaEmailEnabled
          ? 'Email sign-in confirmation is on.'
          : 'Email sign-in confirmation is off.',
      )
    } catch (err) {
      setError(err?.message || 'Could not save that change.')
      // Re-read, so a refused save does not leave the switch showing a state
      // the server never accepted.
      try {
        await load()
      } catch {
        /* keep the message above */
      }
    } finally {
      setSaving(false)
    }
  }

  // Nothing to say until the answer is in, and nothing to offer where the
  // factor does not apply to this account.
  if (!status && !error) return null
  if (status && !status.available) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailCheck className="size-4 text-primary" />
          Sign-in security
        </CardTitle>
        <CardDescription>
          An extra step at sign-in, so a stolen password is not enough on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 pb-3 text-xs font-medium text-danger"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {flashMsg && <p className="pb-3 text-xs font-medium text-success">{flashMsg}</p>}

        {status && (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Confirm each sign-in by email</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {status.enabled
                  ? `After your password, we email a one-time link to ${status.email}. Opening it finishes the sign-in.`
                  : 'After your password, we will email a one-time link. You finish signing in by opening it, so knowing your password alone is not enough.'}
              </p>
              {status.enabled && (
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Keep access to that inbox. Without it you will not be able to sign in — you can
                  turn this off again here at any time.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {saving && (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
              )}
              <Switch
                checked={Boolean(status.enabled)}
                disabled={saving}
                aria-label="Confirm each sign-in by email"
                onCheckedChange={save}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
