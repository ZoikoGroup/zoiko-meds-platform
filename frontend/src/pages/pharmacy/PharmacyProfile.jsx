import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Flash, useFlash } from '@/components/shared/flash'
import { getProfile, updateProfile } from '@/services/pharmacy-api'
import { Building2, ShieldCheck, Clock, Loader2, AlertCircle } from 'lucide-react'

const VERIFY_META = {
  VERIFIED: { variant: 'success', label: 'Verified' },
  INFO_REQUESTED: { variant: 'warning', label: 'Information Requested' },
  PENDING: { variant: 'secondary', label: 'Pending Verification' },
  UNVERIFIED: { variant: 'secondary', label: 'Unverified' },
  REJECTED: { variant: 'destructive', label: 'Rejected' },
  SUSPENDED: { variant: 'destructive', label: 'Suspended' },
}

function Field({ label, value, onChange, id }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export default function PharmacyProfile() {
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [flashMsg, flash] = useFlash()

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      setProfile(p)
    } catch (err) {
      console.error('Failed to load profile', err)
    }
  }, [])

  useEffect(() => {
    loadProfile()

    const handleSync = () => loadProfile()
    window.addEventListener('pharmacy-status-updated', handleSync)
    window.addEventListener('focus', handleSync)
    return () => {
      window.removeEventListener('pharmacy-status-updated', handleSync)
      window.removeEventListener('focus', handleSync)
    }
  }, [loadProfile])

  const set = (key) => (value) => setProfile((p) => ({ ...p, [key]: value }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await updateProfile(profile)
      if (updated) setProfile(updated)
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
      flash('Pharmacy profile saved')
    } catch {
      flash('Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading profile…
      </div>
    )
  }

  const verify = VERIFY_META[profile.verificationStatus] ?? VERIFY_META.UNVERIFIED

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <PageHeader
        title="Pharmacy profile"
        subtitle="Your public identity, contact details, and licence information."
        actions={
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        }
      />
      {flashMsg && <Flash message={flashMsg} className="max-w-3xl" />}

      {profile.verificationStatus === 'INFO_REQUESTED' && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning max-w-4xl">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertCircle className="size-5 shrink-0" />
            Information Requested by Reviewer
          </div>
          <p className="text-xs text-foreground/90 whitespace-pre-line leading-relaxed pl-7">
            {profile.notes || 'Please update your pharmacy information or license details as requested by the admin team.'}
          </p>
        </div>
      )}

      <div className="grid max-w-4xl grid-cols-1 gap-5">
        {/* Identity + verification */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" /> Pharmacy information
            </CardTitle>
            <CardDescription>Name and logo shown to patients across the network.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 pt-5">
            <div className="flex items-center gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-lg font-bold text-primary">
                {profile.name?.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Pharmacy logo</span>
                  <Badge variant={verify.variant} size="sm" className="gap-1">
                    <ShieldCheck className="size-3" />
                    {verify.label}
                  </Badge>
                </div>
                {/* TODO(backend): logo upload → POST /pharmacy/me/logo */}
                <Button type="button" variant="outline" size="sm">Upload logo</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="p-name" label="Pharmacy name" value={profile.name} onChange={set('name')} />
              <Field id="p-license" label="Licence number" value={profile.licenseNumber} onChange={set('licenseNumber')} />
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
            <Field id="p-phone" label="Phone" value={profile.phone} onChange={set('phone')} />
            <Field id="p-email" label="Email" value={profile.email} onChange={set('email')} />
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
            <Field id="p-addr" label="Address line" value={profile.addressLine1} onChange={set('addressLine1')} />
            <Field id="p-city" label="City" value={profile.city} onChange={set('city')} />
            <Field id="p-region" label="Region / State" value={profile.region} onChange={set('region')} />
            <Field id="p-postal" label="Postal code" value={profile.postalCode} onChange={set('postalCode')} />
            <Field id="p-country" label="Country" value={profile.country} onChange={set('country')} placeholder="e.g. India" />
          </CardContent>
        </Card>

        {/* Operating hours */}
        {profile.hours && Array.isArray(profile.hours) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4 text-primary" /> Operating hours
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 pt-5">
              {profile.hours.map((h, i) => (
                <div
                  key={h.day}
                  className={'flex items-center justify-between py-3 ' + (i < profile.hours.length - 1 ? 'border-b border-border' : '')}
                >
                  <span className="text-sm font-medium text-foreground">{h.day}</span>
                  <span className="text-sm text-muted-foreground tabular">{h.open} – {h.close}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </form>
  )
}
