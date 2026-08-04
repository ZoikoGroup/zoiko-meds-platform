import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, MapPin, Mic, Bell, Info, ShieldCheck, Clock, Pill, Heart,
  Network, Webhook, ArrowRight, Building2, ScanLine, Radar, Thermometer,
  Wind, Activity, HeartPulse, Flame, Droplets, Sparkles, Edit3, CheckCircle2, RotateCcw,
  AlertCircle, Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { ConfidenceBadge } from '@/components/shared/status'
import { MedicineSuggestions } from '@/components/shared/medicine-suggestions'
import { useMedicineSuggestions } from '@/hooks/use-medicine-suggestions'
import { LocationModal } from '@/components/shared/location-modal'
import { AVAILABILITY, CONFIRM_NOTE, mapsHref, telHref } from '@/lib/availability'
import { getUserOverview, listNearbyPharmacies } from '@/services/user-api'
import { matchMedicines } from '@/services/medicine-api'
import { SignalWidget } from '@/features/signal/signal-widget'
import { useLanguage } from '@/providers/language-provider'
import { cn } from '@/lib/utils'

const QUICK_CHIPS = ['Dolo 650', 'Paracetamol', 'Cetirizine', 'Azithromycin', 'Metformin']

// Icons / links for the four summary tiles; values come from the backend.
const SUMMARY_META = [
  { key: 'savedMedicines', label: 'Saved medicines', icon: Heart, to: '/saved' },
  { key: 'recentSearches', label: 'Recent searches', icon: Search, to: '/search' },
  { key: 'verifiedPharmacies', label: 'Verified pharmacies', icon: Building2, to: '/search' },
  { key: 'activeAlerts', label: 'Active alerts', icon: Bell, to: '/signal' },
]

const PIN = { high: 'var(--success)', moderate: 'var(--info)', low: 'var(--warning)', unknown: 'var(--muted-foreground)' }

// Primary tasks surfaced as attractive cards under the hero.
const QUICK_ACTIONS = [
  { title: 'Scan a prescription', desc: 'Snap or upload it — we extract the medicines for you.', icon: ScanLine, to: '/search?mode=scan', gradient: 'from-primary to-teal' },
  { title: 'Your ZoikoSignal™', desc: 'Get alerts when saved medicines run low or return.', icon: Radar, to: '/signal', gradient: 'from-violet-500 to-primary' },
  { title: 'Saved medicines', desc: 'Track availability for the medicines you follow.', icon: Heart, to: '/saved', gradient: 'from-rose-500 to-red-500' },
]

// Browse-by-need shortcuts; each opens search for a representative medicine.
const CATEGORIES = [
  { label: 'Fever & Pain', med: 'Paracetamol', icon: Thermometer },
  { label: 'Cold & Cough', med: 'Cetirizine', icon: Wind },
  { label: 'Diabetes', med: 'Metformin', icon: Activity },
  { label: 'Heart & BP', med: 'Amlodipine', icon: HeartPulse },
  { label: 'Antibiotics', med: 'Azithromycin', icon: Pill },
  { label: 'Acidity', med: 'Pantoprazole', icon: Flame },
  { label: 'Allergy', med: 'Levocetirizine', icon: Droplets },
  { label: 'Vitamins', med: 'Vitamin D3', icon: Sparkles },
]

export default function UserHome() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [showLocationDialog, setShowLocationDialog] = useState(false)
  const [showManualLoc, setShowManualLoc] = useState(false)
  const [manualLocInput, setManualLocInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [overview, setOverview] = useState(null)
  const [pharmacies, setPharmacies] = useState([])
  const [location, setLocation] = useState(
    () => localStorage.getItem('zoiko-user-loc') || '',
  )

  // Listen for location changes across settings/modals/tabs
  useEffect(() => {
    const syncLoc = () => {
      setLocation(localStorage.getItem('zoiko-user-loc') || '')
    }
    window.addEventListener('storage', syncLoc)
    window.addEventListener('zoiko-location-change', syncLoc)
    return () => {
      window.removeEventListener('storage', syncLoc)
      window.removeEventListener('zoiko-location-change', syncLoc)
    }
  }, [])

  useEffect(() => {
    let alive = true
    getUserOverview().then((d) => alive && setOverview(d)).catch(() => {})
    listNearbyPharmacies(10)
      .then((rows) => {
        if (!alive) return
        setPharmacies(rows)
        setActiveId((prev) => prev || rows[0]?.id || null)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Live MediBase™ autocomplete (debounced, backed by /medibase/match).
  const { suggestions, loading: suggLoading, error: suggError } = useMedicineSuggestions(query, { limit: 6 })
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  useEffect(() => { setActiveIndex(-1) }, [query])

  const onHeroKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      goSearch(suggestions[activeIndex].name)
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  useEffect(() => {
    if (!localStorage.getItem('zoiko-loc-permission')) {
      const t = setTimeout(() => setShowLocationDialog(true), 1000)
      return () => clearTimeout(t)
    }
  }, [])

  const goSearch = (term) => navigate(`/search?q=${encodeURIComponent(term)}`)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) goSearch(query.trim())
  }

  const allowLocation = () => {
    localStorage.setItem('zoiko-loc-permission', 'granted')
    setShowLocationDialog(false)
    if (location) {
      localStorage.setItem('zoiko-user-loc', location)
    } else {
      setShowManualLoc(true)
    }
  }

  const denyLocation = () => {
    localStorage.setItem('zoiko-loc-permission', 'denied')
    setShowLocationDialog(false)
  }

  const saveManualLocation = () => {
    if (!manualLocInput.trim()) return
    setLocation(manualLocInput.trim())
    localStorage.setItem('zoiko-user-loc', manualLocInput.trim())
    setShowManualLoc(false)
    setManualLocInput('')
  }

  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [voiceMode, setVoiceMode] = useState('idle') // 'idle' | 'listening' | 'review'

  const [mediBaseMatch, setMediBaseMatch] = useState(null) // null = idle, true = valid, false = invalid
  const [checkingMediBase, setCheckingMediBase] = useState(false)
  const [matchedName, setMatchedName] = useState('')

  useEffect(() => {
    const term = (voiceTranscript || '').trim()
    if (!term) {
      setMediBaseMatch(null)
      setCheckingMediBase(false)
      setMatchedName('')
      return
    }

    setCheckingMediBase(true)
    const t = setTimeout(async () => {
      try {
        const matches = await matchMedicines(term, 5)
        if (matches && matches.length > 0) {
          setMediBaseMatch(true)
          const lowerTerm = term.toLowerCase()
          const exactName = matches.find((m) => m.name.toLowerCase() === lowerTerm)
          const exactGeneric = matches.find((m) => m.generic.toLowerCase() === lowerTerm)
          const partialName = matches.find((m) => m.name.toLowerCase().includes(lowerTerm))
          const partialGeneric = matches.find((m) => m.generic.toLowerCase().includes(lowerTerm))

          if (exactName) {
            setMatchedName(exactName.name)
          } else if (exactGeneric) {
            setMatchedName(exactGeneric.generic)
          } else if (partialName) {
            setMatchedName(partialName.name)
          } else if (partialGeneric) {
            setMatchedName(partialGeneric.generic)
          } else {
            setMatchedName(term)
          }
        } else {
          setMediBaseMatch(false)
          setMatchedName('')
        }
      } catch (_e) {
        setMediBaseMatch(false)
        setMatchedName('')
      } finally {
        setCheckingMediBase(false)
      }
    }, 250)

    return () => clearTimeout(t)
  }, [voiceTranscript])

  const stopVoice = () => {
    if (window._zoikoRecognition) {
      try {
        window._zoikoRecognition.stop()
      } catch {
        // Already stopped or torn down by the browser — nothing to clean up.
      }
      window._zoikoRecognition = null
    }
    setIsListening(false)
    setVoiceMode('idle')
  }

  const triggerVoice = () => {
    setVoiceTranscript('')
    setVoiceError('')
    setVoiceMode('listening')
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setVoiceError('Speech recognition is not supported in this browser. Please type your search.')
      setIsListening(true)
      return
    }

    try {
      if (window._zoikoRecognition) {
        try {
          window._zoikoRecognition.abort()
        } catch {
          // A stale recognition instance that is already dead — safe to discard.
        }
      }
      const recognition = new SpeechRecognition()
      window._zoikoRecognition = recognition
      recognition.lang = 'en-US'
      recognition.continuous = false
      recognition.interimResults = true

      recognition.onstart = () => {
        setIsListening(true)
        setVoiceMode('listening')
      }

      recognition.onresult = (event) => {
        let text = ''
        let isFinal = false
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          text += event.results[i][0].transcript
          if (event.results[i].isFinal) {
            isFinal = true
          }
        }
        const clean = text.trim()
        if (clean) {
          setVoiceTranscript(clean)
          setQuery(clean)
          if (isFinal) {
            setVoiceMode('review')
            try {
              recognition.stop()
            } catch {
              // Recognition already ended itself on the final result.
            }
          }
        }
      }

      recognition.onerror = (event) => {
        if (event.error !== 'no-speech') {
          setVoiceError(`Voice error (${event.error}). Please try again or type medicine name.`)
        }
      }

      recognition.onend = () => {
        // Recognition ended
      }

      recognition.start()
      setIsListening(true)
    } catch (_err) {
      setVoiceError('Could not access microphone. Please check permissions or type medicine name.')
      setIsListening(true)
    }
  }

  const active = pharmacies.find((p) => p.id === activeId)
  const summary = overview?.summary ?? {}
  const featured = overview?.featured ?? []
  const recent = overview?.recentSearches ?? []

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      {/* ---------------------------------------------------------------- */}
      {/*  Dialogs                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={showLocationDialog} onOpenChange={setShowLocationDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="items-center text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MapPin className="size-6" />
            </div>
            <DialogTitle>Use your location?</DialogTitle>
            <DialogDescription>
              Location helps us surface nearby verified pharmacies and fresher
              availability signals. We don&apos;t store precise coordinates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-center">
            <Button variant="outline" onClick={denyLocation}>Not now</Button>
            <Button variant="teal" onClick={allowLocation}>Allow location</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location Modal with Typeahead Autocomplete & PIN Code / City Validation */}
      <LocationModal
        open={showManualLoc}
        onOpenChange={setShowManualLoc}
        currentLocation={location}
        onSave={(newLoc) => setLocation(newLoc)}
      />

      <Dialog open={isListening} onOpenChange={(open) => { if (!open) stopVoice() }}>
        <DialogContent className="sm:max-w-[420px] p-6">
          <DialogHeader className="items-center text-center flex flex-col gap-2">
            <div className={cn(
              "mx-auto flex size-14 items-center justify-center rounded-2xl transition-all",
              voiceError
                ? "bg-red-500/10 text-red-500"
                : voiceMode === 'review' && mediBaseMatch === false
                ? "bg-red-500/10 text-red-500"
                : voiceMode === 'review'
                ? "bg-teal/10 text-teal"
                : "bg-primary/10 text-primary"
            )}>
              {voiceError ? (
                <Mic className="size-6 text-red-500" />
              ) : voiceMode === 'review' && mediBaseMatch === false ? (
                <AlertCircle className="size-6 text-danger" />
              ) : voiceMode === 'review' ? (
                <CheckCircle2 className="size-6 text-teal" />
              ) : (
                <Mic className="size-6 animate-pulse text-primary" />
              )}
            </div>
            <DialogTitle className="text-lg font-bold">
              {voiceError
                ? 'Voice Search Error'
                : voiceMode === 'review' && mediBaseMatch === false
                ? 'Unrecognized Medicine'
                : voiceMode === 'review'
                ? 'Medicine Captured'
                : 'Listening…'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground text-center">
              {voiceError
                ? voiceError
                : voiceMode === 'review'
                ? 'Review or edit the captured medicine name before searching:'
                : 'Say a medicine name clearly — e.g. "Paracetamol", "Azithromycin", or "Cetirizine"'}
            </DialogDescription>
          </DialogHeader>

          {/* Interactive Editable Input box when speech is captured */}
          {voiceMode === 'review' && !voiceError && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="voice-edit-input" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground text-left">
                  Edit Medicine Name
                </label>
                {checkingMediBase ? (
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin text-teal" /> Checking MediBase™...
                  </span>
                ) : mediBaseMatch === true ? (
                  <span className="text-[11px] font-bold text-success flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-success" /> Valid MediBase™ Medicine
                  </span>
                ) : mediBaseMatch === false && voiceTranscript.trim() ? (
                  <span className="text-[11px] font-bold text-danger flex items-center gap-1">
                    <AlertCircle className="size-3 text-danger" /> Invalid Medicine
                  </span>
                ) : null}
              </div>

              <div className="relative flex items-center">
                <Input
                  id="voice-edit-input"
                  type="text"
                  value={voiceTranscript}
                  onChange={(e) => {
                    setVoiceTranscript(e.target.value)
                    setQuery(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && voiceTranscript.trim()) {
                      e.preventDefault()
                      const val = voiceTranscript.trim()
                      stopVoice()
                      goSearch(val)
                    }
                  }}
                  placeholder="Type or edit medicine name..."
                  className={cn(
                    "h-11 rounded-xl text-sm font-semibold pl-3.5 pr-10 border transition-colors",
                    mediBaseMatch === false && voiceTranscript.trim()
                      ? "border-danger focus-visible:ring-danger/20 bg-danger/5"
                      : mediBaseMatch === true
                      ? "border-success/50 focus-visible:ring-success/20 bg-success/5"
                      : "border-primary/30 focus-visible:ring-primary/20"
                  )}
                />
                <Edit3 className="absolute right-3.5 size-4 text-muted-foreground pointer-events-none" />
              </div>

              {/* Invalid Medicine Warning Banner */}
              {mediBaseMatch === false && !checkingMediBase && voiceTranscript.trim() && (
                <div className="flex items-start gap-2 rounded-xl bg-danger/10 p-2.5 text-xs text-danger border border-danger/20 leading-snug text-left mt-1">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Invalid Medicine:</span> &ldquo;{voiceTranscript}&rdquo; is not listed in the MediBase™ catalog. Please check the spelling or brand name.
                  </div>
                </div>
              )}

              {/* Valid Medicine Match Indicator */}
              {mediBaseMatch === true && matchedName && !checkingMediBase && (
                <div className="flex items-center gap-1.5 text-xs text-success font-medium text-left px-1 mt-0.5">
                  <ShieldCheck className="size-3.5 text-teal shrink-0" />
                  <span>Found in MediBase™: <strong className="font-semibold">{matchedName}</strong></span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-5 flex flex-wrap gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={stopVoice}
              className="rounded-xl text-xs flex-1 sm:flex-none"
            >
              Cancel
            </Button>

            {voiceMode === 'review' && !voiceError ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerVoice}
                  className="rounded-xl text-xs gap-1.5 flex-1 sm:flex-none"
                >
                  <RotateCcw className="size-3.5" />
                  Speak again
                </Button>
                <Button
                  variant={mediBaseMatch === false ? 'danger' : 'teal'}
                  size="sm"
                  disabled={!voiceTranscript.trim()}
                  onClick={() => {
                    const term = voiceTranscript.trim() || query.trim()
                    stopVoice()
                    if (term) goSearch(term)
                  }}
                  className="rounded-xl text-xs font-semibold gap-1.5 flex-1 sm:flex-none"
                >
                  <Search className="size-3.5" />
                  Search
                </Button>
              </>
            ) : (
              !voiceError && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  className="rounded-xl text-xs opacity-60 flex-1 sm:flex-none"
                >
                  Listening...
                </Button>
              )
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Hero                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="absolute inset-0 bg-grid opacity-60" aria-hidden />
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden />
        <div className="absolute -left-20 top-1/2 size-56 rounded-full bg-teal/10 blur-3xl" aria-hidden />

        <div className="relative flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="teal" className="gap-1.5">
              <ShieldCheck className="size-3.5" />
              Verified patient access
            </Badge>
            {location ? (
              <button
                onClick={() => setShowManualLoc(true)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/30 cursor-pointer"
              >
                <MapPin className="size-3.5 text-primary" />
                <span>{location}</span>
                <span className="text-primary font-bold ml-1">Change</span>
              </button>
            ) : (
              <button
                onClick={() => setShowManualLoc(true)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/30 cursor-pointer"
              >
                <MapPin className="size-3.5 text-muted-foreground" />
                <span className="text-primary font-bold">Set location</span>
              </button>
            )}
          </div>

          <div className="flex max-w-2xl flex-col gap-1.5">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {t('findAvailability', 'Find medicine availability near you')}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              {t('heroSubtitle', 'Search a medicine to see real-time availability confidence from verified pharmacies — powered by MediBase™ and ZoikoAvail™.')}
            </p>
          </div>

          {/* Search */}
          <div className="relative max-w-2xl">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setShowSuggestions(false)}
                  onKeyDown={onHeroKeyDown}
                  placeholder={t('searchPlaceholder', 'Search by medicine, brand, or generic — e.g. Dolo 650')}
                  aria-label="Search medicines"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={showSuggestions && (suggLoading || suggestions.length > 0)}
                  aria-controls="home-medicine-suggestions"
                  className="h-12 rounded-xl pl-11 pr-11 text-sm"
                />
                <button
                  type="button"
                  onClick={triggerVoice}
                  aria-label="Voice search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-primary"
                >
                  <Mic className="size-5" />
                </button>
                {showSuggestions && (
                  <MedicineSuggestions
                    id="home-medicine-suggestions"
                    query={query}
                    suggestions={suggestions}
                    loading={suggLoading}
                    error={suggError}
                    activeIndex={activeIndex}
                    onHover={setActiveIndex}
                    onSelect={(s) => goSearch(s.name)}
                  />
                )}
              </div>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('popularSearches', 'POPULAR:')}
              </span>
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => goSearch(chip)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { title: t('scanPrescription', 'Scan a prescription'), desc: t('scanDesc', 'Snap or upload it — we extract the medicines for you.'), icon: ScanLine, to: '/search?mode=scan', gradient: 'from-primary to-teal' },
          { title: t('yourZoikoSignal', 'Your ZoikoSignal™'), desc: t('zoikoSignalDesc', 'Get alerts when saved medicines run low or return.'), icon: Radar, to: '/signal', gradient: 'from-violet-500 to-primary' },
          { title: t('savedMedicines', 'Saved medicines'), desc: t('savedMedicinesDesc', 'Track availability for the medicines you follow.'), icon: Heart, to: '/saved', gradient: 'from-rose-500 to-red-500' },
        ].map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.title}
              onClick={() => navigate(a.to)}
              className="group flex items-start gap-3.5 rounded-2xl border border-border bg-card p-5 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', a.gradient)}>
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                  {a.title}
                  <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{a.desc}</span>
              </span>
            </button>
          )
        })}
      </section>

      {/* Governance banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('homeDisclaimer', 'Availability is a governed confidence signal from verified pharmacies — not exact stock. Please confirm with the pharmacy before visiting.')}
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { key: 'savedMedicines', label: t('savedMedicines', 'Saved medicines'), icon: Heart, to: '/saved' },
          { key: 'recentSearches', label: t('recentSearches', 'Recent searches'), icon: Search, to: '/search' },
          { key: 'verifiedPharmacies', label: t('verifiedPharmacies', 'Verified pharmacies'), icon: Building2, to: '/search' },
          { key: 'activeAlerts', label: t('activeAlerts', 'Active alerts'), icon: Bell, to: '/signal' },
        ].map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => navigate(s.to)}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-shadow hover:shadow-card"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-teal/10 text-teal">
                <Icon className="size-4.5" />
              </span>
              <span className="text-2xl font-extrabold tracking-tight text-foreground tabular">{summary[s.key] ?? 0}</span>
              <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* Browse by health need */}
      <section className="flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-4 text-teal" />
          {t('browseByHealthNeed', 'BROWSE BY HEALTH NEED')}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: t('feverPain', 'Fever & Pain'), med: 'Paracetamol', icon: Thermometer },
            { label: t('coldCough', 'Cold & Cough'), med: 'Cetirizine', icon: Wind },
            { label: t('diabetes', 'Diabetes'), med: 'Metformin', icon: Activity },
            { label: t('heartBp', 'Heart & BP'), med: 'Amlodipine', icon: HeartPulse },
            { label: t('antibiotics', 'Antibiotics'), med: 'Azithromycin', icon: Pill },
            { label: t('acidity', 'Acidity'), med: 'Pantoprazole', icon: Flame },
            { label: t('allergy', 'Allergy'), med: 'Levocetirizine', icon: Droplets },
            { label: t('vitamins', 'Vitamins'), med: 'Vitamin D3', icon: Sparkles },
          ].map((c) => {
            const Icon = c.icon
            return (
              <button
                key={c.med}
                onClick={() => goSearch(c.med)}
                className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-foreground">{c.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* How availability works + notifications */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <Card className="p-6 md:col-span-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Webhook className="size-4 text-teal" />
            {t('howAvailabilityWorksCaps', 'HOW AVAILABILITY WORKS')}
          </h3>
          <ul className="mt-4 flex flex-col gap-3">
            {[
              { icon: Network, t: t('medibaseIdentifies', 'MediBase™ identifies the medicine'), d: t('medibaseDesc', 'Brands, generics, and strengths map to one governed identity.') },
              { icon: Webhook, t: t('zoikoAvailScores', 'ZoikoAvail™ scores confidence'), d: t('zoikoAvailDescSummary', 'Verified-pharmacy signals are weighted by freshness and reliability.') },
              { icon: ShieldCheck, t: t('confirmBeforeVisiting', 'You confirm before visiting'), d: t('confirmBeforeVisitingDesc', 'We show confidence, never exact stock. Always confirm with the pharmacy.') },
            ].map((row) => {
              const Icon = row.icon
              return (
                <li key={row.t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-teal">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{row.t}</p>
                    <p className="text-xs text-muted-foreground">{row.d}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <div className="md:col-span-6">
          <SignalWidget />
        </div>
      </div>

      {/* Nearby verified pharmacies */}
      <section className="flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <MapPin className="size-4 text-teal" />
          {t('nearbyVerifiedPharmacies', 'NEARBY VERIFIED PHARMACIES')}
        </h3>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          <Card className="overflow-hidden p-0 md:col-span-8">
            <div className="relative h-[380px] w-full bg-slate-100 dark:bg-slate-900">
              <svg className="size-full" viewBox="0 0 400 400" role="img" aria-label="Map of nearby verified pharmacies">
                <path d="M0 200 H400 M200 0 V400" stroke="var(--border)" strokeWidth="8" strokeOpacity="0.5" strokeLinecap="round" />
                <path d="M0 90 L400 300" stroke="var(--border)" strokeWidth="5" strokeOpacity="0.35" strokeLinecap="round" />
                <g transform="translate(200 200)">
                  <circle r="16" fill="var(--primary)" fillOpacity="0.15" className="animate-ping" />
                  <circle r="6" fill="var(--primary)" stroke="#fff" strokeWidth="2.5" />
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
                      aria-label={`${p.name}, availability confidence ${p.confidence}`}
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
              <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-xl border border-border bg-card/90 px-3 py-2 text-xs backdrop-blur-sm">
                <span className="font-semibold text-muted-foreground">{t('confidenceLabel', 'Confidence:')}</span>
                {[[t('confidenceHigh', 'High'), 'var(--success)'], [t('confidenceModerate', 'Moderate'), 'var(--info)'], [t('confidenceLow', 'Low'), 'var(--warning)']].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ background: c }} />{l}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <div className="md:col-span-4">
            {active && (
              <Card className="flex h-full flex-col justify-between p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5 text-base font-bold text-foreground">
                        <ShieldCheck className="size-4 shrink-0 text-teal" />
                        {active.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{active.address}</span>
                    </div>
                    <Badge variant={active.open ? 'success' : 'secondary'} size="sm">
                      {active.open ? t('openNow', 'Open') : t('closed', 'Closed')}
                    </Badge>
                  </div>

                  <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('availability', 'Availability')}</span>
                      <ConfidenceBadge level={active.confidence} size="sm" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('distance', 'Distance')}</span>
                      <span className="font-semibold text-foreground tabular">{active.distance} km · {active.eta}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('lastConfirmed', 'Last confirmed')}</span>
                      <span className="font-semibold text-foreground">{active.updated}</span>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {AVAILABILITY[active.confidence]?.plain}. Confirm with the pharmacy before visiting.
                  </p>
                </div>

                <div className="mt-4 flex gap-2 border-t border-border pt-4">
                  <Button variant="outline" className="flex-1" asChild>
                    <a href={telHref(active.phone)}><Clock className="size-4" />Call</a>
                  </Button>
                  <Button className="flex-1" asChild>
                    <a href={mapsHref(`${active.name}, ${active.address}`)} target="_blank" rel="noopener noreferrer">
                      <MapPin className="size-4" />Directions
                    </a>
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* Featured medicines */}
      <section className="flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Pill className="size-4 text-teal" />
          {t('featuredMedicines', 'FEATURED MEDICINES')}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((med) => (
            <Card key={med.id ?? med.name} className="transition-shadow hover:shadow-card">
              <CardContent className="flex flex-col gap-4 py-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-foreground">{med.name}</span>
                    <span className="text-xs text-muted-foreground">{med.generic} · {med.strength}</span>
                  </div>
                  <ConfidenceBadge level={med.confidence} size="sm" />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3 text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-teal" />
                    {med.pharmacy}
                  </span>
                  <span className="font-semibold text-foreground tabular">{med.distance == null ? '—' : `${med.distance} km`}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="size-3.5" />{t('confirmed', 'Confirmed')} {med.updated}</span>
                  <button onClick={() => goSearch(med.name)} className="flex items-center gap-1 font-semibold text-primary hover:underline">
                    {t('checkAvailability', 'Check availability')} <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Recent searches */}
      {recent.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-4 text-muted-foreground" />
            {t('recentSearchesCaps', 'RECENT SEARCHES')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {recent.map((r) => (
              <button
                key={r.term}
                onClick={() => goSearch(r.term)}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-shadow hover:shadow-card"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Search className="size-4 text-muted-foreground" />
                  {r.term}
                </span>
                <span className="text-xs text-muted-foreground">{r.when}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
