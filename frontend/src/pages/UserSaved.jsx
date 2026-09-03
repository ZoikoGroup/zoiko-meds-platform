import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EmptyState, ErrorState } from '@/components/shared/states'
import { Flash, useFlash } from '@/components/shared/flash'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Search,
  Trash2,
  Heart,
  ArrowRight,
  MapPin,
  Clock,
  Store,
  ExternalLink,
} from 'lucide-react'
import { ConfidenceBadge } from '@/components/shared/status'
import { AVAILABILITY, CONFIRM_NOTE, telHref } from '@/lib/availability'
import { formatDistanceKm } from '@/lib/user-location'
import { pharmacyMapsLink } from '@/lib/google-maps-url'
import {
  useSavedMedicines,
  useUnsaveMedicine,
  useToggleSavedAlerts,
  useSignalSettings,
} from '@/hooks/use-saved-medicines'
import { useLanguage } from '@/providers/language-provider'

export default function UserSaved() {
  const { t } = useLanguage()
  const { data: saved = [], isLoading, isError, error, refetch } = useSavedMedicines()
  const unsaveMutation = useUnsaveMedicine()
  const toggleAlertsMutation = useToggleSavedAlerts()
  // Two switches govern one alert: this per-medicine one, and the ZoikoSignal
  // "Back in stock" category. That is the product's design — the category's own
  // description is "Notify me when a saved medicine is available again" — but
  // this page never said so, so turning this on while the category was off
  // produced silence and read as a broken control.
  const { data: signalSettings } = useSignalSettings()
  const backInStockOff = signalSettings?.backInStock === false
  const [flashMsg, flash] = useFlash()
  const navigate = useNavigate()

  const toggleAlerts = (id, currentAlerts) => {
    toggleAlertsMutation.mutate(
      { medicineId: id, alertsEnabled: !currentAlerts },
      {
        onError: () => flash(t('alertPrefsUpdateFailed', 'Could not update alert preferences.')),
      }
    )
  }

  // Which saved medicine's pharmacy list is open, or null. One at a time: the
  // list used to sit inside every card, so a patient following six medicines
  // scrolled past every branch of every one of them to reach the sixth.
  const [pharmaciesFor, setPharmaciesFor] = useState(null)

  const remove = (id, name) => {
    unsaveMutation.mutate(id, {
      onSuccess: () => flash(t('savedRemovedNamed', 'Removed {name} from your saved medicines.', { name })),
      onError: () => flash(t('savedRemoveFailedNamed', 'Could not remove {name}.', { name })),
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

      {isError ? (
        // A failed load used to fall through to `saved = []` and render "No
        // saved medicines yet" — the page told the patient their list was empty
        // when it had never been read. Report the failure, and pass the API's
        // own message through: it is what distinguishes a dead session from a
        // migration the database has not been given yet.
        <ErrorState
          title={t('savedMedicinesLoadFailed', 'Could not load your saved medicines')}
          description={
            error?.message ||
            t(
              'savedMedicinesLoadFailedDesc',
              'We could not reach your saved medicines just now. Please try again.',
            )
          }
          onRetry={refetch}
        />
      ) : saved.length === 0 ? (
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
            // Off-catalog rows have no MediBase id; the name is their key.
            <Card key={med.id ?? med.name} className="transition-shadow hover:shadow-card">
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

                {/* Availability confidence — the reason this page exists. The
                    API already returns it per saved medicine; it was being
                    discarded, leaving the page's own subtitle unfulfilled. */}
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {t('availability', 'Availability')}
                    </span>
                    <ConfidenceBadge level={med.confidence ?? 'unknown'} size="sm" />
                  </div>
                  <span className="text-xs leading-relaxed text-foreground">
                    {AVAILABILITY[med.confidence]?.plain ?? AVAILABILITY.unknown.plain}
                  </span>
                  {/*
                    One line, whatever the pharmacy count. Every verified
                    pharmacy near the patient that reports this medicine used to
                    be listed here with its own distance, freshness, confidence
                    badge and Call link, so a medicine stocked at ten branches
                    made a card ten rows taller than its neighbour and the grid
                    lost any rhythm. The list is the same data, moved behind an
                    action; the summary line above stays as the headline.
                  */}
                  {(med.pharmacies?.length ?? 0) > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1 w-full justify-center"
                      onClick={() => setPharmaciesFor(med)}
                    >
                      <Store className="size-3.5 shrink-0" />
                      {t('viewPharmacies', 'View pharmacies')}
                      <span className="text-muted-foreground">({med.pharmacies.length})</span>
                    </Button>
                  ) : (
                    // Nothing in range, so there is nothing to open. The summary
                    // line is safe to print here: the API derives it from the
                    // same radius-bounded set as the list, so with nothing
                    // nearby it says so rather than naming the strongest
                    // pharmacy anywhere — which is how a patient in Delhi was
                    // shown a Hyderabad pharmacy on a card whose own radius had
                    // just excluded it.
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{med.pharmacy}</span>
                        {med.distance != null && ` · ${formatDistanceKm(med.distance, med.approximate)}`}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3 shrink-0" />
                        {med.updated}
                      </span>
                    </div>
                  )}
                </div>

                {/* Alerts toggle */}
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{t('alertsEnabled', 'Alerts enabled')}</span>
                    <Switch
                      checked={med.alertsEnabled ?? true}
                      onCheckedChange={() => toggleAlerts(med.id ?? med.name, med.alertsEnabled ?? true)}
                      aria-label={`Toggle alerts for ${med.name}`}
                    />
                  </div>
                  {/*
                    Said only when it changes the outcome. This switch is the
                    per-medicine half of the decision; with the category off, no
                    availability alert is produced for any saved medicine, and a
                    switch that reads "enabled" while nothing arrives is the
                    reason this looked broken.
                  */}
                  {backInStockOff && (med.alertsEnabled ?? true) && (
                    <p role="status" className="text-[11px] leading-relaxed text-warning">
                      {t(
                        'savedAlertsCategoryOff',
                        'Availability alerts are switched off for every saved medicine in ZoikoSignal™, so this one will not notify you yet.',
                      )}{' '}
                      <button
                        type="button"
                        onClick={() => navigate('/signal')}
                        className="font-semibold underline underline-offset-2"
                      >
                        {t('savedAlertsCategoryOffAction', 'Turn on “Back in stock”')}
                      </button>
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  {med.id ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/medicine/${med.id}`)}
                    >
                      {t('viewDetails', 'View details')}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  ) : (
                    // No governed identity yet, so no detail page to open —
                    // searching is still useful once a pharmacy adds it.
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/search?q=${encodeURIComponent(med.name)}`)}
                    >
                      {t('searchAgain', 'Search again')}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger hover:bg-danger/5"
                    aria-label={t('removeNamedFromSaved', 'Remove {name} from saved', { name: med.name })}
                    onClick={() => remove(med.id ?? med.name, med.name)}
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

      {/*
        The pharmacy list, moved out of the cards.
        Rendered once for the whole page rather than once per card, and the
        existing Sheet primitive — the same one the mobile navigation uses —
        rather than a new drawer. Bottom sheet on small screens, side panel from
        `sm` up, which is the pattern already in the app.

        The rows carry exactly what the cards carried, from exactly the same
        `med.pharmacies` the API already sends: nothing new is fetched, and the
        patient-visibility rule that produced the list is untouched.
      */}
      <Sheet open={pharmaciesFor !== null} onOpenChange={(open) => !open && setPharmaciesFor(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] gap-0 overflow-y-auto sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[26rem] sm:max-w-full sm:border-l"
        >
          <SheetHeader className="text-start">
            <SheetTitle>{pharmaciesFor?.name}</SheetTitle>
            <SheetDescription>
              {t(
                'viewPharmaciesSubtitle',
                'Verified pharmacies near you reporting this medicine. Availability is a confidence signal — please confirm before travelling.',
              )}
            </SheetDescription>
          </SheetHeader>

          <ul className="flex flex-col divide-y divide-border px-4 pb-4">
            {(pharmaciesFor?.pharmacies ?? []).map((p) => {
              // Coordinates when the operator placed a pin, the address when
              // they did not, and nothing at all when neither is on record —
              // rather than a Maps search for an em dash.
              const mapsLink = pharmacyMapsLink(p)
              const identity = (
                <>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                    <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                    {mapsLink && (
                      <ExternalLink
                        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-5 text-xs text-muted-foreground">
                    {p.distance != null && <span>{formatDistanceKm(p.distance, p.approximate)}</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 shrink-0" />
                      {p.updated}
                    </span>
                  </span>
                </>
              )

              return (
                <li key={p.id} className="flex items-start justify-between gap-2 py-2">
                  {mapsLink ? (
                    <a
                      href={mapsLink}
                      target="_blank"
                      // noopener because this opens an untrusted third-party tab.
                      rel="noopener noreferrer"
                      aria-label={t('openInMapsNamed', 'Open {name} in Google Maps', { name: p.name })}
                      // Enter comes free with an anchor; Space scrolls the page
                      // instead, so it is forwarded here to match how the row
                      // reads — as one activatable thing.
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Spacebar') {
                          e.preventDefault()
                          e.currentTarget.click()
                        }
                      }}
                      className="group -m-1 flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg p-1 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {identity}
                    </a>
                  ) : (
                    // No pin and no address. Still listed — the pharmacy reports
                    // this medicine — but there is nowhere to send anyone, and a
                    // link that searches for nothing is worse than no link.
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">{identity}</div>
                  )}

                  {/*
                    A sibling of the link, not a child of it. Nested anchors are
                    invalid, and keeping Call outside the map target means
                    ringing the branch cannot also open Maps — no click handler
                    has to remember to stop propagating.

                    Availability is a confidence signal, so calling to confirm is
                    the action offered beside it. No number on the record, no
                    dead link.
                  */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <ConfidenceBadge level={p.confidence ?? 'unknown'} size="sm" />
                    {p.phone && (
                      <a
                        href={telHref(p.phone)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        {t('call', 'Call')}
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {CONFIRM_NOTE}
          </p>
        </SheetContent>
      </Sheet>

      {!isError && saved.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">{CONFIRM_NOTE}</p>
      )}
    </div>
  )
}
