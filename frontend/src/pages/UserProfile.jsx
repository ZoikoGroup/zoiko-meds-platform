import { useState, useEffect, useMemo } from 'react'
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
import { useLanguage } from '@/providers/language-provider'
import { User, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { PhoneInput, COUNTRY_MIN_DIGITS, COUNTRY_MAX_DIGITS } from '@/components/ui/phone-input'
import { isValidPhoneNumber, isPossiblePhoneNumber, getCountryCallingCode } from 'react-phone-number-input'

export default function UserProfile() {
  const { user, logout, updateProfile, changePassword } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [flashMsg, flash] = useFlash()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
  })
  const [phoneCountry, setPhoneCountry] = useState('IN')
  const [phoneTouched, setPhoneTouched] = useState(false)

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name || '',
        phone: user.phone || '',
      })
    }
  }, [user])

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [pwdError, setPwdError] = useState('')
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false })

  const isPasswordTooShort = Boolean(pwd.next && pwd.next.length < 8)
  const passwordsMismatch = Boolean(pwd.confirm && pwd.next !== pwd.confirm)
  const isPasswordFormInvalid = !pwd.current || !pwd.next || !pwd.confirm || pwd.next !== pwd.confirm || pwd.next.length < 8

  // Calculate country-specific phone number validity
  const phoneError = useMemo(() => {
    const rawPhone = form.phone
    if (!rawPhone || !rawPhone.trim() || rawPhone.trim() === '+') {
      return ''
    }

    const trimmed = rawPhone.trim()
    const digitsOnly = trimmed.replace(/\D/g, '')

    if (!digitsOnly) {
      return t('validPhone', 'Please enter a valid phone number.')
    }

    let dialCodeDigits = '91'
    try {
      dialCodeDigits = getCountryCallingCode(phoneCountry)
    } catch {
      dialCodeDigits = '91'
    }

    let localDigits = digitsOnly
    if (digitsOnly.startsWith(dialCodeDigits)) {
      localDigits = digitsOnly.slice(dialCodeDigits.length)
    }

    if (!localDigits) {
      return ''
    }

    const minAllowed = COUNTRY_MIN_DIGITS[phoneCountry] || 7
    const maxAllowed = COUNTRY_MAX_DIGITS[phoneCountry] || 15

    if (phoneCountry === 'IN') {
      if (!/^[6-9]/.test(localDigits)) {
        return t('validIndianMobile', 'Please enter a valid Indian mobile number.')
      }
      if (localDigits.length < 10) {
        return t('phoneTooShort', 'Phone number is too short.')
      }
      if (localDigits.length > 10) {
        return t('phoneTooLong', 'Phone number is too long.')
      }
      return ''
    }

    if (localDigits.length < minAllowed) {
      return t('phoneTooShort', 'Phone number is too short.')
    }
    if (localDigits.length > maxAllowed) {
      return t('phoneTooLong', 'Phone number is too long.')
    }

    const isValid =
      isValidPhoneNumber(trimmed, phoneCountry) ||
      isPossiblePhoneNumber(trimmed, phoneCountry) ||
      (phoneCountry === 'US' && localDigits.length === 10)

    if (!isValid) {
      return t('invalidPhoneCountry', 'Invalid phone number for the selected country.')
    }

    return ''
  }, [form.phone, phoneCountry, t])

  const saveProfile = async (e) => {
    e.preventDefault()
    setError('')
    if (phoneError) {
      setPhoneTouched(true)
      setError(phoneError)
      return
    }
    try {
      await updateProfile({ fullName: form.name, phone: form.phone })
      flash(t('profileUpdated', 'Profile updated'))
    } catch (err) {
      setError(err.message || t('couldNotUpdateProfile', 'Could not update profile'))
    }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    setError('')
    setPwdError('')
    if (pwd.next !== pwd.confirm) {
      setPwdError(t('passwordsDoNotMatch', 'Passwords do not match.'))
      return
    }
    if (pwd.next.length < 8) {
      setPwdError(t('passwordMinLength', 'Password must be at least 8 characters long.'))
      return
    }
    try {
      await changePassword(pwd.current, pwd.next)
      setPwd({ current: '', next: '', confirm: '' })
      setShowPwd({ current: false, next: false, confirm: false })
      flash(t('passwordUpdated', 'Password updated'))
    } catch (err) {
      setPwdError(err.message || t('couldNotUpdatePassword', 'Could not update password'))
    }
  }

  const _handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('myProfile', 'My profile')}
        subtitle={t('contactDetailsDescSubtitle', 'Manage your contact details and account security.')}
      />

      {/* Identity card */}
      <Card className="p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar className="size-14 ring-2 ring-primary/10">
            <AvatarFallback className="text-lg">{user?.initials || 'ZM'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold text-foreground">{user?.name || ''}</span>
            <span className="text-sm text-muted-foreground">{user?.email || ''}</span>
          </div>
          <Badge variant="teal" className="gap-1.5 sm:ml-auto">
            <ShieldCheck className="size-3.5" />
            {t('verifiedAccount', 'Verified account')}
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
                {t('contactDetails', 'Contact details')}
              </CardTitle>
              <CardDescription>{t('updateContactDesc', 'Update how verified pharmacies and ZoikoMeds can reach you.')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={saveProfile} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">{t('fullName', 'Full name')}</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">{t('emailAddress', 'Email address')}</Label>
                    <div className="flex items-center justify-between rounded-xl border border-border/80 bg-muted/40 px-3.5 py-2.5 text-sm">
                      <span className="font-medium text-foreground">{user?.email || '—'}</span>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('readOnly', 'READ-ONLY')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('emailReadOnlyNotice', 'Email is linked to your login account and cannot be changed.')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="phone">{t('phone', 'Phone')}</Label>
                    <PhoneInput
                      id="phone"
                      value={form.phone}
                      countryProp={phoneCountry}
                      onChange={(val) => {
                        setForm((prev) => ({ ...prev, phone: val }))
                        if (val && !phoneTouched) setPhoneTouched(true)
                      }}
                      onCountryChange={(iso2) => {
                        setPhoneCountry(iso2)
                      }}
                      onBlur={() => setPhoneTouched(true)}
                      error={Boolean(phoneTouched && phoneError)}
                      aria-invalid={Boolean(phoneTouched && phoneError)}
                      aria-describedby={phoneTouched && phoneError ? 'phone-error-msg' : undefined}
                    />
                    {phoneTouched && phoneError && (
                      <span id="phone-error-msg" role="alert" className="text-[11px] font-medium text-red-500 leading-snug">
                        {phoneError}
                      </span>
                    )}
                  </div>
                </div>
                <Button type="submit" variant="teal" className="mt-1 w-fit cursor-pointer">{t('saveChanges', 'Save changes')}</Button>
              </form>
            </CardContent>
          </Card>

          {/* Privacy note (governance: no PHI by default) */}
          <div className="flex items-start gap-3 rounded-2xl border border-teal/15 bg-teal/5 p-4">
            <ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-teal" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('profilePrivacyNotice', 'ZoikoMeds does not collect prescriptions or health records. We store only the contact details you provide to power your alerts.')}
            </p>
          </div>
        </div>

        {/* Security + quick actions */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-primary" />
                {t('password', 'Password')}
              </CardTitle>
              <CardDescription>{t('updatePasswordDesc', 'Update your account password.')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={savePassword} className="flex flex-col gap-5">
                {pwdError && (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs font-semibold text-danger leading-snug">
                    ⚠️ {pwdError}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="current">{t('currentPassword', 'Current password')}</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="current"
                      type={showPwd.current ? 'text' : 'password'}
                      placeholder={t('enterPassword', 'Enter password')}
                      value={pwd.current}
                      onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
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

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="next">{t('newPassword', 'New password')}</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="next"
                      type={showPwd.next ? 'text' : 'password'}
                      placeholder={t('enterPassword', 'Enter password')}
                      value={pwd.next}
                      onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
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
                    <p className="text-xs font-medium text-danger">{t('passwordMinLength', 'Password must be at least 8 characters long.')}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">{t('confirmNewPassword', 'Confirm new password')}</Label>
                  <div className="relative flex items-center">
                    <Input
                      id="confirm"
                      type={showPwd.confirm ? 'text' : 'password'}
                      placeholder={t('enterPassword', 'Enter password')}
                      value={pwd.confirm}
                      onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
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
                    <p className="text-xs font-medium text-danger">{t('passwordsDoNotMatch', 'Passwords do not match.')}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="teal"
                  className="mt-1 w-fit cursor-pointer"
                  disabled={isPasswordFormInvalid}
                >
                  {t('updatePasswordBtn', 'Update password')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
