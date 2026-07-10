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
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-teal/10 text-teal">
                <MailCheck className="size-6" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{email}</strong>, we've sent a password
                reset link. The link expires in 1 hour.
              </p>
              <Button asChild variant="teal" className="mt-2 w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
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
