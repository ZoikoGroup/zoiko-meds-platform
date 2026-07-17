import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Flash, useFlash } from '@/components/shared/flash'
import { useAuth } from '@/providers/auth-provider'
import { User, KeyRound, Bell, Terminal, Copy, RefreshCw } from 'lucide-react'

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
  const [apiKey] = useState('zk_live_9f2c…a71d')

  const toggle = (key) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
    flash('Notification preferences updated')
  }

  const changePassword = (e) => {
    e.preventDefault()
    if (!pwd.current || !pwd.next) { flash('Enter your current and new password'); return }
    if (pwd.next !== pwd.confirm) { flash('New passwords do not match'); return }
    // TODO(backend): POST /auth/change-password
    flash('Password updated')
    setPwd({ current: '', next: '', confirm: '' })
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
          <CardContent className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
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
          <CardContent className="pt-2">
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-cur">Current password</Label>
                <Input id="pw-cur" type="password" value={pwd.current} onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pw-new">New password</Label>
                  <Input id="pw-new" type="password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pw-conf">Confirm password</Label>
                  <Input id="pw-conf" type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} />
                </div>
              </div>
              <Button type="submit" className="w-fit">Update password</Button>
            </form>
          </CardContent>
        </Card>

        {/* Notification preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="size-4 text-primary" /> Notification preferences</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
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
          <CardContent className="flex flex-col gap-3 pt-2">
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
