import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/shared/states'
import { Flash, useFlash } from '@/components/shared/flash'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Trash2, Heart, ArrowRight } from 'lucide-react'
import { useSavedMedicines, useUnsaveMedicine, useToggleSavedAlerts } from '@/hooks/use-saved-medicines'
import { useLanguage } from '@/providers/language-provider'

export default function UserSaved() {
  const { t } = useLanguage()
  const { data: saved = [], isLoading } = useSavedMedicines()
  const unsaveMutation = useUnsaveMedicine()
  const toggleAlertsMutation = useToggleSavedAlerts()
  const [flashMsg, flash] = useFlash()
  const navigate = useNavigate()

  const toggleAlerts = (id, currentAlerts) => {
    toggleAlertsMutation.mutate(
      { medicineId: id, alertsEnabled: !currentAlerts },
      {
        onError: () => flash('Could not update alert preferences.'),
      }
    )
  }

  const remove = (id, name) => {
    unsaveMutation.mutate(id, {
      onSuccess: () => flash(`Removed ${name} from saved`),
      onError: () => flash(`Could not remove ${name}`),
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('savedMedicines', 'Saved medicines')}
          subtitle={t('savedMedicinesSubtitle', 'Track availability confidence for the medicines you follow across verified pharmacies.')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('savedMedicines', 'Saved medicines')}
        subtitle={t('savedMedicinesSubtitle', 'Track availability confidence for the medicines you follow across verified pharmacies.')}
      />

      {flashMsg && <Flash message={flashMsg} />}

      {saved.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t('noSavedMedicinesYet', 'No saved medicines yet')}
          description={t('noSavedMedicinesDesc', 'Save a medicine from search or details page to track its availability confidence here.')}
          action={
            <Button onClick={() => navigate('/search')}>
              <Search className="size-4" />
              {t('searchMedicines', 'Search medicines')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((med) => (
            <Card key={med.id} className="transition-shadow hover:shadow-card">
              <CardContent className="flex flex-col gap-4 py-5">
                {/* Saved icon + name / generic · strength */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-bold text-foreground">{med.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[med.generic, med.strength].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                    <Heart className="size-4 fill-red-500 text-red-500" aria-hidden />
                  </span>
                </div>

                {/* Alerts toggle */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3">
                  <span className="text-sm font-medium text-foreground">{t('alertsEnabled', 'Alerts enabled')}</span>
                  <Switch
                    checked={med.alertsEnabled ?? true}
                    onCheckedChange={() => toggleAlerts(med.id, med.alertsEnabled ?? true)}
                    aria-label={`Toggle alerts for ${med.name}`}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => navigate(`/medicine/${med.id}`)}
                  >
                    {t('viewDetails', 'View details')}
                    <ArrowRight className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger hover:bg-danger/5"
                    aria-label={`Remove ${med.name} from saved`}
                    onClick={() => remove(med.id, med.name)}
                    disabled={unsaveMutation.isPending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
