import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ArrowLeft, Loader2, ShieldCheck, MailCheck } from 'lucide-react'
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { forgotPasswordRequest } from '@/services/auth-api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await forgotPasswordRequest(email)
      setSent(true)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your ZoikoMeds password"
      description="Enter your account email and we'll send you a secure link to set a new password."
      pills={[{ icon: <ShieldCheck className="size-3.5 text-teal" />, label: 'Secure reset link' }]}
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col gap-6 p-6">
          {sent ? (
            <div className="flex flex-col gap-5 py-2">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-teal/10 text-teal shadow-inner">
                  <MailCheck className="size-7" />
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold text-foreground">Check your email</h2>
                  <p className="text-sm text-muted-foreground">
                    We've sent a secure password reset link.
                  </p>
                </div>
              </div>

              {/* Email Address Highlight */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-left text-xs">
                <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Email:</span>
                <span className="font-bold text-foreground break-all text-sm">{email}</span>
              </div>

              {/* Security & Validity Badges */}
              <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3.5 text-xs text-foreground">
                <div className="flex items-center gap-2 text-teal font-medium">
                  <span className="flex size-4 items-center justify-center rounded-full bg-teal/20 text-[10px] font-bold text-teal">✓</span>
                  <span>Link expires in 60 minutes</span>
                </div>
                <div className="flex items-center gap-2 text-teal font-medium">
                  <span className="flex size-4 items-center justify-center rounded-full bg-teal/20 text-[10px] font-bold text-teal">✓</span>
                  <span>One-time use only</span>
                </div>
              </div>

              {/* Troubleshooting Checklist */}
              <div className="flex flex-col gap-2.5 border-t border-border/60 pt-4 text-left">
                <span className="text-xs font-bold text-foreground">Didn't receive it?</span>
                <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
                  <li className="flex items-center justify-between">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleSubmit}
                      className="flex items-center gap-2 font-medium text-teal hover:underline disabled:opacity-50"
                    >
                      <span>• Resend Email</span>
                      {loading && <Loader2 className="size-3 animate-spin" />}
                    </button>
                  </li>
                  <li className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setSent(false)}
                      className="flex items-center gap-2 font-medium text-teal hover:underline"
                    >
                      <span>• Change Email Address</span>
                    </button>
                  </li>
                  <li className="flex items-center gap-2">
                    <span>• Check Spam or Junk Folder</span>
                  </li>
                </ul>
              </div>

              {/* Assistance & Back to Sign in */}
              <div className="flex flex-col gap-3 border-t border-border/60 pt-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <span>Need assistance?</span>
                  <a
                    href="mailto:support@zoikomeds.com"
                    className="font-semibold text-teal hover:underline"
                  >
                    Contact Support
                  </a>
                </div>

                <Button asChild variant="teal" className="mt-1 w-full font-semibold">
                  <Link to="/login">Back to Sign In</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-foreground">Forgot password</h2>
                <p className="text-xs text-muted-foreground">
                  We'll email you a link to reset it.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive leading-snug">
                    ⚠️ {error}
                  </div>
                )}
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
                <Button type="submit" variant="teal" disabled={loading} className="w-full font-semibold">
                  {loading ? (<><Loader2 className="size-4 animate-spin" />Sending link…</>) : 'Send reset link'}
                </Button>
              </form>

              <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-3.5" />
                Back to sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
