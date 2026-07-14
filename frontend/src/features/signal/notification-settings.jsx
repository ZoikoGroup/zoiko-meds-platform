import { Bell } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { SETTING_GROUPS } from '@/features/signal/signal-meta'

// Notification preference toggles. Each change is persisted immediately by the
// parent (optimistic), so there is no explicit save button.
export function NotificationSettings({ settings, onToggle }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-primary" />
          Notification settings
        </CardTitle>
        <CardDescription>
          Choose what ZoikoSignal™ tells you about — alerts are based on availability confidence, never exact stock.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-2">
        {SETTING_GROUPS.map((group) => (
          <div key={group.heading} className="flex flex-col gap-1">
            <span className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {group.heading}
            </span>
            {group.items.map((item, i) => (
              <div
                key={item.key}
                className={`flex items-start justify-between gap-4 py-3 ${i < group.items.length - 1 ? 'border-b border-border/70' : ''}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="max-w-sm text-xs leading-relaxed text-muted-foreground">{item.desc}</span>
                </div>
                <Switch
                  checked={!!settings[item.key]}
                  onCheckedChange={() => onToggle(item.key)}
                  aria-label={item.title}
                />
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
