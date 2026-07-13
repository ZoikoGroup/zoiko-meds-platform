import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { mapsHref, telHref, CONFIRM_NOTE } from '@/lib/availability'
import { searchNearbyAvailability } from '@/services/nearby-availability'
import {
  Search, Tag, MapPin, Check, ScanLine, Loader2, ShieldCheck, Navigation,
  Phone, Clock, Ambulance, Pill, CheckCircle2, AlertTriangle, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScanPrescription } from '@/features/scan/scan-prescription'

const LOC_KEY = 'zoiko-user-loc'
const DISTANCES = [5, 10, 15, 25, 50]
const KM_PER_MILE = 1.60934

// Common medicines for the name-field autocomplete. Prefix matches are ranked
// ahead of substring matches so a single letter surfaces the most relevant names.
const MEDICINE_SUGGESTIONS = [
  'Paracetamol', 'Dolo 650', 'Cetirizine', 'Azithromycin', 'Amoxicillin',
  'Augmentin 625', 'Metformin 500', 'Pantoprazole 40', 'Doxycycline',
  'Ibuprofen', 'Aspirin', 'Atorvastatin', 'Amlodipine', 'Losartan',
  'Omeprazole', 'Levothyroxine', 'Thyronorm 75', 'Insulin Glargine',
  'Montelukast', 'Cefixime', 'Ciprofloxacin', 'Pregabalin', 'Gabapentin',
]

// Availability status → badge tone + label (tones map to <StatusBadge>).
const AVAIL_META = {
  available: { tone: 'good', label: 'Available' },
  limited: { tone: 'warning', label: 'Limited' },
  unconfirmed: { tone: 'neutral', label: 'Unconfirmed' },
  unavailable: { tone: 'critical', label: 'Not available' },
}

export default function UserSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') || ''
  const [flashMsg, flash] = useFlash()

  const [mode, setMode] = useState(searchParams.get('mode') === 'scan' ? 'scan' : 'name')
  const [searchQuery, setSearchQuery] = useState(queryParam)
  const [location, setLocation] = useState(() => localStorage.getItem(LOC_KEY) || '')
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
    searchNearbyAvailability({ q, maxDistanceKm })
      .then((r) => alive && setResult(r))
      .catch(() => alive && setResult({ medicine: q, items: [], availableCount: 0, total: 0 }))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [queryParam, distanceMiles, hasSearched])

  // Autocomplete: prefix matches first, then substring matches.
  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const starts = MEDICINE_SUGGESTIONS.filter((m) => m.toLowerCase().startsWith(q))
    const contains = MEDICINE_SUGGESTIONS.filter(
      (m) => !m.toLowerCase().startsWith(q) && m.toLowerCase().includes(q),
    )
    return [...starts, ...contains].slice(0, 7)
  }, [searchQuery])

  const persistLocation = (value) => {
    setLocation(value)
    if (value) localStorage.setItem(LOC_KEY, value)
  }

  const runSearch = () => {
    setHasSearched(true)
    setShowSuggestions(false)
    setSearchParams(searchQuery.trim() ? { q: searchQuery.trim() } : {})
  }

  const selectSuggestion = (name) => {
    setSearchQuery(name)
    setShowSuggestions(false)
    setHasSearched(true)
    setSearchParams({ q: name })
  }

  // Search a medicine extracted from a scanned prescription.
  const handleScanSearch = (name) => {
    setMode('name')
    setSearchQuery(name)
    setHasSearched(true)
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
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="e.g. Doxycycline"
                    aria-label="Medicine name"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showSuggestions && suggestions.length > 0}
                    aria-controls="medicine-suggestions"
                    className="h-11 rounded-xl pl-10"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <ul
                      id="medicine-suggestions"
                      role="listbox"
                      className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-elevated"
                    >
                      {suggestions.map((s) => (
                        <li key={s} role="option" aria-selected={false}>
                          <button
                            type="button"
                            // Prevent the input's onBlur from firing before the click.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectSuggestion(s)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
                          >
                            <Pill className="size-4 shrink-0 text-primary" />
                            <span className="text-sm font-semibold text-foreground">{s}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
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
                    onChange={(e) => persistLocation(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="City, ZIP code, postcode, or current location"
                    aria-label="Search area"
                    className="h-11 rounded-xl pl-10"
                  />
                </div>
                {location ? (
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

          {/* Results — availability of the medicine at nearby pharmacies */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-bold text-foreground">
                {result?.medicine ? `${result.medicine} — availability near you` : 'Availability near you'}
              </h3>
              {hasSearched && result && items.length > 0 && (
                <Badge size="sm">{result.availableCount} of {result.total} pharmacies</Badge>
              )}
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
                    const meta = AVAIL_META[p.status] ?? AVAIL_META.unconfirmed
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
                            <StatusBadge tone={meta.tone} size="sm">{meta.label}</StatusBadge>
                          </div>

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
        </>
      )}
    </div>
  )
}
