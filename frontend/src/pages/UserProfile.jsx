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
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [flashMsg, flash] = useFlash()

  const [form, setForm] = useState({
    name: user?.name || 'ZoikoMeds User',
    email: user?.email || 'user@example.com',
    phone: user?.phone || '+91 90000 00000',
  })
  const [pwd, setPwd] = useState({ current: '', next: '' })

  const isDark = theme === 'dark'

  const saveProfile = (e) => {
    e.preventDefault()
    flash('Profile updated')
  }

  const savePassword = (e) => {
    e.preventDefault()
    setPwd({ current: '', next: '' })
    flash('Password updated')
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Contact details */}
        <div className="lg:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-4 text-primary" />
                Contact details
              </CardTitle>
              <CardDescription>Update how verified pharmacies and ZoikoMeds can reach you.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <form onSubmit={saveProfile} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
                  </div>
                </div>
                <Button type="submit" variant="teal" className="mt-1 w-fit">Save changes</Button>
              </form>
            </CardContent>
          </Card>
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
            <CardContent className="pt-0">
              <form onSubmit={savePassword} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="current">Current password</Label>
                  <Input id="current" type="password" placeholder="••••••••" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="next">New password</Label>
                  <Input id="next" type="password" placeholder="••••••••" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required />
                </div>
                <Button type="submit" variant="teal" className="mt-1 w-fit">Update password</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-1 py-4">
              <button
                onClick={toggleTheme}
                className="flex items-center justify-between rounded-lg px-2.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
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
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/5"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
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
      </div>
    </div>
  )
}
