import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StatusBadge, ConfidenceBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { MedicineSuggestions } from '@/components/shared/medicine-suggestions'
import { useMedicineSuggestions } from '@/hooks/use-medicine-suggestions'
import { mapsHref, pharmacyDirectionsHref, telHref, CONFIRM_NOTE, AVAILABILITY } from '@/lib/availability'
import { reverseGeocode } from '@/lib/geocode'
import { validateLocation } from '@/lib/location-data'
import { searchNearbyAvailability } from '@/services/nearby-availability'
import {
  Search, Tag, MapPin, Check, ScanLine, Loader2, ShieldCheck, Navigation,
  Phone, Clock, Pill, CheckCircle2, AlertTriangle, Info,
  LocateFixed, Globe, Star, Heart,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScanPrescription } from '@/features/scan/scan-prescription'
import { DetectedMedicinesBar } from '@/features/scan/detected-medicines-bar'
import { useSavedMedicines, useSaveMedicine, useUnsaveMedicine } from '@/hooks/use-saved-medicines'
import { isMedicineSaved } from '@/lib/medicine-name'
import { useLanguage } from '@/providers/language-provider'

const LOC_KEY = 'zoiko-user-loc'
// Search radii in kilometres. The API has always worked in km — `maxDistance`
// is a km ceiling, the Haversine helper uses R = 6371 km, and Google Places
// caps its circle at 50 km — so the selected value is now passed straight
// through instead of being converted from miles.
const DISTANCES_KM = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
const DEFAULT_DISTANCE_KM = 15
const normalizeQuery = (q) => (q || '').toLowerCase().replace(/near me|in hyderabad/g, '').trim()

export default function UserSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { t } = useLanguage()
  const queryParam = searchParams.get('q') || ''
  const [flashMsg, flash] = useFlash()

  // --- Draft inputs (change freely; NEVER trigger a fetch on their own) -----
  const [mode, setMode] = useState(searchParams.get('mode') === 'scan' ? 'scan' : 'name')
  const [searchQuery, setSearchQuery] = useState(queryParam)
  const [location, setLocation] = useState(() => localStorage.getItem(LOC_KEY) || '')
  // Listen for location changes across settings/modals/tabs
  useEffect(() => {
    const syncLoc = () => {
      const saved = localStorage.getItem(LOC_KEY) || ''
      setLocation(saved)
      if (!saved) setCoords(null)
    }
    window.addEventListener('storage', syncLoc)
    window.addEventListener('zoiko-location-change', syncLoc)
    return () => {
      window.removeEventListener('storage', syncLoc)
      window.removeEventListener('zoiko-location-change', syncLoc)
    }
  }, [])
  // Precise coordinates from the browser's geolocation, when the user opts in.
  const [coords, setCoords] = useState(null)
  const [geoStatus, setGeoStatus] = useState('idle') // idle | loading | ok | error
  const [distanceKm, setDistanceKm] = useState(DEFAULT_DISTANCE_KM)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // --- Medicines read from a scanned prescription --------------------------
  // Held here rather than inside <ScanPrescription> so the list survives the
  // move to the search view: a prescription lists several medicines but
  // availability is searched one at a time, and re-scanning per medicine was
  // the only way to reach the second one.
  const [detected, setDetected] = useState([])
  // Bumping this remounts the scan panel, resetting it to the empty dropzone.
  const [scanKey, setScanKey] = useState(0)

  // Stable identity — <ScanPrescription> publishes through an effect.
  const handleDetected = useCallback((medicines) => {
    setDetected(medicines ?? [])
  }, [])

  // --- Committed search (the ONLY thing that triggers a fetch) --------------
  // Set exclusively by runSearch(). Deep links (/search?q=… from the home page)
  // count as an explicit search, so seed it from the URL on first mount.
  const [activeSearch, setActiveSearch] = useState(() =>
    queryParam.trim()
      ? {
          q: normalizeQuery(queryParam),
          distanceKm: DEFAULT_DISTANCE_KM,
          maxDistanceKm: DEFAULT_DISTANCE_KM,
          lat: undefined,
          lng: undefined,
          city: localStorage.getItem(LOC_KEY) || undefined,
        }
      : null,
  )
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  // Clear committed results — called when any draft input changes after a
  // search, so results for a previous query/location/radius aren't left showing.
  const clearResults = () => {
    setActiveSearch(null)
    setResult(null)
    setLoading(false)
  }

  // Fetch results ONLY when a search has been committed via runSearch().
  useEffect(() => {
    if (!activeSearch) return
    let alive = true
    setLoading(true)
    searchNearbyAvailability({
      q: activeSearch.q,
      maxDistanceKm: activeSearch.maxDistanceKm,
      lat: activeSearch.lat,
      lng: activeSearch.lng,
      city: activeSearch.city,
    })
      .then((r) => { if (alive) setResult(r) })
      .catch(() => {
        if (alive) {
          setResult({ medicine: activeSearch.q, items: [], availableCount: 0, total: 0, internet: null })
        }
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [activeSearch])

  // Live MediBase™ autocomplete (debounced, backed by /medibase/match).
  const { suggestions, loading: suggLoading, error: suggError } = useMedicineSuggestions(searchQuery)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Reset the keyboard highlight whenever the query changes.
  useEffect(() => { setActiveIndex(-1) }, [searchQuery])

  // Keyboard navigation for the suggestion listbox.
  const onNameKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') runSearch()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex]) selectSuggestion(suggestions[activeIndex].name)
      else runSearch()
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  const persistLocation = (value) => {
    setLocation(value)
    if (value) localStorage.setItem(LOC_KEY, value)
  }

  // Ask the browser for the user's coordinates. This updates the draft location
  // only — it does NOT run a search (the user must click Search Availability).
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('error')
      flash('Location isn’t supported by this browser. Enter a city instead.')
      return
    }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCoords(next)
        setGeoStatus('ok')
        // Show coordinates immediately, then replace with a readable place name
        // once reverse geocoding resolves (falls back to coords on failure).
        persistLocation(`${next.lat.toFixed(4)}, ${next.lng.toFixed(4)}`)
        reverseGeocode(next.lat, next.lng).then((label) => {
          if (label) persistLocation(label)
        })
        // Draft changed — clear any previous results; require a new search.
        if (activeSearch) clearResults()
      },
      () => {
        setGeoStatus('error')
        flash('Couldn’t get your location. Enter a city instead.')
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }

  // The ONLY entry point that fetches results. Validates that a medicine and a
  // location are set, then commits the current draft as the active search.
  // `overrideQuery` lets a caller search a name it has just set, without
  // waiting a render for `searchQuery` state to catch up. Guarded so that
  // passing this straight to onClick (which supplies an event) still works.
  const runSearch = async (overrideQuery) => {
    const q = (typeof overrideQuery === 'string' ? overrideQuery : searchQuery).trim()
    if (!q) {
      flash('Enter a medicine name to search.')
      return
    }
    if (!coords && !location.trim()) {
      flash('Set a location — type a city/PIN code or tap “Use my location”.')
      return
    }
    if (!coords && location.trim()) {
      const locRes = await validateLocation(location.trim())
      if (!locRes.isValid) {
        flash(locRes.message || 'Please enter a valid city, area, or 6-digit PIN code.')
        return
      }
    }
    setShowSuggestions(false)
    setActiveSearch({
      q: normalizeQuery(q),
      distanceKm,
      maxDistanceKm: distanceKm,
      lat: coords?.lat,
      lng: coords?.lng,
      city: coords ? undefined : location.trim() || undefined,
    })
    setSearchParams(q ? { q } : {})
  }

  // Autocomplete select — ONLY populates the input; the user still clicks Search.
  const selectSuggestion = (name) => {
    setSearchQuery(name)
    setShowSuggestions(false)
    if (activeSearch) clearResults()
  }

  // A medicine chosen from the scan results, or from the detected-medicines
  // selector. Moves to the search view and runs the search straight away; the
  // detected list stays mounted above the form so the next medicine is one
  // click away. Accepts a medicine object or a bare name.
  const selectDetectedMedicine = (medicine) => {
    const name = (typeof medicine === 'string' ? medicine : medicine?.name ?? '').trim()
    if (!name) return
    setMode('name')
    setSearchQuery(name)
    setShowSuggestions(false)
    if (activeSearch) clearResults()
    // runSearch validates location itself and flashes what is missing, so a
    // user with no location set still lands on a filled-in form.
    void runSearch(name)
  }

  const clearDetected = () => {
    setDetected([])
    setScanKey((key) => key + 1)
  }

  const items = result?.items ?? []
  const hasSearched = !!activeSearch

  // --- Save / unsave the matched medicine ----------------------------------
  // Reuses the existing saved-medicines hooks; no new API surface.
  const { data: savedMedicines = [] } = useSavedMedicines()
  const saveMutation = useSaveMedicine()
  const unsaveMutation = useUnsaveMedicine()
  const savePending = saveMutation.isPending || unsaveMutation.isPending
  const identity = result?.identity

  // Matched by MediBase id when there is one, otherwise by normalized name —
  // the same rule the API uses, so a medicine saved off-catalog still reads as
  // saved here, and keeps reading as saved once a pharmacy links it.
  const isIdentitySaved = isMedicineSaved(savedMedicines, identity)

  const toggleSaveIdentity = async (target) => {
    if (!target?.name || savePending) return
    try {
      if (isIdentitySaved) {
        // Off-catalog rows have no id; the name is the handle.
        await unsaveMutation.mutateAsync(target.id || target.name)
        flash(`Removed ${target.name} from your saved medicines.`)
      } else {
        await saveMutation.mutateAsync({ id: target.id, name: target.name })
        flash(
          target.id
            ? `Saved ${target.name} to your medicines.`
            : `Saved ${target.name}. We'll alert you when a verified pharmacy adds it.`,
        )
      }
    } catch (err) {
      const message = err?.message ?? ''
      if (/already saved/i.test(message)) flash('Already in your saved medicines.')
      else if (/unauthor/i.test(message)) flash('Please sign in to save medicines.')
      else flash(message || 'Could not update your saved medicines.')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      {/* Mode tabs */}
      <div className="flex justify-center pt-1">
        <div className="inline-flex rounded-xl border border-border bg-muted/50 p-1">
          {[
            { key: 'name', label: t('searchByName', 'Search by name'), icon: Search },
            { key: 'scan', label: t('scanPrescription', 'Scan prescription'), icon: ScanLine },
          ].map((tTab) => {
            const Icon = tTab.icon
            const activeTab = mode === tTab.key
            return (
              <button
                key={tTab.key}
                onClick={() => setMode(tTab.key)}
                aria-pressed={activeTab}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                  activeTab ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {tTab.label}
              </button>
            )
          })}
        </div>
      </div>

      {flashMsg && <Flash message={flashMsg} />}

      {/* The scan panel stays mounted while the user searches so its results
          (and the uploaded file) are not thrown away when the view changes —
          hidden rather than unmounted. */}
      <div className={mode === 'scan' ? undefined : 'hidden'}>
        <ScanPrescription
          key={scanKey}
          onSearchMedicine={selectDetectedMedicine}
          onDetected={handleDetected}
          flash={flash}
        />
      </div>

      {mode !== 'name' ? null : (
        <>
          {/* Medicines carried over from the scanned prescription */}
          <DetectedMedicinesBar
            medicines={detected}
            // Derived, so typing a different name un-highlights the chip.
            activeName={searchQuery.trim()}
            onSelect={selectDetectedMedicine}
            onScanAnother={() => setMode('scan')}
            onClear={clearDetected}
            t={t}
          />

          {/* Search form */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
              {/* Medicine name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="medicine-name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('medicineName', 'MEDICINE NAME')}
                </label>
                <div className="relative">
                  <Tag className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="medicine-name"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); if (activeSearch) clearResults() }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setShowSuggestions(false)}
                    onKeyDown={onNameKeyDown}
                    placeholder={t('medicinePlaceholder', 'e.g. Doxycycline')}
                    aria-label="Medicine name"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showSuggestions && (suggLoading || suggestions.length > 0)}
                    aria-controls="medicine-suggestions"
                    aria-activedescendant={activeIndex >= 0 ? `medicine-suggestion-${activeIndex}` : undefined}
                    className="h-11 rounded-xl pl-10"
                  />
                  {showSuggestions && (
                    <MedicineSuggestions
                      id="medicine-suggestions"
                      query={searchQuery}
                      suggestions={suggestions}
                      loading={suggLoading}
                      error={suggError}
                      activeIndex={activeIndex}
                      onHover={setActiveIndex}
                      onSelect={(s) => selectSuggestion(s.name)}
                    />
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('medicineNameHelp', 'Enter a medicine name only. Do not enter symptoms, diagnoses, insurance details, or prescription images.')}
                </p>
              </div>

              {/* Search area */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="search-area" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('searchArea', 'SEARCH AREA')}
                </label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="search-area"
                    value={location}
                    onChange={(e) => {
                      persistLocation(e.target.value)
                      // Typing a place switches off precise coordinates.
                      setCoords(null)
                      setGeoStatus('idle')
                      if (activeSearch) clearResults()
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder={t('searchAreaPlaceholder', 'City, ZIP code, or postcode')}
                    aria-label="Search area"
                    className="h-11 rounded-xl pl-10 pr-36"
                  />
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={geoStatus === 'loading'}
                    className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {geoStatus === 'loading' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <LocateFixed className="size-3.5" />
                    )}
                    {t('useMyLocation', 'Use my location')}
                  </button>
                </div>
                {coords ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <Navigation className="size-3.5" />
                    {t('usingCurrentLocation', 'Using your current location')}
                    <Check className="size-3.5" />
                    <button
                      type="button"
                      onClick={() => {
                        setLocation('')
                        setCoords(null)
                        setGeoStatus('idle')
                        localStorage.removeItem(LOC_KEY)
                        if (activeSearch) clearResults()
                      }}
                      aria-label="Undo location selection"
                      className="ml-1.5 font-normal text-muted-foreground underline hover:text-foreground"
                    >
                      {t('undo', 'Undo')}
                    </button>
                  </span>
                ) : location ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <MapPin className="size-3.5" />
                    {t('locationSet', 'Location set')}
                    <Check className="size-3.5" />
                    <button
                      type="button"
                      onClick={() => {
                        setLocation('')
                        setCoords(null)
                        setGeoStatus('idle')
                        localStorage.removeItem(LOC_KEY)
                        if (activeSearch) clearResults()
                      }}
                      aria-label="Undo location selection"
                      className="ml-1.5 font-normal text-muted-foreground underline hover:text-foreground"
                    >
                      {t('undo', 'Undo')}
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('addLocationHelp', 'Add a location to see nearby pharmacies.')}</span>
                )}
              </div>

              {/* Search button (spacer keeps it aligned with the inputs) */}
              <div className="flex flex-col gap-1.5">
                <span className="hidden text-xs lg:block" aria-hidden>&nbsp;</span>
                <Button className="h-11 px-6" onClick={runSearch}>
                  <Search className="size-4" />
                  {t('searchAvailability', 'Search Availability')}
                </Button>
              </div>
            </div>

            {/* Distance + trust indicators */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                {t('distanceFromMe', 'Distance from me:')}
                <select
                  value={distanceKm}
                  onChange={(e) => { setDistanceKm(Number(e.target.value)); if (activeSearch) clearResults() }}
                  aria-label="Distance from me"
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {DISTANCES_KM.map((d) => (
                    <option key={d} value={d}>{d} {t('km', 'km')}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-primary" />
                  {t('verifiedNetwork', 'Verified pharmacy network')}
                </span>
                <span>{t('privacySafe', 'Privacy-safe search')}</span>
                <span>{t('noExactQuantities', 'No exact stock quantities')}</span>
              </div>
            </div>
          </Card>

          {/* MediBase™ identity for the matched medicine */}
          {hasSearched && !loading && result?.identity && (
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Pill className="size-5" />
                  </span>
                  <div className="flex flex-col">
                    {result.identity.id ? (
                      <Link
                        to={`/medicine/${result.identity.id}`}
                        className="text-base font-bold text-foreground transition-colors hover:text-primary hover:underline"
                      >
                        {result.identity.name}
                      </Link>
                    ) : (
                      <span className="text-base font-bold text-foreground">{result.identity.name}</span>
                    )}
                    {result.identity.generic &&
                      result.identity.generic.toLowerCase() !== result.identity.name.toLowerCase() && (
                        <span className="text-xs text-muted-foreground">Generic: {result.identity.generic}</span>
                      )}
                  </div>
                </div>
                {result.identity.rx != null && (
                  <Badge variant={result.identity.rx ? 'warning' : 'secondary'} size="sm">
                    {result.identity.rx ? t('prescription', 'Prescription') : t('otc', 'OTC')}
                  </Badge>
                )}
              </div>
              {(result.identity.strength || result.identity.form || result.identity.manufacturer) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {result.identity.strength && (
                    <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">{result.identity.strength}</span>
                  )}
                  {result.identity.form && (
                    <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">{result.identity.form}</span>
                  )}
                  {result.identity.manufacturer && (
                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{result.identity.manufacturer}</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                  {t('governedIdentityNotice', 'Governed medicine identity — MediBase™. Availability below is a confidence signal, not exact stock.')}
                </p>
                {/* Save is offered whenever the medicine name is identified —
                    including medicines MediBase does not hold yet, which have
                    no id and therefore no detail page. Those are saved by name
                    and alerted on once a verified pharmacy stocks them. */}
                {result.identity.name && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleSaveIdentity(result.identity)}
                      disabled={savePending}
                      aria-pressed={isIdentitySaved}
                      aria-label={
                        isIdentitySaved
                          ? `Remove ${result.identity.name} from saved medicines`
                          : `Save ${result.identity.name} to your medicines`
                      }
                      className={cn(
                        'flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                        isIdentitySaved
                          ? 'text-red-500 hover:text-red-600'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Heart className={cn('size-3.5', isIdentitySaved && 'fill-red-500')} />
                      {isIdentitySaved
                        ? t('savedMedicine', 'Saved')
                        : t('saveMedicine', 'Save medicine')}
                    </button>
                    {result.identity.id && (
                      <Link to={`/medicine/${result.identity.id}`} className="text-xs font-semibold text-primary hover:underline">
                        {t('viewDetails', 'View details')}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Results — availability of the medicine at nearby pharmacies */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-base font-bold text-foreground">
                {result?.medicine ? `${result.medicine} — ${t('availabilityNearYou', 'Availability near you')}` : t('availabilityNearYou', 'Availability near you')}
              </h3>
              {hasSearched && result && items.length > 0 && (
                <Badge size="sm">{result.availableCount} {t('of', 'of')} {result.total} {t('pharmacies', 'pharmacies')}</Badge>
              )}
              <Link to="/availability" className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <Info className="size-3.5" />
                {t('whatDoesConfidenceMean', 'What does confidence mean?')}
              </Link>
            </div>

            {!hasSearched ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {t('emptySearchPrompt', 'Enter a medicine and tap Search Availability to see which nearby pharmacies are likely to have it.')}
                </p>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('checkingAvailability', 'Checking availability at nearby pharmacies…')}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {t('noPharmaciesFound', 'No pharmacies found within the selected radius. Try a different location or increase the distance.')}
                </p>
              </div>
            ) : (
              <>
                {/* Availability summary */}
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 text-sm',
                    result.availableCount > 0 ? 'border-success/25 bg-success/10' : 'border-warning/25 bg-warning/10',
                  )}
                >
                  {result.availableCount > 0 ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                  )}
                  <span className="leading-relaxed text-foreground">
                    {result.availableCount > 0 ? (
                      <>
                        <span className="font-semibold">{result.medicine || 'This medicine'}</span> is likely
                        available at <span className="font-semibold">{result.availableCount}</span> of{' '}
                        {result.total} nearby pharmacies within{' '}
                        {activeSearch?.distanceKm ?? distanceKm} km.
                      </>
                    ) : (
                      <>
                        We couldn&apos;t confirm{' '}
                        <span className="font-semibold">{result.medicine || 'this medicine'}</span> at nearby
                        pharmacies right now. Try increasing the distance.
                      </>
                    )}
                  </span>
                </div>

                {/* Pharmacy availability cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {items.map((p, i) => {
                    const band = p.confidence ?? 'unknown'
                    return (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: i * 0.04 }}
                      >
                        <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-card">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col">
                              <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                                <ShieldCheck className="size-4 shrink-0 text-primary" />
                                <span className="truncate">{p.name}</span>
                              </span>
                              <span className="truncate text-xs text-muted-foreground">{p.address}</span>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <ConfidenceBadge level={band} size="sm" />
                              <span className="text-right text-[11px] text-muted-foreground">{AVAILABILITY[band]?.plain}</span>
                            </div>
                          </div>

                          {band !== 'high' && (
                            <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning">
                              <AlertTriangle className="size-3" />
                              {t('requiresConfirmation', 'Requires confirmation — call before visiting.')}
                            </p>
                          )}

                          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">{t('distance', 'Distance')}</span>
                              <span className="font-semibold text-foreground tabular">
                                {p.distance == null ? '—' : `${p.distance.toFixed(1)} km`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="size-3" />
                                {t('signalUpdated', 'Signal updated')}
                              </span>
                              <span className="font-medium text-foreground">{p.updated}</span>
                            </div>
                          </div>

                          <div className="mt-auto flex gap-2 border-t border-border pt-3">
                            {/* Only offered when the record actually carries a
                                number — a bare `tel:` link is a dead affordance
                                on the one action the governance note asks for. */}
                            {p.phone ? (
                              <Button variant="outline" size="sm" className="flex-1" asChild>
                                <a href={telHref(p.phone)}>
                                  <Phone className="size-3.5" />
                                  {t('call', 'Call')}
                                </a>
                              </Button>
                            ) : null}
                            <Button size="sm" className="flex-1" asChild>
                              <a href={pharmacyDirectionsHref(p)} target="_blank" rel="noopener noreferrer">
                                <Navigation className="size-3.5" />
                                {t('directions', 'Directions')}
                              </a>
                            </Button>
                          </div>
                        </Card>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Governance note */}
                <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {CONFIRM_NOTE}
                </p>
              </>
            )}
          </section>

          {/* Nearby pharmacies discovered on the web (outside the verified
              network). Only shown once a location has been resolved. */}
          {hasSearched && !loading && result?.internet?.origin && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <Globe className="size-4 text-primary" />
                <h3 className="text-base font-bold text-foreground">{t('morePharmaciesWeb', 'More pharmacies near you (from the web)')}</h3>
                {result.internet.pharmacies.length > 0 && (
                  <Badge size="sm">{result.internet.pharmacies.length}</Badge>
                )}
              </div>

              {result.internet.pharmacies.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-10 text-center">
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    {result.internet.note || 'No additional pharmacies found on the web for this area.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {result.internet.pharmacies.map((p, i) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: i * 0.04 }}
                      >
                        <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-card">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col">
                              <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                                <Globe className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{p.name}</span>
                              </span>
                              {p.address && <span className="truncate text-xs text-muted-foreground">{p.address}</span>}
                            </div>
                            {p.openNow != null && (
                              <StatusBadge tone={p.openNow ? 'good' : 'neutral'} size="sm">
                                {p.openNow ? t('openNow', 'Open now') : t('closed', 'Closed')}
                              </StatusBadge>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">{t('distance', 'Distance')}</span>
                              <span className="font-semibold text-foreground tabular">
                                {p.distance == null ? '—' : `${p.distance.toFixed(1)} km`}
                              </span>
                            </div>
                            {p.rating != null && (
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Star className="size-3" />
                                  {t('rating', 'Rating')}
                                </span>
                                <span className="font-medium text-foreground">
                                  {p.rating}
                                  {p.userRatingCount != null && ` (${p.userRatingCount})`}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="mt-auto flex gap-2 border-t border-border pt-3">
                            {p.phone && (
                              <Button variant="outline" size="sm" className="flex-1" asChild>
                                <a href={telHref(p.phone)}>
                                  <Phone className="size-3.5" />
                                  {t('call', 'Call')}
                                </a>
                              </Button>
                            )}
                            <Button size="sm" className="flex-1" asChild>
                              <a
                                href={p.mapsUri || mapsHref(`${p.name}, ${p.address || ''}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Navigation className="size-3.5" />
                                {t('directions', 'Directions')}
                              </a>
                            </Button>
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>

                  <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {t('webPharmaciesDisclaimer', "Found on the web by location and outside the ZoikoMeds verified network. Stock isn't confirmed — please call ahead.")}
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
