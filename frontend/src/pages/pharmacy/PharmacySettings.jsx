import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Flash, useFlash } from '@/components/shared/flash'
import { useAuth } from '@/providers/auth-provider'
import { User, KeyRound, Bell, Terminal, Copy, RefreshCw, Eye, EyeOff } from 'lucide-react'

const NOTIF_PREFS = [
  { key: 'inventory', label: 'Inventory alerts', desc: 'When a medicine drops to out of stock.' },
  { key: 'verification', label: 'Verification updates', desc: 'Licence and verification status changes.' },
  { key: 'uploads', label: 'Upload results', desc: 'CSV import success or failures.' },
  { key: 'system', label: 'System messages', desc: 'Maintenance and platform announcements.' },
]

export default function PharmacySettings() {
  const { user } = useAuth()
  const [flashMsg, flash] = useFlash()
  const [prefs, setPrefs] = useState({ inventory: true, verification: true, uploads: true, system: false })
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false })
  const [apiKey] = useState('zk_live_9f2c…a71d')

  const isPasswordTooShort = Boolean(pwd.next && pwd.next.length < 8)
  const passwordsMismatch = Boolean(pwd.confirm && pwd.next !== pwd.confirm)
  const isPasswordFormInvalid = !pwd.current || !pwd.next || !pwd.confirm || pwd.next !== pwd.confirm || pwd.next.length < 8

  const toggle = (key) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
    flash('Notification preferences updated')
  }

  const changePassword = (e) => {
    e.preventDefault()
    if (!pwd.current || !pwd.next) { flash('Enter your current and new password'); return }
    if (pwd.next !== pwd.confirm) { flash('New passwords do not match'); return }
    if (pwd.next.length < 8) { flash('New password must be at least 8 characters'); return }
    // TODO(backend): POST /auth/change-password
    flash('Password updated')
    setPwd({ current: '', next: '', confirm: '' })
    setShowPwd({ current: false, next: false, confirm: false })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" subtitle="Account, security, notifications, and API access for your pharmacy." />
      {flashMsg && <Flash message={flashMsg} className="max-w-2xl" />}

      <div className="flex max-w-2xl flex-col gap-5">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="size-4 text-primary" /> Account</CardTitle>
            <CardDescription>Your sign-in identity for this pharmacy.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={user?.name || ''} readOnly />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input value={user?.email || ''} readOnly />
            </div>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-primary" /> Password</CardTitle>
            <CardDescription>Choose a strong, unique password.</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <form onSubmit={changePassword} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-cur">Current password</Label>
                <div className="relative flex items-center">
                  <Input
                    id="pw-cur"
                    type={showPwd.current ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={pwd.current}
                    onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((prev) => ({ ...prev, current: !prev.current }))}
                    className="absolute right-3 flex items-center text-muted-foreground hover:text-foreground outline-none cursor-pointer"
                    tabIndex={-1}
                    aria-label={showPwd.current ? 'Hide current password' : 'Show current password'}
                  >
                    {showPwd.current ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pw-new">New password</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="pw-new"
                      type={showPwd.next ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={pwd.next}
                      onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
                      className={`pr-10 ${isPasswordTooShort ? 'border-danger focus-visible:ring-danger/30' : ''}`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((prev) => ({ ...prev, next: !prev.next }))}
                      className="absolute right-3 flex items-center text-muted-foreground hover:text-foreground outline-none cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPwd.next ? 'Hide new password' : 'Show new password'}
                    >
                      {showPwd.next ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {isPasswordTooShort && (
                    <p className="text-xs font-medium text-danger">Password must be at least 8 characters long.</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pw-conf">Confirm new password</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="pw-conf"
                      type={showPwd.confirm ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={pwd.confirm}
                      onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
                      className={`pr-10 ${passwordsMismatch ? 'border-danger focus-visible:ring-danger/30' : ''}`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((prev) => ({ ...prev, confirm: !prev.confirm }))}
                      className="absolute right-3 flex items-center text-muted-foreground hover:text-foreground outline-none cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPwd.confirm ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showPwd.confirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {passwordsMismatch && (
                    <p className="text-xs font-medium text-danger">Passwords do not match.</p>
                  )}
                </div>
              </div>
              <Button type="submit" className="w-fit cursor-pointer" disabled={isPasswordFormInvalid}>Update password</Button>
            </form>
          </CardContent>
        </Card>

        {/* Notification preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="size-4 text-primary" /> Notification preferences</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-5">
            {NOTIF_PREFS.map((opt, i) => (
              <div key={opt.key} className={'flex items-center justify-between py-4 ' + (i < NOTIF_PREFS.length - 1 ? 'border-b border-border' : '')}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.desc}</span>
                </div>
                <Switch checked={prefs[opt.key]} onCheckedChange={() => toggle(opt.key)} aria-label={opt.label} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* API credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Terminal className="size-4 text-primary" /> API credentials</CardTitle>
            <CardDescription>Use this key to sync inventory from your POS / ERP.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 pt-5">
            <div className="flex items-center gap-2">
              <Input value={apiKey} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon-sm" aria-label="Copy API key" onClick={() => flash('API key copied')}>
                <Copy className="size-4" />
              </Button>
            </div>
            {/* TODO(backend): POST /pharmacy/me/api-keys/rotate */}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => flash('A new key would be issued (backend TODO)')}>
              <RefreshCw className="size-4" />
              Regenerate key
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
