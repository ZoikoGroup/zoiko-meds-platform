import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Flash, useFlash } from '@/components/shared/flash'
import { getAlertPreferences, updateAlertPreferences } from '@/services/user-api'
import { Bell, Radar, Webhook, MapPin, Loader2 } from 'lucide-react'
import { useLanguage } from '@/providers/language-provider'

const ALERT_OPTIONS = [
  { key: 'backToHigh', icon: Webhook, titleKey: 'alertBackToHighTitle', descKey: 'alertBackToHighDesc', title: 'Confidence returns to High', desc: 'Notify me when a saved medicine’s availability confidence rises to High at a verified pharmacy near me.' },
  { key: 'nearby', icon: MapPin, titleKey: 'alertNearbyTitle', descKey: 'alertNearbyDesc', title: 'Nearby availability updates', desc: 'Notify me when a verified pharmacy within my range refreshes its availability signals.' },
  { key: 'confidenceChange', icon: Bell, titleKey: 'alertConfidenceChangeTitle', descKey: 'alertConfidenceChangeDesc', title: 'Confidence changes', desc: 'Notify me when availability moves between High, Moderate, and Low.' },
  { key: 'shortage', icon: Radar, titleKey: 'alertShortageTitle', descKey: 'alertShortageDesc', title: 'Shortage signals (ZoikoSignal™)', desc: 'Aggregated, anonymized alerts when regional shortage pressure may affect a saved medicine.' },
]

const DEFAULTS = { backToHigh: true, nearby: true, confidenceChange: false, shortage: true }

export default function UserAlerts() {
  const { t } = useLanguage()
  const [flashMsg, flash] = useFlash()
  const [alerts, setAlerts] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    getAlertPreferences()
      .then((prefs) => alive && setAlerts(prefs))
      .catch((err) => alive && flash(err.message || t('alertPrefsLoadFailed', 'Could not load alert preferences')))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist each toggle immediately (optimistic), reverting on failure.
  const toggle = async (key) => {
    const next = !alerts[key]
    setAlerts((prev) => ({ ...prev, [key]: next }))
    try {
      await updateAlertPreferences({ [key]: next })
    } catch (err) {
      setAlerts((prev) => ({ ...prev, [key]: !next }))
      flash(err.message || t('prefUpdateFailed', 'Could not update preference'))
    }
  }

  const savePreferences = async () => {
    setSaving(true)
    try {
      await updateAlertPreferences(alerts)
      flash(t('alertPrefsSaved', 'Alert preferences saved'))
    } catch (err) {
      flash(err.message || t('alertPrefsSaveFailed', 'Could not save preferences'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('medicineAvailabilityAlerts', 'Medicine availability alerts')}
        subtitle={t('alertsPageSubtitle', 'Choose when ZoikoMeds should notify you about changes in availability confidence.')}
      />

      {flashMsg && <Flash message={flashMsg} className="max-w-2xl" />}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            Notification preferences
          </CardTitle>
          <CardDescription>Alerts are based on availability confidence — never exact stock.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 pt-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading preferences…
            </div>
          ) : (
            <>
              {ALERT_OPTIONS.map((opt, i) => {
                const Icon = opt.icon
                return (
                  <div
                    key={opt.key}
                    className={`flex items-start justify-between gap-4 py-4 ${i < ALERT_OPTIONS.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-teal">
                        <Icon className="size-4" />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-foreground">{t(opt.titleKey, opt.title)}</span>
                        <span className="max-w-sm text-xs leading-relaxed text-muted-foreground">{t(opt.descKey, opt.desc)}</span>
                      </div>
                    </div>
                    <Switch
                      checked={!!alerts[opt.key]}
                      onCheckedChange={() => toggle(opt.key)}
                      aria-label={t(opt.titleKey, opt.title)}
                    />
                  </div>
                )
              })}

              <Button className="mt-4 w-fit" onClick={savePreferences} disabled={saving}>
                {saving ? (<><Loader2 className="size-4 animate-spin" />Saving…</>) : 'Save preferences'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
