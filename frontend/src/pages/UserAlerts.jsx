import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Flash, useFlash } from '@/components/shared/flash'
import { Bell, Radar, Webhook, MapPin } from 'lucide-react'

const ALERT_OPTIONS = [
  { key: 'backToHigh', icon: Webhook, title: 'Confidence returns to High', desc: 'Notify me when a saved medicine’s availability confidence rises to High at a verified pharmacy near me.' },
  { key: 'nearby', icon: MapPin, title: 'Nearby availability updates', desc: 'Notify me when a verified pharmacy within my range refreshes its availability signals.' },
  { key: 'confidenceChange', icon: Bell, title: 'Confidence changes', desc: 'Notify me when availability moves between High, Moderate, and Low.' },
  { key: 'shortage', icon: Radar, title: 'Shortage signals (ZoikoSignal™)', desc: 'Aggregated, anonymized alerts when regional shortage pressure may affect a saved medicine.' },
]

export default function UserAlerts() {
  const [flashMsg, flash] = useFlash()
  const [alerts, setAlerts] = useState({
    backToHigh: true,
    nearby: true,
    confidenceChange: false,
    shortage: true,
  })

  const toggle = (key) => setAlerts((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Medicine availability alerts"
        subtitle="Choose when ZoikoMeds should notify you about changes in availability confidence."
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
        <CardContent className="flex flex-col gap-1 pt-0">
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
                    <span className="text-sm font-semibold text-foreground">{opt.title}</span>
                    <span className="max-w-sm text-xs leading-relaxed text-muted-foreground">{opt.desc}</span>
                  </div>
                </div>
                <Switch
                  checked={alerts[opt.key]}
                  onCheckedChange={() => toggle(opt.key)}
                  aria-label={opt.title}
                />
              </div>
            )
          })}

          <Button className="mt-4 w-fit" onClick={() => flash('Alert preferences saved')}>
            Save preferences
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
