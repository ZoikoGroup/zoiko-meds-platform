import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { EmailSecondFactorCard } from '@/components/shared/email-second-factor-card'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Flash, useFlash } from '@/components/shared/flash'
import { DOC_ACCEPT, formatBytes, readDocumentFile } from './verification-document'
import { ErrorState } from '@/components/shared/states'
import {
  getProfile,
  updateProfile,
  resolveMapLink,
  uploadPharmacyLogo,
  removePharmacyLogo,
} from '@/services/pharmacy-api'
import { apiBaseUrl } from '@/lib/api-client'
import { PhoneInput } from '@/components/ui/phone-input'
import { phoneValidationError } from '@/lib/phone'
import { CLASSIFICATION_META } from '@/lib/commercial'
import {
  formatCoordinates,
  isShortMapsLink,
  mapsLinkFor,
  parseGoogleMapsUrl,
} from '@/lib/google-maps-url'
import { useLanguage } from '@/providers/language-provider'
import {
  Building2,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Info,
  CreditCard,
  Upload,
  Trash2,
  MapPin,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'

// Mirrors what the upload route accepts. Checked here as well so an oversized or
// unsupported file is refused instantly, without spending the upload first.
const LOGO_MAX_BYTES = 256 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * The API returns a path relative to its own base, because the same API is
 * reached through more than one origin. Resolve it the way every other call in
 * this client does.
 */
function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null
  return /^https?:\/\//.test(logoUrl) ? logoUrl : `${apiBaseUrl()}${logoUrl}`
}

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

function Field({ label, value, onChange, id, required, placeholder, hint }) {
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
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

/**
 * Set the pharmacy's coordinates from a Google Maps link.
 *
 * Patient search is distance-bounded, so a pharmacy with no coordinates is
 * invisible no matter how complete its profile or inventory is. Asking an
 * operator for latitude and longitude asks for something they do not have; a
 * Maps link is two taps away and already contains the numbers.
 *
 * Full URLs are parsed in the browser. Share links (maps.app.goo.gl) carry no
 * coordinates until their redirect is followed, which a browser cannot do
 * cross-origin, so those go to the API. Nothing is written here: the detected
 * pair is shown for confirmation and stored by the normal profile save, so a
 * mis-pasted link cannot silently move a pharmacy.
 */
function MapsLocationField({ latitude, longitude, precision, onDetected, t }) {
  const [link, setLink] = useState('')
  const [error, setError] = useState(null)
  const [detected, setDetected] = useState(null)
  const [busy, setBusy] = useState(false)

  const stored = formatCoordinates(latitude, longitude)
  const storedLink = mapsLinkFor(latitude, longitude)

  const handleGetLocation = async () => {
    const raw = link.trim()
    setDetected(null)
    if (!raw) {
      setError(t('mapsLinkEmpty', 'Paste a Google Maps link first.'))
      return
    }

    const parsed = parseGoogleMapsUrl(raw)
    if (parsed) {
      setError(null)
      setDetected(parsed)
      onDetected(parsed)
      return
    }

    // No coordinates in the URL itself. Only a share link is worth a round
    // trip; anything else is simply not a Maps location.
    if (!isShortMapsLink(raw)) {
      setError(
        t(
          'mapsLinkInvalid',
          'Could not read a location from that link. Paste a Google Maps link, or coordinates like 17.5561, 78.4181.',
        ),
      )
      return
    }

    setBusy(true)
    try {
      const resolved = await resolveMapLink(raw)
      setError(null)
      setDetected(resolved)
      onDetected(resolved)
    } catch (err) {
      setError(
        err?.message ||
          t(
            'mapsLinkInvalid',
            'Could not read a location from that link. Paste a Google Maps link, or coordinates like 17.5561, 78.4181.',
          ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor="p-maps">{t('googleMapsLocation', 'Google Maps Location')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="p-maps"
          value={link}
          inputMode="url"
          placeholder={t('pasteMapsLink', 'Paste Google Maps location link')}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            // Enter inside a form would submit the whole profile.
            if (e.key === 'Enter') {
              e.preventDefault()
              handleGetLocation()
            }
          }}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleGetLocation}
          disabled={busy}
          className="sm:w-auto"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
          {busy ? t('resolvingMapsLink', 'Reading the link…') : t('getLocation', 'Get Location')}
        </Button>
      </div>

      {error && (
        <span className="flex items-start gap-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          {error}
        </span>
      )}

      {detected && !error && (
        <span className="flex items-start gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
          {t('locationDetected', 'Location detected successfully')} —{' '}
          <span className="tabular">
            {formatCoordinates(detected.latitude, detected.longitude)}
          </span>{' '}
          {t('locationSavedOnSave', 'Save the profile to store it.')}
        </span>
      )}

      {/* What is stored right now, so an operator can tell "set" from "about
          to be set" — and check the pin before committing to it. */}
      {stored ? (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {t('currentLocation', 'Current location')}: <span className="tabular">{stored}</span>
          {storedLink && (
            <a
              href={storedLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t('viewOnMaps', 'View on Google Maps')}
              <ExternalLink className="size-3" />
            </a>
          )}
        </span>
      ) : (
        <span className="flex items-start gap-1.5 text-[11px] text-warning">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          {t(
            'noLocationSet',
            'No location set — your pharmacy will not appear in patient search.',
          )}
        </span>
      )}

      {/* An area-level pin found you a place on the map, which is what gets the
          pharmacy into search at all — but it is the middle of a district, not
          the shop, and only the operator can say which building it is. */}
      {stored && precision === 'APPROXIMATE' && (
        <span className="flex items-start gap-1.5 text-[11px] text-warning">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          {t(
            'approximateLocation',
            'This is an approximate position worked out from your city and postcode, so patients see your distance rounded. Paste a Maps link to your shopfront to place it exactly.',
          )}
        </span>
      )}

      <span className="text-[11px] text-muted-foreground">
        {t(
          'mapsLocationHelp',
          'Open your pharmacy in Google Maps, tap Share, and paste the link here. Patients only find you in nearby search once a location is set.',
        )}
      </span>
    </div>
  )
}

/**
 * The saved country comes back as its ISO code, so echo the country it resolved to.
 * Without it the operator types "India", sees "IN" after saving, and has no way to
 * tell whether that is the right country or a truncation.
 */
function countryHint(value) {
  const code = (value ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return 'A country name such as India, or its two-letter code, IN.'
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
    return name && name !== code ? name : null
  } catch {
    return null
  }
}

export default function PharmacyProfile() {
  const { t } = useLanguage()
  const [profile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)
  // The licence document chosen but not yet saved. It travels with the next
  // save; nothing is uploaded on selection, so a file picked and abandoned
  // never reaches the reviewer.
  const [pendingDoc, setPendingDoc] = useState(null)
  const docInputRef = useRef(null)
  const [flashMsg, flash] = useFlash()

  // Which country a local number is read against. Follows the pharmacy's own
  // country once the profile loads, since that is the number's country too.
  const [phoneCountry, setPhoneCountry] = useState('IN')
  const [phoneTouched, setPhoneTouched] = useState(false)

  // Logo upload. Kept apart from saveError so a rejected image does not read as
  // a failure to save the profile fields, which are a separate request.
  const fileInputRef = useRef(null)
  const [logoBusy, setLogoBusy] = useState('')
  const [logoError, setLogoError] = useState('')

  /**
   * The coordinates as they exist in the database.
   *
   * Held apart from `profile` on purpose. `profile` is the edit buffer, so once
   * Get Location writes a detected pair into it, showing that pair as "current
   * location" would tell the operator their pharmacy has moved when nothing has
   * been saved yet — and the patient search would still be using the old point.
   */
  const [savedCoords, setSavedCoords] = useState({
    latitude: null,
    longitude: null,
    precision: null,
  })

  // A ref, not state: the background refresh below reads it from inside a
  // listener registered once, where a state value would be captured stale.
  const dirtyRef = useRef(false)
  const markDirty = () => {
    dirtyRef.current = true
  }

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      // This runs on window focus too. Stepping away to copy a Maps link and
      // coming back would otherwise overwrite the edit buffer and silently
      // discard the location just detected.
      setProfile((current) => (current && dirtyRef.current ? current : p))
      setSavedCoords({
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        precision: p.locationPrecision ?? null,
      })
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

  // Adopt the pharmacy's own country for the phone field. Only while the operator
  // has not chosen one themselves, so a deliberate pick is not overwritten by the
  // next background refresh of the profile.
  useEffect(() => {
    const saved = profile?.country?.trim()?.toUpperCase()
    if (saved && /^[A-Z]{2}$/.test(saved)) setPhoneCountry((current) => current === 'IN' && saved !== 'IN' ? saved : current)
  }, [profile?.country])

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

  const set = (key) => (value) => {
    markDirty()
    setProfile((p) => ({ ...p, [key]: value }))
  }

  // The same rules the API applies, so a number is refused here rather than by a
  // save that appears to work until the response comes back (MP-23).
  const phoneError = useMemo(
    () => {
      const error = phoneValidationError(profile?.phone, phoneCountry)
      return error ? error.message : ''
    },
    [profile?.phone, phoneCountry],
  )

  /**
   * Upload the chosen file, then adopt the URL the server returns.
   *
   * The returned URL carries the new logo's timestamp, so the replacement appears
   * immediately instead of the browser reusing the cached previous image.
   */
  const onLogoPicked = async (event) => {
    const file = event.target.files?.[0]
    // Reset first: picking the same file twice must fire change again, which it
    // will not while the input still holds that file.
    event.target.value = ''
    if (!file) return

    setLogoError('')
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError('Choose a PNG, JPEG or WebP image. SVG files are not accepted.')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(
        `That image is ${Math.ceil(file.size / 1024)} KB. The maximum logo size is ${LOGO_MAX_BYTES / 1024} KB.`,
      )
      return
    }

    setLogoBusy('upload')
    try {
      const result = await uploadPharmacyLogo(file)
      setProfile((current) => ({ ...current, logoUrl: result?.logoUrl ?? current?.logoUrl }))
      flash('Logo updated')
    } catch (err) {
      setLogoError(err.message || 'Could not upload that logo.')
    } finally {
      setLogoBusy('')
    }
  }

  const onLogoRemove = async () => {
    setLogoError('')
    setLogoBusy('remove')
    try {
      await removePharmacyLogo()
      setProfile((current) => ({ ...current, logoUrl: null }))
      flash('Logo removed')
    } catch (err) {
      setLogoError(err.message || 'Could not remove the logo.')
    } finally {
      setLogoBusy('')
    }
  }

  const save = async (e) => {
    e.preventDefault()
    if (!profile.name?.trim() || !profile.licenseNumber?.trim()) {
      setSaveError('Pharmacy name and licence number are required.')
      return
    }
    if (phoneError) {
      // Reveal the field's own message too, rather than only the summary at the
      // top: the operator needs to see which field is being complained about.
      setPhoneTouched(true)
      setSaveError(phoneError)
      return
    }
    // Patients are shown this number to confirm availability before visiting, so
    // it cannot be left blank. phoneValidationError has nothing to judge on an
    // empty field, which is right where the number is optional and wrong here.
    if (!(profile.phone || '').replace(/\D/g, '')) {
      setPhoneTouched(true)
      setSaveError(
        'Enter your pharmacy’s contact number, including its country or area code — patients are shown this number to confirm availability before visiting.',
      )
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      // One request: the profile and the licence document are saved together,
      // so a file the API refuses fails the whole submission rather than
      // reporting a submission the reviewer has nothing to review.
      //
      // `profile.document` is what GET returned about the file already on record
      // — filename, mimeType, sizeBytes, uploadedAt — and is display-only. It is
      // dropped here: sending it back made the API read a description of the
      // stored file as an upload of a new one, so a save that changed only the
      // licence number failed on a document nobody had touched. Only a file the
      // operator has just chosen is submitted.
      const { document: _attached, ...profileFields } = profile
      const updated = await updateProfile(
        pendingDoc ? { ...profileFields, document: pendingDoc.document } : profileFields,
      )
      if (updated) {
        setProfile(updated)
        // Stored — the "currently attached" line now comes from the server.
        setPendingDoc(null)
        if (docInputRef.current) docInputRef.current.value = ''
        // Echo what the server actually stored, not what was typed.
        setSavedCoords({
          latitude: updated.latitude ?? null,
          longitude: updated.longitude ?? null,
          precision: updated.locationPrecision ?? null,
        })
      }
      dirtyRef.current = false
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
  const logoUrl = resolveLogoUrl(profile.logoUrl)
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

      {/* Approved, and still not findable.
          Verification and listing are separate now: a licence can be approved
          while the record has no map position, and a pharmacy with no position
          is returned by no patient search. Saying "Verified" and stopping there
          would leave an operator believing patients could see them. */}
      {profile.listingBlockedReason && (
        <Notice
          tone="warning"
          title={t('notListedTitle', 'Verified, but patients cannot find you yet')}
          body={t(
            'notListedBody',
            'Your licence is approved. Patient search only ever returns pharmacies within a distance of the person searching, so it cannot include you until your branch has a map position. Set your location below and you are listed straight away — no further review.',
          )}
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
            <div className="flex items-start gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-lg font-bold text-primary">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={profile.name ? `${profile.name} logo` : 'Pharmacy logo'}
                    className="size-full object-contain"
                  />
                ) : (
                  initials || <Building2 className="size-6" />
                )}
              </span>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Pharmacy logo</span>
                  <Badge variant={verify.variant} size="sm" className="gap-1">
                    <ShieldCheck className="size-3" />
                    {verify.label}
                  </Badge>
                </div>
                {/* Hidden, and opened by the buttons: a bare file input cannot be
                    styled, and its "No file chosen" label reads as a broken
                    control next to everything else on this page. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={LOGO_TYPES.join(',')}
                  onChange={onLogoPicked}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={Boolean(logoBusy) || profile.isDraft}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {logoBusy === 'upload' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {logoUrl ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={Boolean(logoBusy)}
                      onClick={onLogoRemove}
                    >
                      {logoBusy === 'remove' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Remove
                    </Button>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {profile.isDraft
                    ? 'Save your pharmacy details first, then you can add a logo.'
                    : `PNG, JPEG or WebP, up to ${LOGO_MAX_BYTES / 1024} KB. Shown to patients beside your pharmacy.`}
                </span>
                {logoError && (
                  <span role="alert" className="text-[11px] font-medium text-danger">
                    {logoError}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="p-name" label="Pharmacy name" required value={profile.name} onChange={set('name')} placeholder="e.g. Apollo Pharmacy, Kompally" />
              <Field id="p-license" label="Licence number" required value={profile.licenseNumber} onChange={set('licenseNumber')} placeholder="e.g. LIC-HYD-01" />
            </div>

            {/* Verification document. The reviewer's Verification Center has
                always had an "Uploaded Documents" panel; this is the control
                that fills it. Saved with the form, not on selection. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-doc">Verification document</Label>
              <input
                ref={docInputRef}
                id="p-doc"
                type="file"
                accept={DOC_ACCEPT}
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const result = await readDocumentFile(file).catch((err) => ({ error: err.message }))
                  if (result.error) {
                    setPendingDoc(null)
                    setSaveError(result.error)
                    e.target.value = ''
                    return
                  }
                  setSaveError(null)
                  setPendingDoc({ name: file.name, size: file.size, document: result.document })
                  markDirty()
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => docInputRef.current?.click()}
                >
                  {profile.document || pendingDoc ? 'Replace document' : 'Upload document'}
                </Button>
                {pendingDoc ? (
                  <span className="text-xs text-muted-foreground">
                    Selected: <span className="font-medium text-foreground">{pendingDoc.name}</span>
                    {' · saved when you submit'}
                  </span>
                ) : profile.document ? (
                  <span className="text-xs text-muted-foreground">
                    Attached:{' '}
                    <span className="font-medium text-foreground">{profile.document.filename}</span>
                    {profile.document.sizeBytes ? ` · ${formatBytes(profile.document.sizeBytes)}` : ''}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No document uploaded yet — PDF, JPG or PNG, up to 5 MB.
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Your pharmacy licence or registration certificate. Reviewers see this with your
                verification request.
              </span>
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
            {/* Required: this is the number shown to patients on the pharmacy's
                search result, and the only way they can confirm before travelling. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-phone">
                Phone
                <span className="text-danger"> *</span>
              </Label>
              <PhoneInput
                id="p-phone"
                value={profile.phone ?? ''}
                countryProp={phoneCountry}
                onChange={set('phone')}
                onCountryChange={setPhoneCountry}
                onBlur={() => setPhoneTouched(true)}
                error={Boolean(phoneTouched && phoneError)}
                aria-invalid={phoneTouched && phoneError ? 'true' : undefined}
                aria-describedby={phoneTouched && phoneError ? 'p-phone-error' : undefined}
              />
              {phoneTouched && phoneError ? (
                <span id="p-phone-error" role="alert" className="text-[11px] font-medium text-danger">
                  {phoneError}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Shown to patients on your pharmacy&rsquo;s search result so they can confirm
                  availability before visiting.
                </span>
              )}
            </div>
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
            <Field id="p-country" label="Country" value={profile.country} onChange={set('country')}
              placeholder="India or IN" hint={countryHint(profile.country)} />
            <MapsLocationField
              // Remount once a save lands, clearing the pasted link and the
              // "save to store it" prompt now that it is stored.
              key={`${savedCoords.latitude},${savedCoords.longitude}`}
              latitude={savedCoords.latitude}
              longitude={savedCoords.longitude}
              precision={savedCoords.precision}
              onDetected={({ latitude, longitude }) => {
                markDirty()
                setProfile((prev) => ({ ...prev, latitude, longitude }))
              }}
              t={t}
            />
          </CardContent>
        </Card>

        {/* Confirm each sign-in by email (MSA-42). Its own control with its own
            save, so it is not part of this form's submit — the Switch renders a
            type="button", which is what keeps it out of the way. */}
        <EmailSecondFactorCard />
      </div>
    </form>
  )
}
