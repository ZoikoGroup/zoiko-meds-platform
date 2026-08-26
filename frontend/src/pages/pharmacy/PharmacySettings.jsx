import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Flash, useFlash } from '@/components/shared/flash'
import { CopyButton } from '@/components/shared/copy-button'
import { useAuth } from '@/providers/auth-provider'
import { getIntegration, issueIntegrationKey } from '@/services/pharmacy-api'
import { formatRelative } from '@/utils/format'
// KeySquare rather than Terminal for API credentials: the terminal glyph is a
// prompt caret and an underscore, which at 16px reads as stray punctuation
// beside the title rather than as an icon (MP-20).
import {
  User, KeyRound, KeySquare, Bell, RefreshCw, Eye, EyeOff, Loader2, TriangleAlert,
} from 'lucide-react'

const NOTIF_PREFS = [
  { key: 'inventory', label: 'Inventory alerts', desc: 'When a medicine drops to out of stock.' },
  { key: 'verification', label: 'Verification updates', desc: 'Licence and verification status changes.' },
  { key: 'uploads', label: 'Upload results', desc: 'CSV import success or failures.' },
  { key: 'system', label: 'System messages', desc: 'Maintenance and platform announcements.' },
]

export default function PharmacySettings() {
  const { user, changePassword: doChangePassword } = useAuth()
  const [flashMsg, flash] = useFlash()
  const [prefs, setPrefs] = useState({ inventory: true, verification: true, uploads: true, system: false })
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false })
  // The integration is where the push key lives; settings reads the same record
  // rather than inventing one. `null` until loaded, so the card can say
  // "loading" instead of "no key issued yet" — those are different facts.
  const [integration, setIntegration] = useState(null)
  const [keyError, setKeyError] = useState('')
  const [issuedKey, setIssuedKey] = useState('')
  const [issuing, setIssuing] = useState(false)

  // Issuing a key is PHARMACY_ADMIN-only on the API: it is a credential that
  // writes this pharmacy's inventory with no user session behind it. Saying so
  // here beats letting a pharmacist press the button and collect a 403.
  const canIssueKey = user?.role === 'PHARMACY_ADMIN'

  const loadIntegration = useCallback(async () => {
    try {
      setIntegration(await getIntegration())
      setKeyError('')
    } catch (err) {
      // A pharmacy with no profile yet has no integration to read. That is not
      // an error worth shouting about on a settings page.
      setIntegration({ connected: false, apiKeyPrefix: null, apiKeyIssuedAt: null })
      setKeyError(err?.message || '')
    }
  }, [])

  useEffect(() => {
    void loadIntegration()
  }, [loadIntegration])

  const regenerateKey = async () => {
    if (issuing) return
    if (
      integration?.apiKeyPrefix &&
      !window.confirm(
        'Generate a new key? The current key stops working immediately, and anything still using it will fail.',
      )
    ) return
    setIssuing(true)
    setKeyError('')
    try {
      const { apiKey, integration: refreshed } = await issueIntegrationKey()
      setIssuedKey(apiKey)
      setIntegration(refreshed)
      flash('New API key issued — copy it now, it is not shown again')
    } catch (err) {
      // The API refuses a key before there is a feed to use it with, and says
      // so; passing its message through is more use than a generic failure.
      setKeyError(err?.message || 'Could not issue a key')
    } finally {
      setIssuing(false)
    }
  }

  const isPasswordTooShort = Boolean(pwd.next && pwd.next.length < 8)
  const passwordsMismatch = Boolean(pwd.confirm && pwd.next !== pwd.confirm)
  const isPasswordFormInvalid = !pwd.current || !pwd.next || !pwd.confirm || pwd.next !== pwd.confirm || pwd.next.length < 8

  const toggle = (key) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
    flash('Notification preferences updated')
  }

  const [pwdError, setPwdError] = useState('')

  const changePassword = async (e) => {
    e.preventDefault()
    setPwdError('')
    if (!pwd.current || !pwd.next) { setPwdError('Enter your current and new password'); return }
    if (pwd.next !== pwd.confirm) { setPwdError('New passwords do not match'); return }
    if (pwd.next.length < 8) { setPwdError('New password must be at least 8 characters'); return }
    try {
      await doChangePassword(pwd.current, pwd.next)
      flash('Password updated successfully')
      setPwd({ current: '', next: '', confirm: '' })
      setShowPwd({ current: false, next: false, confirm: false })
    } catch (err) {
      setPwdError(err.message || 'Could not update password')
    }
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
              {pwdError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs font-semibold text-danger leading-snug">
                  ⚠️ {pwdError}
                </div>
              )}
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
            <CardTitle className="flex items-center gap-2"><KeySquare className="size-4 text-primary" /> API credentials</CardTitle>
            <CardDescription>Use this key to push inventory from your POS / ERP.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 pt-5">
            {/* What is stored, which is a prefix and a date — never the key.
                It used to sit in a readonly Input beside a copy button, which
                promised a value that could be copied back out. Only a hash is
                kept, so there has never been anything there to copy (MP-20). */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">Push key</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {integration === null
                    ? 'Loading…'
                    : integration.apiKeyPrefix
                      ? `${integration.apiKeyPrefix}… · issued ${formatRelative(integration.apiKeyIssuedAt) || 'recently'}`
                      : 'No key issued yet'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateKey}
                disabled={issuing || integration === null || !canIssueKey}
                title={canIssueKey ? undefined : 'Only a pharmacy manager can issue an API key.'}
              >
                {issuing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {integration?.apiKeyPrefix ? 'Regenerate key' : 'Generate key'}
              </Button>
            </div>

            {!canIssueKey && (
              <p className="text-xs text-muted-foreground">
                Only a pharmacy manager can issue or rotate this key.
              </p>
            )}

            {keyError && (
              <p role="alert" className="flex items-start gap-2 text-xs font-medium text-danger">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {keyError}
              </p>
            )}

            {/* The one moment the key exists in the open. The server keeps only
                a hash, so this cannot be offered again on a later visit. */}
            {issuedKey && (
              <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/5 p-4">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TriangleAlert className="size-4 text-warning" aria-hidden />
                  Copy this key now — it is not shown again
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {issuedKey}
                  </code>
                  <CopyButton value={issuedKey} label="Copy key" />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Only a hash is stored, so we cannot show it to you later. Lose it and you
                  generate a new one.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
