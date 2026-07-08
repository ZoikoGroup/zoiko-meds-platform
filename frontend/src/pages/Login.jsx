import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  // Form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Feedback states
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Handle Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Authentication failed. Please verify credentials.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-fill demo credentials
  const fillDemo = () => {
    setEmail('a.okafor@zoikomeds.io')
    setPassword('password123')
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
          
          {/* Segmented Control Headers (Sign In vs Create Account) */}
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-xs font-semibold shadow-xs text-foreground"
            >
              <LogIn className="size-3.5" />
              Sign In
            </button>
            <Link
              to="/register"
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
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
            <div className="flex items-center justify-between py-1 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  className="size-3.5 rounded border-input bg-card text-teal ring-offset-background focus:ring-ring focus:ring-2 focus:ring-offset-2"
                />
                Trust this device
              </label>
              <Link
                to="#"
                onClick={(e) => {
                  e.preventDefault()
                  alert('Forgot password flow is managed by your enterprise identity system.')
                }}
                className="font-medium text-teal hover:underline"
              >
                Forgot password?
              </Link>
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
              ) : (
                'Continue securely'
              )}
            </Button>
          </form>

          {/* Governance Notice */}
          <div className="flex gap-2 rounded-lg bg-teal/5 border border-teal/10 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <Shield className="size-4.5 shrink-0 text-teal mt-0.5" />
            <p>
              Data access is governed by organization, role, policy, and approved use case. Enterprise users may be redirected to their organization sign-in provider.
            </p>
          </div>

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-x-0 h-px bg-border/80" />
            <span className="relative bg-card px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Or continue with
            </span>
          </div>

          {/* SSO Options */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => alert('Passkey authentication initiated...')}
              className="flex items-center justify-center gap-1.5 font-medium text-xs py-2"
            >
              <Key className="size-3.5" />
              Use passkey
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => alert('Redirecting to SSO Gateway...')}
              className="flex items-center justify-center gap-1.5 font-medium text-xs py-2"
            >
              <Shield className="size-3.5" />
              Continue with SSO
            </Button>
          </div>

          {/* Help tip for testing */}
          <div className="mt-2 border-t border-border/60 pt-4 flex flex-col gap-2">
            <button
              onClick={fillDemo}
              type="button"
              className="group flex items-center justify-between rounded-lg bg-accent/70 px-3 py-2 text-[11px] text-left hover:bg-accent transition-colors outline-none"
            >
              <div className="flex gap-1.5 items-center">
                <HelpCircle className="size-3.5 text-primary" />
                <div>
                  <span className="font-semibold text-foreground">Need testing accounts?</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Click to auto-fill demo credentials</p>
                </div>
              </div>
              <span className="text-primary group-hover:translate-x-0.5 transition-transform text-xs font-semibold">&rarr;</span>
            </button>
          </div>

        </CardContent>
      </Card>
    </AuthLayout>
  )
}
