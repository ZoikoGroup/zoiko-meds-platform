import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LogIn,
  UserPlus,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Key,
  KeyRound,
  MailCheck,
  Shield,
  HelpCircle,
  Loader2,
  Terminal,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { consumeSessionExpired } from '@/lib/api-client'
import { portalHome } from '@/lib/roles'
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { OAuthButtons } from '@/components/shared/oauth-buttons'
import { cn } from '@/lib/utils'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [trustError, setTrustError] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  /**
   * The second factor (MSA-42).
   *
   * `mfaStage` is false until the server has said this account has one. It
   * cannot be known in advance — asking every account for a code would be
   * asking most of them for something they do not have, and asking none of them
   * is what left an enrolled account with no way in at all. So the first
   * attempt goes without, and a refusal carrying `mfaRequired` turns this on
   * and the same credentials are sent again with the code.
   */
  const [mfaStage, setMfaStage] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  // A workspace that requires a factor this account has not enrolled. There is
  // nothing to type: the account cannot sign in until an administrator helps,
  // so the code field is not offered.
  const [enrolmentRequired, setEnrolmentRequired] = useState(false)

  /**
   * The emailed second factor (MSA-42).
   *
   * Set when the password was accepted and a link has gone to the account's
   * inbox. The form is replaced rather than added to: there is nothing left to
   * type here, and the next step happens in a mail client. Holding the whole
   * payload rather than a flag so the masked address and the expiry can be
   * shown without either being restated in this file.
   */
  const [linkSent, setLinkSent] = useState(null)

  // Feedback states
  const [loading, setLoading] = useState(false)
  // Read once on mount, and only in the initializer: consuming the flag clears
  // it, so re-running this on every render would swallow the reason.
  const [error, setError] = useState(() => {
    if (searchParams.get('error') === 'oauth') {
      return 'Social sign-in could not be completed. Please try again or use your email and password.'
    }
    // Arrived here mid-action because the token expired, rather than by
    // signing out — say so, or the redirect looks like the app losing work.
    if (consumeSessionExpired()) {
      return 'Your session expired, so you were signed out. Please sign in again to continue.'
    }
    return ''
  })

  // Editing the address or the password starts a different sign-in, so the code
  // collected for the last one must not be carried into it.
  const restartSignIn = () => {
    if (!mfaStage && !enrolmentRequired) return
    setMfaStage(false)
    setMfaCode('')
    setEnrolmentRequired(false)
  }

  // Back to the form, to try a different account or send a fresh link. The old
  // link stays valid until it expires; nothing here can revoke it, and saying
  // otherwise would be a promise this page cannot keep.
  const startOver = () => {
    setLinkSent(null)
    setError('')
    setPassword('')
  }

  // Handle Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!trustDevice) {
      setTrustError(true)
      return
    }
    setTrustError(false)
    setLoading(true)

    try {
      const authedUser = await login(email, password, mfaStage ? mfaCode : undefined)
      // Not a session: this account uses the emailed factor, and the sign-in
      // finishes when the link is opened. No navigation, because nothing has
      // been signed in to yet.
      if (authedUser?.mfaEmailSent) {
        setLinkSent(authedUser)
        return
      }
      // Route to the correct portal based on the resolved role
      // (Super Admin → /admin, Pharmacy → /pharmacy, Patient → /dashboard).
      navigate(portalHome(authedUser?.role))
    } catch (err) {
      // The reason, not just the sentence. A sign-in refused for want of a
      // second factor is not a wrong password, and the form cannot know to ask
      // for a code unless it reads why it was turned away.
      const body = err?.body
      if (body?.mfaEnrolmentRequired) {
        setEnrolmentRequired(true)
        setMfaStage(false)
      } else if (body?.mfaRequired) {
        setMfaStage(true)
        // Only a wrong code should clear the field. Arriving at this step for
        // the first time has nothing to clear, and clearing it would look like
        // the app had dropped what was typed.
        if (mfaStage) setMfaCode('')
      }
      setError(err.message || 'Authentication failed. Please verify credentials.')
    } finally {
      setLoading(false)
    }
  }

  // Left Showcase content configuration
  const showcaseTitle = 'Sign in to your ZoikoMeds portal'
  const showcaseDesc =
    'Access secure medicine availability tools, pharmacy partner workflows, wholesale access, enterprise intelligence, reports, and administrative workflows through one role-aware gateway.'

  const showcasePills = [
    { icon: <Lock className="size-3.5 text-teal" />, label: 'Role-based access' },
    { icon: <Shield className="size-3.5 text-teal" />, label: 'SSO ready' },
    { icon: <Terminal className="size-3.5 text-teal" />, label: 'Privacy-aware workflows' },
    { icon: <span className="text-red-500 font-bold">×</span>, label: 'No dispensing or advice' },
  ]

  return (
    <AuthLayout
      title={showcaseTitle}
      description={showcaseDesc}
      pills={showcasePills}
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col gap-6 p-6">

          {/* The emailed second factor (MSA-42). The password was right and a
              link is in the account's inbox; there is nothing left to type
              here, so the form is replaced rather than added to. */}
          {linkSent ? (
            <div className="flex flex-col gap-5 py-2 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-teal/10">
                <MailCheck className="size-6 text-teal" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-semibold text-foreground">Check your email</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your password was accepted. We sent a sign-in link to{' '}
                  <strong className="font-semibold text-foreground">{linkSent.email}</strong>.
                  Open it to finish signing in.
                </p>
              </div>
              <div className="flex gap-2 rounded-lg border border-border/70 bg-muted/40 p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
                <Shield className="mt-0.5 size-4 shrink-0 text-teal" />
                <p>
                  The link can be used once and expires in{' '}
                  {linkSent.expiresInMinutes ?? 10} minutes. If you did not try to sign in,
                  do not open it — somebody else knows your password, and you should change it.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={startOver} className="w-full">
                  Use a different account
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  No email after a minute or two? Check your spam folder, then sign in again to
                  send a new link.
                </p>
              </div>
            </div>
          ) : (
          <>

          {/* Segmented Control Headers (Sign In vs Create Account) - dark mode contrast enhanced */}
          <div className="grid grid-cols-2 rounded-xl bg-muted/80 dark:bg-slate-900/60 p-1 border border-border/40 dark:border-slate-800/80">
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-card dark:bg-slate-800 px-3 py-2 text-xs font-semibold shadow-xs text-foreground dark:text-slate-50 border border-transparent dark:border-slate-700/50 transition-all"
            >
              <LogIn className="size-3.5 text-primary dark:text-teal" />
              Sign In
            </button>
            <Link
              to="/register"
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
            >
              <UserPlus className="size-3.5" />
              Create Account
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive leading-snug">
                ⚠️ {error}
              </div>
            )}

            {/* Email Field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                Email address <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Mail className="size-4" />
                </span>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@organization.org"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    restartSignIn()
                  }}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Lock className="size-4" />
                </span>
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    restartSignIn()
                  }}
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground outline-none"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Second factor (MSA-42) — offered only once the server has said
                this account has one, because until then there is nothing to
                ask for and most accounts would be asked in vain. */}
            {mfaStage && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfaCode" className="text-xs font-semibold text-foreground">
                  Authentication code <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <KeyRound className="size-4" />
                  </span>
                  <Input
                    id="mfaCode"
                    // Not type="number": it strips leading zeros, and a code
                    // beginning 0 is one in ten.
                    type="text"
                    required
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="123 456"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="pl-10 tracking-[0.3em] font-mono"
                  />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Open your authenticator app and enter the 6-digit code it shows for ZoikoMeds.
                </p>
              </div>
            )}

            {/* The workspace requires a factor this account has not set up.
                There is nothing to type, so no field is offered — signing in
                needs an administrator, not another attempt. */}
            {enrolmentRequired && (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-foreground">
                <Shield className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
                <p>
                  This workspace requires two-factor authentication and this account has not set
                  it up yet. Ask a workspace administrator to enrol you, then sign in again.
                </p>
              </div>
            )}

            {/* Keep Signed In & Forgot Password */}
            <div className="flex flex-col gap-1 py-1">
              <div className="flex items-center justify-between text-xs">
                <label className={cn(
                  "flex items-center gap-2 cursor-pointer transition-colors select-none",
                  trustError ? "text-danger font-semibold" : "text-muted-foreground"
                )}>
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => {
                      setTrustDevice(e.target.checked)
                      if (e.target.checked) setTrustError(false)
                    }}
                    className={cn(
                      "size-3.5 rounded border-input bg-card text-teal ring-offset-background focus:ring-ring focus:ring-2 focus:ring-offset-2",
                      trustError && "border-danger ring-2 ring-danger/30"
                    )}
                  />
                  Trust this device
                </label>
                <Link
                  to="/forgot-password"
                  className="font-medium text-teal hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Single line red warning under Trust this device */}
              {trustError && (
                <p className="text-xs font-semibold text-danger flex items-center gap-1 mt-0.5">
                  ⚠️ Please check &ldquo;Trust this device&rdquo; to continue.
                </p>
              )}
            </div>

            {/* Continue Button */}
            <Button
              type="submit"
              variant="teal"
              disabled={loading}
              className="mt-2 w-full font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Verifying account...
                </>
              ) : mfaStage ? (
                'Verify code'
              ) : (
                'Continue securely'
              )}
            </Button>

            {/* Explanatory text below Continue securely */}
            <p className="text-[11px] text-center text-muted-foreground leading-snug">
              <span className="text-red-500 font-bold">*</span> You must check <strong className="text-foreground font-semibold">&ldquo;Trust this device&rdquo;</strong> to verify and authorize this login session.
            </p>
          </form>

          {/* Social sign-in (Google) */}
          <OAuthButtons />

          </>
          )}

          {/* Governance Notice */}
          <div className="flex gap-2 rounded-lg bg-teal/5 border border-teal/10 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <Shield className="size-4.5 shrink-0 text-teal mt-0.5" />
            <p>
              Data access is governed by organization, role, policy, and approved use case. Enterprise users may be redirected to their organization sign-in provider.
            </p>
          </div>

        </CardContent>
      </Card>
    </AuthLayout>
  )
}
