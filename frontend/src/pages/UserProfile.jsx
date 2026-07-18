import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Flash, useFlash } from '@/components/shared/flash'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'
import { User, Lock, LogOut, Palette, ShieldCheck, Sun, Moon } from 'lucide-react'

export default function UserProfile() {
  const { user, logout, updateProfile, changePassword } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [flashMsg, flash] = useFlash()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  })
  const [pwd, setPwd] = useState({ current: '', next: '' })

  const isDark = theme === 'dark'

  const saveProfile = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await updateProfile({ fullName: form.name, phone: form.phone })
      flash('Profile updated')
    } catch (err) {
      setError(err.message || 'Could not update profile')
    }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    setError('')
    if (pwd.next.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    try {
      await changePassword(pwd.current, pwd.next)
      setPwd({ current: '', next: '' })
      flash('Password updated')
    } catch (err) {
      setError(err.message || 'Could not update password')
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My profile"
        subtitle="Manage your contact details and account security."
      />

      {/* Identity card */}
      <Card className="p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar className="size-14 ring-2 ring-primary/10">
            <AvatarFallback className="text-lg">{user?.initials || 'ZM'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold text-foreground">{form.name}</span>
            <span className="text-sm text-muted-foreground">{form.email}</span>
          </div>
          <Badge variant="teal" className="gap-1.5 sm:ml-auto">
            <ShieldCheck className="size-3.5" />
            Verified account
          </Badge>
        </div>
      </Card>

      {flashMsg && <Flash message={flashMsg} />}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Contact details */}
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-4 text-primary" />
                Contact details
              </CardTitle>
              <CardDescription>Update how verified pharmacies and ZoikoMeds can reach you.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={saveProfile} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Optional" />
                  </div>
                </div>
                <Button type="submit" variant="teal" className="mt-1 w-fit cursor-pointer">Save changes</Button>
              </form>
            </CardContent>
          </Card>

          {/* Privacy note (governance: no PHI by default) */}
          <div className="flex items-start gap-3 rounded-2xl border border-teal/15 bg-teal/5 p-4">
            <ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-teal" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              ZoikoMeds does not collect prescriptions or health records. We store
              only the contact details you provide to power your alerts.
            </p>
          </div>
        </div>

        {/* Security + quick actions */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-primary" />
                Password
              </CardTitle>
              <CardDescription>Update your account password.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={savePassword} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="current">Current password</Label>
                  <Input id="current" type="password" placeholder="••••••••" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="next">New password</Label>
                  <Input id="next" type="password" placeholder="••••••••" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required />
                </div>
                <Button type="submit" variant="teal" className="mt-1 w-fit cursor-pointer">Update password</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <button
                onClick={toggleTheme}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Palette className="size-4 text-muted-foreground" />
                  Interface theme
                </span>
                <span className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
                  {isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                  {theme}
                </span>
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
