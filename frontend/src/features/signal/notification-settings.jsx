import { Bell } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useLanguage } from '@/providers/language-provider'

// Notification preference toggles. Each change is persisted immediately by the
// parent (optimistic), so there is no explicit save button.
export function NotificationSettings({ settings, onToggle }) {
  const { t } = useLanguage()

  const settingGroups = [
    {
      heading: t('availabilityAlerts', 'Availability alerts'),
      items: [
        { key: 'runningLow', title: t('runningLowTitle', 'Running low'), desc: t('runningLowDesc', 'Notify me when a saved medicine is running low near me.') },
        { key: 'backInStock', title: t('backInStockTitle', 'Back in stock'), desc: t('backInStockDesc', 'Notify me when a saved medicine is available again.') },
        { key: 'nearbyRestock', title: t('nearbyRestockTitle', 'Nearby restock'), desc: t('nearbyRestockDesc', 'Notify me when a nearby pharmacy receives new stock.') },
      ],
    },
    {
      heading: t('safetyHeading', 'Safety'),
      items: [
        { key: 'recall', title: t('medicineRecallTitle', 'Medicine recall alerts'), desc: t('medicineRecallDesc', 'Manufacturer or regulator recall notices for medicines you follow.') },
        { key: 'safety', title: t('governmentSafetyTitle', 'Government safety alerts'), desc: t('governmentSafetyDesc', 'National health advisories for your saved medicine classes.') },
      ],
    },
    {
      heading: t('channelsHeading', 'Channels'),
      items: [
        { key: 'push', title: t('pushNotificationsTitle', 'Push notifications'), desc: t('pushNotificationsDesc', 'Receive alerts on this device.') },
        { key: 'email', title: t('emailNotificationsTitle', 'Email notifications'), desc: t('emailNotificationsDesc', 'Receive a summary by email.') },
        { key: 'sms', title: t('smsNotificationsTitle', 'SMS notifications'), desc: t('smsNotificationsDesc', 'Receive urgent alerts by text message.') },
      ],
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-primary" />
          {t('notificationSettings', 'Notification settings')}
        </CardTitle>
        <CardDescription>
          {t('notificationSettingsDesc', 'Choose what ZoikoSignal™ tells you about — alerts are based on availability confidence, never exact stock.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-2">
        {settingGroups.map((group) => (
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
