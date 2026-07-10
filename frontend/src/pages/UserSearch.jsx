import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/states'
import { ConfidenceBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { CONFIRM_NOTE, byConfidence, mapsHref, telHref } from '@/lib/availability'
import {
  Search, Heart, Bell, Navigation, Info, ShieldCheck, Phone, Clock,
  Map as MapIcon, List, LayoutGrid, SlidersHorizontal, AlertTriangle, Mic, Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* Synthetic, governed data — availability is a CONFIDENCE band, not stock. */
const MEDICINES = [
  { id: 'med-1', name: 'Dolo 650', generic: 'Paracetamol', manufacturer: 'Micro Labs Ltd', strength: '650 mg', form: 'Tablet', confidence: 'high', pharmacy: 'Apollo Pharmacy', distance: 0.9, updated: '2 min ago', rx: false, isGeneric: true, description: 'Analgesic and antipyretic used for mild-to-moderate pain and fever.', related: [] },
  { id: 'med-2', name: 'Metformin 500 mg', generic: 'Metformin', manufacturer: 'Merck & Co', strength: '500 mg', form: 'Extended-release tablet', confidence: 'moderate', pharmacy: 'MedPlus', distance: 1.4, updated: '3 hrs ago', rx: true, isGeneric: true, description: 'First-line therapy for type 2 diabetes.', related: [] },
  { id: 'med-3', name: 'Insulin Glargine', generic: 'Insulin', manufacturer: 'Sanofi', strength: '100 U/mL', form: 'Injection pen', confidence: 'low', pharmacy: 'Wellness Forever', distance: 2.1, updated: '3 days ago', rx: true, isGeneric: false, description: 'Long-acting insulin analogue for type 1 and type 2 diabetes.', related: [{ name: 'Lantus Pen', strength: '100 U/mL', confidence: 'high', pharmacy: 'Apollo Pharmacy', distance: 0.9 }, { name: 'Basaglar Pen', strength: '100 U/mL', confidence: 'moderate', pharmacy: 'Netmeds Store', distance: 1.1 }] },
  { id: 'med-4', name: 'Cetirizine 10 mg', generic: 'Cetirizine', manufacturer: 'Johnson & Johnson', strength: '10 mg', form: 'Tablet', confidence: 'high', pharmacy: 'Netmeds Store', distance: 1.1, updated: '1 hr ago', rx: false, isGeneric: true, description: 'Second-generation antihistamine for allergy symptoms.', related: [] },
]

const PHARMACIES = [
  { id: '1', name: 'Apollo Pharmacy', confidence: 'high', distance: 0.9, x: 160, y: 130, eta: '4 min', open: true, open24h: false, verified: true, address: 'Kompally Main Rd, Hyderabad', phone: '+91 40 2345 6789', updated: '2 min ago' },
  { id: '2', name: 'Netmeds Store', confidence: 'high', distance: 1.1, x: 270, y: 190, eta: '6 min', open: true, open24h: true, verified: true, address: 'Dundigal, Hyderabad', phone: '+91 40 4444 9090', updated: '1 hr ago' },
  { id: '3', name: 'MedPlus', confidence: 'moderate', distance: 1.4, x: 120, y: 250, eta: '8 min', open: true, open24h: false, verified: true, address: 'Gandimaisamma X Roads, Hyderabad', phone: '+91 40 8765 4321', updated: '3 hrs ago' },
  { id: '4', name: 'Wellness Forever', confidence: 'low', distance: 2.1, x: 310, y: 280, eta: '9 min', open: false, open24h: true, verified: false, address: 'Bowrampet, Hyderabad', phone: '+91 40 5555 1212', updated: '3 days ago' },
]

const PIN = { high: 'var(--success)', moderate: 'var(--info)', low: 'var(--warning)' }

export default function UserSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') || ''
  const [flashMsg, flash] = useFlash()

  const [searchQuery, setSearchQuery] = useState(queryParam)
  const [viewMode, setViewMode] = useState('split')
  const [selectedMed, setSelectedMed] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [urgentOnly, setUrgentOnly] = useState(searchParams.get('emergency') === 'true')
  const [maxDistance, setMaxDistance] = useState(5)
  const [filterVerified, setFilterVerified] = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [activeId, setActiveId] = useState('1')
  const [isListening, setIsListening] = useState(false)

  useEffect(() => setSearchQuery(queryParam), [queryParam])

  const parsedQuery = useMemo(
    () => queryParam.toLowerCase().replace(/near me|in hyderabad/g, '').trim(),
    [queryParam],
  )

  const meds = useMemo(() => {
    return MEDICINES.filter((m) => {
      const text = !parsedQuery || m.name.toLowerCase().includes(parsedQuery) || m.generic.toLowerCase().includes(parsedQuery) || m.manufacturer.toLowerCase().includes(parsedQuery)
      const dist = m.distance <= maxDistance
      const type = filterType === 'all' || (filterType === 'generic' && m.isGeneric) || (filterType === 'brand' && !m.isGeneric)
      return text && dist && type
    })
  }, [parsedQuery, maxDistance, filterType])

  const pharmacies = useMemo(() => {
    return PHARMACIES.filter((p) => {
      const dist = p.distance <= maxDistance
      const verified = !filterVerified || p.verified
      const urgent = !urgentOnly || p.open
      return dist && verified && urgent
    }).sort((a, b) => byConfidence(a.confidence, b.confidence))
  }, [maxDistance, filterVerified, urgentOnly])

  const active = PHARMACIES.find((p) => p.id === activeId)

  const handleSubmit = (e) => {
    e.preventDefault()
    setSearchParams(searchQuery.trim() ? { q: searchQuery } : {})
  }

  const toggleSave = (id, name) => {
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); flash(`Removed ${name} from saved`) }
      else { next.add(id); flash(`Saved ${name}`) }
      return next
    })
  }

  const triggerVoice = () => {
    setIsListening(true)
    setTimeout(() => {
      setIsListening(false)
      setSearchQuery('Metformin')
      setSearchParams({ q: 'Metformin' })
    }, 2400)
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-7xl flex-col gap-5">
      {/* Voice dialog */}
      <Dialog open={isListening} onOpenChange={setIsListening}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader className="items-center text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Mic className="size-7 animate-pulse" />
            </div>
            <DialogTitle>Listening…</DialogTitle>
            <DialogDescription>Say a medicine name.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Flash + urgent banner */}
      {flashMsg && <Flash message={flashMsg} />}
      {urgentOnly && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm font-medium text-warning">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            Urgent finder: showing open, verified pharmacies within {maxDistance} km.
          </span>
          <button onClick={() => { setUrgentOnly(false); setSearchParams({}) }} className="text-xs underline">
            Turn off
          </button>
        </div>
      )}

      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <form onSubmit={handleSubmit} className="relative flex max-w-md flex-1 items-center">
          <Search className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search medicine, brand, or generic…"
            aria-label="Search medicines"
            className="h-10 rounded-xl pl-10 pr-20"
          />
          <button type="button" onClick={triggerVoice} aria-label="Voice search" className="absolute right-[4.5rem] text-muted-foreground transition-colors hover:text-primary">
            <Mic className="size-4" />
          </button>
          <Button type="submit" size="sm" className="absolute right-1.5 h-7 rounded-lg">Search</Button>
        </form>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cn(urgentOnly && 'border-warning/30 bg-warning/5 text-warning')}
            onClick={() => setUrgentOnly((v) => !v)}
          >
            <AlertTriangle className="size-3.5" />
            Urgent
          </Button>
          <div className="flex rounded-lg border border-border bg-muted p-1">
            {[
              { key: 'split', icon: LayoutGrid, label: 'Split view', hide: 'hidden md:block' },
              { key: 'map', icon: MapIcon, label: 'Map view' },
              { key: 'list', icon: List, label: 'List view' },
            ].map((v) => {
              const Icon = v.icon
              return (
                <button
                  key={v.key}
                  onClick={() => setViewMode(v.key)}
                  aria-label={v.label}
                  aria-pressed={viewMode === v.key}
                  className={cn('rounded-md p-1.5 transition-colors', v.hide, viewMode === v.key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground')}
                >
                  <Icon className="size-4" />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 md:grid-cols-12">
        {/* Map */}
        {(viewMode === 'map' || viewMode === 'split') && (
          <Card className={cn('relative overflow-hidden p-0', viewMode === 'split' ? 'hidden md:col-span-6 md:block' : 'md:col-span-12')}>
            <div className="relative size-full bg-slate-100 dark:bg-slate-900">
              <svg className="size-full" viewBox="0 0 400 400" role="img" aria-label="Map of nearby verified pharmacies">
                <path d="M0 200 H400 M200 0 V400" stroke="var(--border)" strokeWidth="10" strokeOpacity="0.5" strokeLinecap="round" />
                <path d="M0 90 L400 300" stroke="var(--border)" strokeWidth="6" strokeOpacity="0.35" strokeLinecap="round" />
                <g transform="translate(200 200)">
                  <circle r="17" fill="var(--primary)" fillOpacity="0.15" className="animate-ping" />
                  <circle r="7" fill="var(--primary)" stroke="#fff" strokeWidth="2.5" />
                </g>
                {pharmacies.map((p) => {
                  const isActive = p.id === activeId
                  const color = PIN[p.confidence]
                  return (
                    <g
                      key={p.id}
                      transform={`translate(${p.x} ${p.y})`}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`${p.name}, confidence ${p.confidence}`}
                      onClick={() => setActiveId(p.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setActiveId(p.id))}
                    >
                      {isActive && <circle r="16" fill={color} fillOpacity="0.22" className="animate-pulse" />}
                      <path d="M0 -24 C-8 -24 -15 -18 -15 -9 C-15 0 0 11 0 11 C0 11 15 0 15 -9 C15 -18 8 -24 0 -24 Z" fill={color} stroke="#fff" strokeWidth={isActive ? 2.5 : 1.5} />
                      <circle cy="-10" r="5" fill="#fff" />
                    </g>
                  )
                })}
              </svg>

              {active && (
                <div className="absolute inset-x-3 bottom-3 flex flex-col gap-3 rounded-2xl border border-border bg-card/95 p-4 shadow-elevated backdrop-blur-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                        <ShieldCheck className="size-4 shrink-0 text-teal" />{active.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{active.address}</span>
                    </div>
                    <ConfidenceBadge level={active.confidence} size="sm" />
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="size-3.5" />{active.eta} · {active.distance} km</span>
                    <span>Confirmed {active.updated}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <a href={telHref(active.phone)}><Phone className="size-3.5" />Call</a>
                    </Button>
                    <Button size="sm" className="flex-1" asChild>
                      <a href={mapsHref(`${active.name}, ${active.address}`)} target="_blank" rel="noopener noreferrer">
                        <Navigation className="size-3.5" />Directions
                      </a>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* List */}
        {(viewMode === 'list' || viewMode === 'split') && (
          <div className={cn('flex h-full flex-col gap-4 overflow-y-auto pr-1', viewMode === 'split' ? 'md:col-span-6' : 'md:col-span-12')}>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <SlidersHorizontal className="size-3.5" /> Filters
              </span>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Range</span>
                <select value={maxDistance} onChange={(e) => setMaxDistance(Number(e.target.value))} className="rounded-md border border-border bg-card px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value={2}>≤ 2 km</option>
                  <option value={5}>≤ 5 km</option>
                  <option value={10}>≤ 10 km</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Type</span>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="all">All</option>
                  <option value="generic">Generic</option>
                  <option value="brand">Brand</option>
                </select>
              </label>
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={filterVerified} onChange={(e) => setFilterVerified(e.target.checked)} className="size-4 rounded border-input" />
                Verified only
              </label>
            </div>

            {meds.length === 0 ? (
              <EmptyState title="No matching medicine" description="Try a wider range or a different name — MediBase™ also matches generics." />
            ) : (
              <div className="flex flex-col gap-4">
                {meds.map((med) => {
                  const isSaved = savedIds.has(med.id)
                  return (
                    <motion.div key={med.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                      <Card className="p-5 transition-shadow hover:shadow-card">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground">{med.name}</span>
                            <span className="text-xs text-muted-foreground">{med.manufacturer} · {med.strength} · {med.form}</span>
                          </div>
                          <ConfidenceBadge level={med.confidence} size="sm" />
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">Nearest verified pharmacy</span>
                            <span className="flex items-center gap-1 font-semibold text-foreground">
                              <ShieldCheck className="size-3.5 text-teal" />{med.pharmacy}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-semibold text-foreground tabular">{med.distance} km</span>
                            <span className="flex items-center gap-1 text-muted-foreground"><Clock className="size-3" />{med.updated}</span>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setSelectedMed(med)}>
                            View details
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={isSaved ? 'Remove from saved' : 'Save medicine'}
                            aria-pressed={isSaved}
                            className={cn(isSaved ? 'text-danger' : 'text-muted-foreground')}
                            onClick={() => toggleSave(med.id, med.name)}
                          >
                            <Heart className={cn('size-4', isSaved && 'fill-current')} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Set availability alert"
                            className="text-muted-foreground"
                            onClick={() => flash(`Alert set for ${med.name}`)}
                          >
                            <Bell className="size-4" />
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  )
                })}
              </div>
            )}

            <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {CONFIRM_NOTE}
            </p>
          </div>
        )}
      </div>

      {/* Details dialog */}
      <Dialog open={!!selectedMed} onOpenChange={(o) => !o && setSelectedMed(null)}>
        <DialogContent className="sm:max-w-[480px]">
          {selectedMed && (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <DialogTitle>{selectedMed.name}</DialogTitle>
                    <DialogDescription>{selectedMed.manufacturer} · {selectedMed.strength}</DialogDescription>
                  </div>
                  <ConfidenceBadge level={selectedMed.confidence} size="sm" />
                </div>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 border-b border-border pb-4 text-sm">
                <Field label="Generic name" value={selectedMed.generic} />
                <Field label="Dosage form" value={selectedMed.form} />
                <Field label="Prescription" value={selectedMed.rx ? 'Required' : 'Over the counter'} />
                <Field label="Last confirmed" value={selectedMed.updated} />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">About</span>
                <p className="text-sm text-muted-foreground">{selectedMed.description}</p>
              </div>

              {selectedMed.related.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Network className="size-4 text-teal" />
                    Related identities (MediBase™)
                  </span>
                  <div className="flex flex-col gap-2">
                    {selectedMed.related.map((alt) => (
                      <div key={alt.name} className="flex items-center justify-between rounded-lg border border-border bg-card p-2.5 text-sm">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{alt.name}</span>
                          <span className="text-xs text-muted-foreground">{alt.pharmacy} · {alt.distance} km</span>
                        </div>
                        <ConfidenceBadge level={alt.confidence} size="sm" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    MediBase™ groups related medicine identities. This is not a substitution recommendation — consult a pharmacist or clinician.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedMed(null)}>Close</Button>
                <Button asChild>
                  <a href={mapsHref(`${selectedMed.pharmacy}`)} target="_blank" rel="noopener noreferrer">
                    <Navigation className="size-4" />Directions
                  </a>
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}
