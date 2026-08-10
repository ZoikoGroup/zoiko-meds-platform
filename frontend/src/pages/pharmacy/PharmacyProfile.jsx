import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Flash, useFlash } from '@/components/shared/flash'
import { ErrorState } from '@/components/shared/states'
import { getProfile, updateProfile } from '@/services/pharmacy-api'
import { CLASSIFICATION_META } from '@/lib/commercial'
import { Building2, ShieldCheck, Loader2, AlertCircle, Info, CreditCard } from 'lucide-react'

const VERIFY_META = {
  VERIFIED: { variant: 'success', label: 'Verified' },
  INFO_REQUESTED: { variant: 'warning', label: 'Information Requested' },
  PENDING: { variant: 'warning', label: 'Pending Verification' },
  UNVERIFIED: { variant: 'secondary', label: 'Not Yet Submitted' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
  SUSPENDED: { variant: 'danger', label: 'Suspended' },
}

// What the operator is told about where their record stands with the reviewers.
const REVIEW_NOTICE = {
  UNVERIFIED: {
    tone: 'info',
    title: 'Your pharmacy is not submitted for verification yet',
    body: 'Fill in your pharmacy name, licence number and address, then save. Your details go to the ZoikoMeds team for verification.',
  },
  PENDING: {
    tone: 'info',
    title: 'Awaiting verification',
    body: 'Your details are with the ZoikoMeds team for review. You can keep editing them — saving again updates the open request. Your pharmacy stays out of patient search results until it is approved.',
  },
  INFO_REQUESTED: {
    tone: 'warning',
    title: 'Information requested by reviewer',
    body: 'Please update your pharmacy information or licence details as requested, then save to resubmit.',
  },
  REJECTED: {
    tone: 'warning',
    title: 'Verification rejected',
    body: 'Correct the details below and save to submit a fresh request, or contact support if you believe this is an error.',
  },
  SUSPENDED: {
    tone: 'warning',
    title: 'Pharmacy suspended',
    body: 'Your pharmacy has been suspended by the ZoikoMeds team. Contact support to resolve this.',
  },
}

// A draft whose account already has a request queued by an admin. The pharmacy
// record does not exist yet, so verificationStatus is still UNVERIFIED — but
// telling the operator nothing has been submitted would contradict the reviewer
// note they can see, so key the notice off the request instead.
const AWAITING_DETAILS_NOTICE = {
  tone: 'info',
  title: 'The ZoikoMeds team is waiting for your pharmacy details',
  body: 'Your account is queued for verification but we do not have your pharmacy details yet. Fill in the name, licence number and address below, then save to send them for review.',
}

const TONE_CLASS = {
  info: 'border-info/40 bg-info/10 text-info',
  warning: 'border-warning/40 bg-warning/10 text-warning',
}

function Notice({ tone, title, body, detail }) {
  const Icon = tone === 'warning' ? AlertCircle : Info
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-4 max-w-4xl ${TONE_CLASS[tone]}`}>
      <div className="flex items-center gap-2 font-bold text-sm">
        <Icon className="size-5 shrink-0" />
        {title}
      </div>
      <p className="text-xs text-foreground/90 leading-relaxed pl-7">{body}</p>
      {detail && (
        <p className="text-xs text-foreground/90 whitespace-pre-line leading-relaxed pl-7 border-l-2 border-current/30 ml-7">
          {detail}
        </p>
      )}
    </div>
  )
}

function Field({ label, value, onChange, id, required, placeholder }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      <Input
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export default function PharmacyProfile() {
  const [profile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [flashMsg, flash] = useFlash()

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      setProfile(p)
      setLoadError(null)
    } catch (err) {
      console.error('Failed to load profile', err)
      // Only strand the page on the error state if nothing is on screen yet —
      // a failed background refresh should not wipe details being edited.
      setProfile((current) => {
        if (!current) setLoadError(err.message || 'Could not load your pharmacy profile.')
        return current
      })
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
    if (!profile.name?.trim() || !profile.licenseNumber?.trim()) {
      setSaveError('Pharmacy name and licence number are required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateProfile(profile)
      if (updated) setProfile(updated)
      flash(
        updated?.verificationStatus === 'VERIFIED'
          ? 'Pharmacy profile saved'
          : 'Profile saved and sent to the ZoikoMeds team for verification',
      )
    } catch (err) {
      setSaveError(err.message || 'Could not save your profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <ErrorState
        title="Could not load your pharmacy profile"
        description={loadError}
        onRetry={() => {
          setLoadError(null)
          loadProfile()
        }}
        className="max-w-4xl"
      />
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading profile…
      </div>
    )
  }

  const verify = VERIFY_META[profile.verificationStatus] ?? VERIFY_META.UNVERIFIED
  const awaitingDetails = profile.isDraft && !!profile.reviewStatus
  const notice = awaitingDetails
    ? AWAITING_DETAILS_NOTICE
    : REVIEW_NOTICE[profile.verificationStatus]
  const isVerified = profile.verificationStatus === 'VERIFIED'
  const initials = profile.name?.trim()?.slice(0, 2).toUpperCase()
  const plan = CLASSIFICATION_META[profile.commercialClassification] ?? null

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <PageHeader
        title="Pharmacy profile"
        subtitle={
          profile.isDraft
            ? 'We do not have your pharmacy details yet — add them to get verified.'
            : 'Your public identity, contact details, and licence information.'
        }
        actions={
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isVerified ? 'Save changes' : 'Save & submit for verification'}
          </Button>
        }
      />
      {flashMsg && <Flash message={flashMsg} className="max-w-3xl" />}

      {saveError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger max-w-3xl"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {saveError}
        </div>
      )}

      {notice && (
        <Notice
          tone={notice.tone}
          title={notice.title}
          body={notice.body}
          detail={
            profile.verificationStatus === 'INFO_REQUESTED' ||
            profile.reviewStatus === 'REQUEST_INFO'
              ? profile.notes
              : null
          }
        />
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
                {initials || <Building2 className="size-6" />}
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
              <Field id="p-name" label="Pharmacy name" required value={profile.name} onChange={set('name')} placeholder="e.g. Apollo Pharmacy, Kompally" />
              <Field id="p-license" label="Licence number" required value={profile.licenseNumber} onChange={set('licenseNumber')} placeholder="e.g. LIC-HYD-01" />
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
            <CardDescription>Email is taken from your ZoikoMeds account.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
            <Field id="p-phone" label="Phone" value={profile.phone} onChange={set('phone')} placeholder="e.g. +91 40 2345 6789" />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" value={profile.email ?? ''} readOnly disabled />
            </div>
          </CardContent>
        </Card>

        {/* Plan — read-only. The profile is not a billing surface: there is no
            price, no payment method and no checkout here. */}
        {plan && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="size-4 text-primary" /> Plan
              </CardTitle>
              <CardDescription>
                Your participation in the ZoikoMeds network.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex items-center gap-2">
                <Badge variant={plan.variant}>{plan.label}</Badge>
                {!plan.billable && (
                  <span className="text-xs text-muted-foreground">No charge</span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Network Core participation is free during the supply-density build phase, and your
                pharmacy&apos;s position in patient search is never affected by what you pay.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
            <Field id="p-addr" label="Address line" value={profile.addressLine1} onChange={set('addressLine1')} />
            <Field id="p-addr2" label="Address line 2" value={profile.addressLine2} onChange={set('addressLine2')} />
            <Field id="p-city" label="City" value={profile.city} onChange={set('city')} />
            <Field id="p-region" label="Region / State" value={profile.region} onChange={set('region')} />
            <Field id="p-postal" label="Postal code" value={profile.postalCode} onChange={set('postalCode')} />
            <Field id="p-country" label="Country" value={profile.country} onChange={set('country')} placeholder="e.g. India" />
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
