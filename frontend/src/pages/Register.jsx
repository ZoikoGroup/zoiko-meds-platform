import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  LogIn,
  UserPlus,
  User,
  Mail,
  Phone,
  Lock,
  Bookmark,
  Bell,
  Eye,
  EyeOff,
  Shield,
  Check,
  Loader2,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { AuthLayout } from '@/layouts/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { OAuthButtons } from '@/components/shared/oauth-buttons'
import { PhoneInput } from '@/components/ui/phone-input'
import { isValidPhoneNumber } from 'react-phone-number-input'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  // Form states
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Feedback states
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Calculate password strength
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, text: '—', color: 'bg-border' }
    let score = 0
    if (password.length >= 8) score += 1
    if (/[a-zA-Z]/.test(password)) score += 1
    if (/[0-9]/.test(password)) score += 1
    if (/[^a-zA-Z0-9]/.test(password)) score += 1

    let text = 'Weak'
    let color = 'bg-danger'
    if (score === 2) {
      text = 'Fair'
      color = 'bg-warning'
    } else if (score === 3) {
      text = 'Good'
      color = 'bg-teal'
    } else if (score === 4) {
      text = 'Strong'
      color = 'bg-success'
    }

    return { score, text, color }
  }, [password])

  // Calculate international phone number validity
  const phoneError = useMemo(() => {
    if (!phone || !phone.trim() || phone.trim() === '+' || /^\+[0-9]{1,4}$/.test(phone.trim())) {
      return ''
    }
    return isValidPhoneNumber(phone.trim()) ? '' : 'Please enter a valid phone number.'
  }, [phone])

  // Handle Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (phoneError) {
      setError(phoneError)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    const formattedPhone =
      !phone || !phone.trim() || /^\+[0-9]{1,4}$/.test(phone.trim())
        ? undefined
        : phone.trim()

    setLoading(true)
    try {
      await register({ name, email, phone: formattedPhone, password })
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Left Showcase content configuration
  const showcaseTitle = 'Create your free ZoikoMeds account'
  const showcaseDesc =
    'Save medicine searches, manage availability alerts, and review your access activity — all in one secure, privacy-aware account.'

  const showcaseListItems = [
    {
      icon: <Bookmark className="size-4" />,
      title: 'Save searches',
      description: 'Keep the medicines and locations you follow close at hand.',
    },
    {
      icon: <Bell className="size-4" />,
      title: 'Availability alerts',
      description: 'Get notified when confidence signals change.',
    },
    {
      icon: <Lock className="size-4" />,
      title: 'Private by design',
      description: 'You control your data and can leave any time.',
    },
  ]

  const showcasePills = [
    { icon: <Shield className="size-3.5 text-teal" />, label: 'Privacy-aware' },
    { icon: <span className="text-red-500 font-bold">×</span>, label: 'No dispensing or advice' },
    { icon: <Check className="size-3.5 text-green-500" />, label: 'Free to use' },
  ]

  return (
    <AuthLayout
      title={showcaseTitle}
      description={showcaseDesc}
      listItems={showcaseListItems}
      pills={showcasePills}
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col gap-6 p-6">
          
          {/* Segmented Control Headers (Sign In vs Create Account) */}
          <div className="grid grid-cols-2 rounded-xl bg-muted/80 dark:bg-slate-900/60 p-1 border border-border/40 dark:border-slate-800/80">
            <Link
              to="/login"
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
            >
              <LogIn className="size-3.5" />
              Sign In
            </Link>
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-card dark:bg-slate-800 px-3 py-2 text-xs font-semibold shadow-xs text-foreground dark:text-slate-50 border border-transparent dark:border-slate-700/50 transition-all"
            >
              <UserPlus className="size-3.5 text-primary dark:text-teal" />
              Create Account
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive leading-snug">
                ⚠️ {error}
              </div>
            )}

            {/* Name Field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="text-xs font-semibold text-foreground">
                Full name <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <User className="size-4" />
                </span>
                <Input
                  id="name"
                  type="text"
                  required
                  placeholder="Your legal or professional name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Email Field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                Email <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Mail className="size-4" />
                </span>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Phone Number Field */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="phone" className="text-xs font-semibold text-foreground">
                  Phone number
                </Label>
                <span className="text-[10px] text-muted-foreground">optional</span>
              </div>
              <PhoneInput
                id="phone"
                value={phone}
                onChange={setPhone}
                error={Boolean(phoneError)}
              />
              {phoneError ? (
                <span className="text-[11px] font-medium text-red-500 leading-snug">
                  Please enter a valid phone number.
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground leading-snug">
                  ℹ️ Used only for optional SMS availability alerts.
                </span>
              )}
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
                  placeholder="Create a password"
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

              {/* Password Strength Indicator */}
              <div className="mt-1 flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                  <span>Password strength:</span>
                  <span className="font-semibold text-foreground">{passwordStrength.text}</span>
                </div>
                {/* 4 strength bars */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 4].map((bar) => (
                    <div
                      key={bar}
                      className={`h-1.5 rounded-full transition-colors duration-300 ${
                        passwordStrength.score >= bar
                          ? passwordStrength.color
                          : 'bg-muted-foreground/20'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                  Use at least 8 characters with a mix of letters, numbers, and symbols.
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="teal"
              disabled={loading || Boolean(phoneError)}
              className="mt-3 w-full font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          {/* Social sign-in (Google, Microsoft) */}
          <OAuthButtons label="Or sign up with" />

          {/* Privacy Disclaimer */}
          <div className="text-center text-[10px] text-muted-foreground leading-relaxed">
            By creating an account, you agree to our{' '}
            <a
              href="https://zoikomeds.com/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal hover:underline font-medium"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="https://zoikomeds.com/privacy-center"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal hover:underline font-medium"
            >
              Privacy Policy
            </a>.
          </div>

        </CardContent>
      </Card>
    </AuthLayout>
  )
}
