import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Flash, useFlash } from '@/components/shared/flash'
import { Globe, Eye, Trash2 } from 'lucide-react'

export default function UserSettings() {
  const [flashMsg, flash] = useFlash()
  const [language, setLanguage] = useState('en')
  const [prefs, setPrefs] = useState({ largeText: false, reduceMotion: false })

  const toggle = (key) => setPrefs((prev) => ({ ...prev, [key]: !prev[key] }))

  const clearLocation = () => {
    localStorage.removeItem('zoiko-user-loc')
    localStorage.removeItem('zoiko-loc-permission')
    flash('Saved location cleared')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle="Language, accessibility, and location preferences."
      />

      {flashMsg && <Flash message={flashMsg} className="max-w-2xl" />}

      <div className="flex max-w-2xl flex-col gap-5">
        {/* Localization */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              Language &amp; region
            </CardTitle>
            <CardDescription>Choose your preferred interface language.</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Interface language"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="en">English (India)</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="te">తెలుగు (Telugu)</option>
                <option value="es">Español</option>
              </select>
              <Button variant="outline" size="sm" onClick={() => flash('Language preference saved')}>
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Accessibility */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Accessibility (WCAG 2.2 AA)
            </CardTitle>
            <CardDescription>Make the interface easier to read and use.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-5">
            <div className="flex items-center justify-between border-b border-border py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">Larger text</span>
                <span className="text-xs text-muted-foreground">Increase label and body text size.</span>
              </div>
              <Switch checked={prefs.largeText} onCheckedChange={() => toggle('largeText')} aria-label="Larger text" />
            </div>
            <div className="flex items-center justify-between py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">Reduce motion</span>
                <span className="text-xs text-muted-foreground">Minimize animations and transitions.</span>
              </div>
              <Switch checked={prefs.reduceMotion} onCheckedChange={() => toggle('reduceMotion')} aria-label="Reduce motion" />
            </div>
          </CardContent>
        </Card>

        {/* Location & data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger">
              <Trash2 className="size-4" />
              Location &amp; data
            </CardTitle>
            <CardDescription>Clear the location saved on this device.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              We store your preferred location only on this device to surface
              nearby verified pharmacies. Clearing it prompts a fresh location
              request on your next search. No precise coordinates are retained.
            </p>
            <Button variant="outline" onClick={clearLocation} className="w-fit border-danger/30 text-danger hover:bg-danger/5">
              Clear saved location
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
