import { useState, useEffect } from 'react'
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
import { mapsHref, telHref, CONFIRM_NOTE, AVAILABILITY } from '@/lib/availability'
import { searchNearbyAvailability } from '@/services/nearby-availability'
import {
  Search, Tag, MapPin, Check, ScanLine, Loader2, ShieldCheck, Navigation,
  Phone, Clock, Ambulance, Pill, CheckCircle2, AlertTriangle, Info,
  LocateFixed, Globe, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScanPrescription } from '@/features/scan/scan-prescription'

const LOC_KEY = 'zoiko-user-loc'
const DISTANCES = [5, 10, 15, 25, 50]
const KM_PER_MILE = 1.60934

export default function UserSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') || ''
  const [flashMsg, flash] = useFlash()

  const [mode, setMode] = useState(searchParams.get('mode') === 'scan' ? 'scan' : 'name')
  const [searchQuery, setSearchQuery] = useState(queryParam)
  const [location, setLocation] = useState(() => localStorage.getItem(LOC_KEY) || '')
  // Precise coordinates from the browser's geolocation, when the user opts in.
  const [coords, setCoords] = useState(null)
  const [geoStatus, setGeoStatus] = useState('idle') // idle | loading | ok | error
  // Location committed at search time (so typing in the box doesn't refetch).
  const [appliedLoc, setAppliedLoc] = useState(() => ({
    city: localStorage.getItem(LOC_KEY) || undefined,
    lat: undefined,
    lng: undefined,
  }))
  const [distanceMiles, setDistanceMiles] = useState(15)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(!!queryParam)
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => setSearchQuery(queryParam), [queryParam])

  // Look up whether the searched medicine is available at nearby pharmacies.
  useEffect(() => {
    if (!hasSearched) return
    let alive = true
    setLoading(true)
    const q = queryParam.toLowerCase().replace(/near me|in hyderabad/g, '').trim()
    const maxDistanceKm = Math.max(1, Math.round(distanceMiles * KM_PER_MILE))
    searchNearbyAvailability({
      q,
      maxDistanceKm,
      lat: appliedLoc.lat,
      lng: appliedLoc.lng,
      city: appliedLoc.city || undefined,
    })
      .then((r) => alive && setResult(r))
      .catch(() => alive && setResult({ medicine: q, items: [], availableCount: 0, total: 0, internet: null }))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [queryParam, distanceMiles, appliedLoc, hasSearched])

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

  // Freeze the current location choice so the search uses it. Precise coords
  // win over the typed city; typing a city clears any prior coords.
  const commitLocation = () =>
    setAppliedLoc({
      city: coords ? undefined : location || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
    })

  // Ask the browser for the user's coordinates ("nearby pharmacies from the web").
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
        persistLocation('Current location')
        // Refresh an on-screen search against the new precise location.
        setAppliedLoc({ city: undefined, lat: next.lat, lng: next.lng })
      },
      () => {
        setGeoStatus('error')
        flash('Couldn’t get your location. Enter a city instead.')
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }

  const runSearch = () => {
    setHasSearched(true)
    setShowSuggestions(false)
    commitLocation()
    setSearchParams(searchQuery.trim() ? { q: searchQuery.trim() } : {})
  }

  const selectSuggestion = (name) => {
    setSearchQuery(name)
    setShowSuggestions(false)
    setHasSearched(true)
    commitLocation()
    setSearchParams({ q: name })
  }

  // Search a medicine extracted from a scanned prescription.
  const handleScanSearch = (name) => {
    setMode('name')
    setSearchQuery(name)
    setHasSearched(true)
    commitLocation()
    setSearchParams({ q: name })
    flash(`Checking availability for ${name}`)
  }

  const items = result?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      {/* Mode tabs */}
      <div className="flex justify-center pt-1">
        <div className="inline-flex rounded-xl border border-border bg-muted/50 p-1">
          {[
            { key: 'name', label: 'Search by name', icon: Search },
            { key: 'scan', label: 'Scan prescription', icon: ScanLine },
          ].map((t) => {
            const Icon = t.icon
            const activeTab = mode === t.key
            return (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                aria-pressed={activeTab}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                  activeTab ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {flashMsg && <Flash message={flashMsg} />}

      {mode === 'scan' ? (
        <ScanPrescription onSearchMedicine={handleScanSearch} flash={flash} />
      ) : (
        <>
          {/* Search form */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
              {/* Medicine name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="medicine-name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Medicine name
                </label>
                <div className="relative">
                  <Tag className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="medicine-name"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true) }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setShowSuggestions(false)}
                    onKeyDown={onNameKeyDown}
                    placeholder="e.g. Doxycycline"
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
                  Enter a medicine name only. Do not enter symptoms, diagnoses, insurance details,
                  or prescription images.
                </p>
              </div>

              {/* Search area */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="search-area" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Search area
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
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="City, ZIP code, or postcode"
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
                    Use my location
                  </button>
                </div>
                {coords ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <Navigation className="size-3.5" />
                    Using your current location
                    <Check className="size-3.5" />
                  </span>
                ) : location ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <MapPin className="size-3.5" />
                    Location set
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Add a location to see nearby pharmacies.</span>
                )}
              </div>

              {/* Search button (spacer keeps it aligned with the inputs) */}
              <div className="flex flex-col gap-1.5">
                <span className="hidden text-xs lg:block" aria-hidden>&nbsp;</span>
                <Button className="h-11 px-6" onClick={runSearch}>
                  <Search className="size-4" />
                  Search Availability
                </Button>
              </div>
            </div>

            {/* Distance + trust indicators */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                Distance from me:
                <select
                  value={distanceMiles}
                  onChange={(e) => setDistanceMiles(Number(e.target.value))}
                  aria-label="Distance from me"
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {DISTANCES.map((d) => (
                    <option key={d} value={d}>{d} miles</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-primary" />
                  Verified pharmacy network
                </span>
                <span>Privacy-safe search</span>
                <span>No exact stock quantities</span>
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
                    {result.identity.rx ? 'Prescription' : 'OTC'}
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
                  Governed medicine identity — MediBase™. Availability below is a confidence signal, not exact stock.
                </p>
                {result.identity.id && (
                  <Link to={`/medicine/${result.identity.id}`} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                    View details
                  </Link>
                )}
              </div>
            </Card>
          )}

          {/* Results — availability of the medicine at nearby pharmacies */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-base font-bold text-foreground">
                {result?.medicine ? `${result.medicine} — availability near you` : 'Availability near you'}
              </h3>
              {hasSearched && result && items.length > 0 && (
                <Badge size="sm">{result.availableCount} of {result.total} pharmacies</Badge>
              )}
              <Link to="/availability" className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <Info className="size-3.5" />
                What does confidence mean?
              </Link>
            </div>

            {!hasSearched ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Enter a medicine and tap{' '}
                  <span className="font-semibold text-foreground">Search Availability</span> to see which
                  nearby pharmacies are likely to have it.
                </p>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Checking availability at nearby pharmacies…
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  No pharmacies found within the selected radius. Try a different location or
                  increase the distance.
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
                        {result.total} nearby pharmacies within {distanceMiles} miles.
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
                              Requires confirmation — call before visiting.
                            </p>
                          )}

                          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Distance</span>
                              <span className="flex items-center gap-1.5 font-semibold text-foreground tabular">
                                {p.is24x7 && (
                                  <Badge variant="success" size="sm" className="gap-1">
                                    <Ambulance className="size-3" />
                                    24/7
                                  </Badge>
                                )}
                                {p.distance == null ? '—' : `${(p.distance / KM_PER_MILE).toFixed(1)} mi`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="size-3" />
                                Signal updated
                              </span>
                              <span className="font-medium text-foreground">{p.updated}</span>
                            </div>
                          </div>

                          <div className="mt-auto flex gap-2 border-t border-border pt-3">
                            <Button variant="outline" size="sm" className="flex-1" asChild>
                              <a href={telHref(p.phone)}>
                                <Phone className="size-3.5" />
                                Call
                              </a>
                            </Button>
                            <Button size="sm" className="flex-1" asChild>
                              <a href={mapsHref(`${p.name}, ${p.address}`)} target="_blank" rel="noopener noreferrer">
                                <Navigation className="size-3.5" />
                                Directions
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
                <h3 className="text-base font-bold text-foreground">More pharmacies near you (from the web)</h3>
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
                                {p.openNow ? 'Open now' : 'Closed'}
                              </StatusBadge>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Distance</span>
                              <span className="font-semibold text-foreground tabular">
                                {p.distance == null ? '—' : `${(p.distance / KM_PER_MILE).toFixed(1)} mi`}
                              </span>
                            </div>
                            {p.rating != null && (
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Star className="size-3" />
                                  Rating
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
                                  Call
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
                                Directions
                              </a>
                            </Button>
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>

                  <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    Found on the web by location and outside the ZoikoMeds verified network. Stock isn’t confirmed — please call ahead.
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
