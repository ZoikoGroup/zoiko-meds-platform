import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Lock, Eye, EyeOff, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { resetPasswordRequest } from '@/services/auth-api'
import { useAuth } from '@/providers/auth-provider'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()
  const { logout } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await resetPasswordRequest(token, password)
      // Drop any session held in this browser — the password it was minted
      // against is gone, and a stale token would bounce us off /login.
      logout()
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2200)
    } catch (err) {
      setError(err.message || 'This link is invalid or has expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Choose a strong password for your ZoikoMeds account."
      pills={[{ icon: <ShieldCheck className="size-3.5 text-teal" />, label: 'Encrypted at rest' }]}
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col gap-6 p-6">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-teal/10 text-teal">
                <CheckCircle2 className="size-6" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Password updated</h2>
              <p className="text-sm text-muted-foreground">
                Your password has been set. Redirecting you to sign in…
              </p>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <h2 className="text-lg font-bold text-foreground">Invalid link</h2>
              <p className="text-sm text-muted-foreground">
                This reset link is missing its token. Please request a new one.
              </p>
              <Button asChild variant="teal" className="mt-2 w-full">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive leading-snug">
                  ⚠️ {error}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  New password <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <Lock className="size-4" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="At least 8 characters"
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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm" className="text-xs font-semibold text-foreground">
                  Confirm password <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <Lock className="size-4" />
                  </span>
                  <Input
                    id="confirm"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Re-enter your new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <Button type="submit" variant="teal" disabled={loading} className="w-full font-semibold">
                {loading ? (<><Loader2 className="size-4 animate-spin" />Updating…</>) : 'Set password'}
              </Button>

              <Link to="/login" className="text-center text-xs font-medium text-muted-foreground hover:text-foreground">
                Back to sign in
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
