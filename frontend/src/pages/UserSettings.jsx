import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Flash, useFlash } from '@/components/shared/flash'
import { useLanguage, LANG_NAMES } from '@/providers/language-provider'
import { applyPreferences, readPreferences, savePreferences } from '@/lib/a11y-preferences'
import { Globe, Eye, Trash2, CheckCircle2 } from 'lucide-react'

export default function UserSettings() {
  const [flashMsg, flash] = useFlash()
  const { language, setLanguage, t } = useLanguage()
  const [selectedLang, setSelectedLang] = useState(language)
  const [prefs, setPrefs] = useState(readPreferences)
  const [locationCleared, setLocationCleared] = useState(false)

  useEffect(() => {
    setSelectedLang(language)
  }, [language])

  // The boot script in index.html already put these on <html> before paint.
  // Re-applying on mount keeps the switches honest anywhere that script did not
  // run — a test harness, or an embedded render.
  useEffect(() => {
    applyPreferences(prefs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each switch is persisted and applied on the spot — there is no save button
  // here, and an accessibility setting that only lasts until the next reload is
  // not an accessibility setting.
  const toggle = (key) =>
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      savePreferences(next)
      return next
    })

  const handleApplyLanguage = () => {
    setLanguage(selectedLang)
    flash(t('languageUpdated', `Language preference updated to ${LANG_NAMES[selectedLang] || selectedLang}`))
  }

  const clearLocation = () => {
    localStorage.removeItem('zoiko-user-loc')
    localStorage.removeItem('zoiko-loc-permission')
    localStorage.removeItem('zoiko-recent-locations')
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('zoiko-location-change'))
    
    setLocationCleared(true)
    setTimeout(() => setLocationCleared(false), 3500)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('settings', 'Settings')}
        subtitle={t('settingsSubtitle', 'Language, accessibility, and location preferences.')}
      />

      {flashMsg && <Flash message={flashMsg} className="max-w-2xl" />}

      <div className="flex max-w-2xl flex-col gap-5">
        {/* Localization */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              {t('languageAndRegion', 'Language & region')}
            </CardTitle>
            <CardDescription>{t('chooseLanguage', 'Choose your preferred interface language.')}</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                aria-label="Interface language"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Driven by the locale registry, so shipping a language is a
                    file in src/locales — never an edit to this picker. */}
                {Object.entries(LANG_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              <Button variant="teal" size="sm" onClick={handleApplyLanguage}>
                {t('apply', 'Apply')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Accessibility */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              {t('accessibility', 'Accessibility (WCAG 2.2 AA)')}
            </CardTitle>
            <CardDescription>{t('accessibilityDesc', 'Make the interface easier to read and use.')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-5">
            <div className="flex items-center justify-between border-b border-border py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{t('largerText', 'Larger text')}</span>
                <span className="text-xs text-muted-foreground">{t('largerTextDesc', 'Increase label and body text size.')}</span>
              </div>
              <Switch
                checked={prefs.largeText}
                onCheckedChange={() => toggle('largeText')}
                aria-label="Larger text"
              />
            </div>
            <div className="flex items-center justify-between py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{t('reduceMotion', 'Reduce motion')}</span>
                <span className="text-xs text-muted-foreground">{t('reduceMotionDesc', 'Minimize animations and transitions.')}</span>
              </div>
              <Switch
                checked={prefs.reduceMotion}
                onCheckedChange={() => toggle('reduceMotion')}
                aria-label="Reduce motion"
              />
            </div>
          </CardContent>
        </Card>

        {/* Location & data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger">
              <Trash2 className="size-4" />
              {t('locationAndData', 'Location & data')}
            </CardTitle>
            <CardDescription>{t('clearLocationDesc', 'Clear the location saved on this device.')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              We store your preferred location only on this device to surface
              nearby verified pharmacies. Clearing it prompts a fresh location
              request on your next search. No precise coordinates are retained.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={clearLocation} className="w-fit border-danger/30 text-danger hover:bg-danger/5">
                {t('clearLocationBtn', 'Clear saved location')}
              </Button>
              {locationCleared && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-teal dark:text-emerald-400 bg-teal/10 dark:bg-emerald-950/40 px-3 py-1.5 rounded-full border border-teal/20 dark:border-emerald-800/40 animate-in fade-in duration-200">
                  <CheckCircle2 className="size-3.5 text-teal dark:text-emerald-400" />
                  {t('savedLocationCleared', 'Saved location cleared')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
