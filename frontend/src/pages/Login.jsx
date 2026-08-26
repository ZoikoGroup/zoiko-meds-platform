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
  // Shown only once the API has said this account has a second factor. The
  // client cannot know before it has tried, so the first attempt is made
  // without one and the same call is repeated with the code (MSA-42).
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [trustError, setTrustError] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
      const authedUser = await login(email, password, mfaCode)
      // Route to the correct portal based on the resolved role
      // (Super Admin → /admin, Pharmacy → /pharmacy, Patient → /dashboard).
      navigate(portalHome(authedUser?.role))
    } catch (err) {
      // The envelope carries why, not just that: a sign-in refused for want of a
      // second factor is not a wrong password, and reporting it as one would
      // send someone to reset a password that was correct.
      if (err?.body?.mfaRequired) {
        setMfaRequired(true)
        // Cleared so a rejected code is not resubmitted unchanged; the password
        // stays, because retyping it to correct a 6-digit typo is punishment.
        setMfaCode('')
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
    { icon: <Shield className="size-3.5 text-teal" />, label: 'MFA & SSO ready' },
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
                  onChange={(e) => setEmail(e.target.value)}
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
                  onChange={(e) => setPassword(e.target.value)}
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

            {/* Second factor — only once the API has asked for one. */}
            {mfaRequired && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-code" className="text-xs font-semibold text-foreground">
                  Authenticator code
                </Label>
                <Input
                  id="mfa-code"
                  name="mfaCode"
                  // inputMode over type=number: a numeric keypad on a phone,
                  // without the spinner and scroll-to-change of a number input.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={7}
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="font-mono tracking-widest"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Open your authenticator app and enter the 6-digit code for ZoikoMeds.
                </p>
              </div>
            )}

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
              ) : (
                'Continue securely'
              )}
            </Button>

            {/* Explanatory text below Continue securely */}
            <p className="text-[11px] text-center text-muted-foreground leading-snug">
              <span className="text-red-500 font-bold">*</span> You must check <strong className="text-foreground font-semibold">&ldquo;Trust this device&rdquo;</strong> to verify and authorize this login session.
            </p>
          </form>

          {/* Social sign-in (Google, Microsoft) */}
          <OAuthButtons />

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
