import { useState, useEffect } from 'react'
import { MapPin, Search, Check, AlertCircle, Sparkles, Loader2, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { validateLocationLive } from '@/lib/location-api'
import { cn } from '@/lib/utils'

export function LocationModal({ open, onOpenChange, currentLocation = '', onSave }) {
  const [inputVal, setInputVal] = useState(currentLocation)
  const [errorMsg, setErrorMsg] = useState('')
  const [isNetworkError, setIsNetworkError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [recentLocations, setRecentLocations] = useState([])

  // Sync initial input value & load recent locations when dialog opens
  useEffect(() => {
    if (open) {
      setInputVal(currentLocation || '')
      setErrorMsg('')
      setIsNetworkError(false)
      setShowDropdown(false)
      setSuggestions([])

      // Load recent saved locations from localStorage
      try {
        const saved = JSON.parse(localStorage.getItem('zoiko-recent-locations') || '[]')
        setRecentLocations(Array.isArray(saved) ? saved : [])
      } catch {
        setRecentLocations([])
      }
    }
  }, [open, currentLocation])

  // Debounced API call (350ms) to fetch typeahead suggestions from Live API
  useEffect(() => {
    if (!inputVal.trim() || inputVal.trim().length < 2) {
      setSuggestions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrorMsg('')
    setIsNetworkError(false)

    const timer = setTimeout(async () => {
      const res = await validateLocationLive(inputVal)
      setIsLoading(false)

      if (res.error) {
        setIsNetworkError(true)
        setErrorMsg(res.message || 'Network issue reaching location service.')
        setSuggestions([])
      } else if (res.isValid && res.suggestions) {
        setSuggestions(res.suggestions)
      } else {
        setSuggestions([])
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [inputVal])

  const handleInputChange = (e) => {
    setInputVal(e.target.value)
    setErrorMsg('')
    setIsNetworkError(false)
    setShowDropdown(true)
  }

  const handleSelectSuggestion = (locName) => {
    setInputVal(locName)
    setErrorMsg('')
    setShowDropdown(false)
  }

  const saveLocation = async (targetVal = inputVal) => {
    if (!targetVal || !targetVal.trim()) {
      setErrorMsg('Please enter a city, area, or 6-digit PIN code.')
      return
    }

    setIsSaving(true)
    setErrorMsg('')
    setIsNetworkError(false)

    const res = await validateLocationLive(targetVal)
    setIsSaving(false)

    if (res.error) {
      setIsNetworkError(true)
      setErrorMsg(res.message || 'Network error verifying location. Please retry.')
      return
    }

    if (!res.isValid) {
      setErrorMsg(res.message || `No matching location found for "${targetVal}".`)
      return
    }

    const finalFormatted = res.formatted || targetVal

    // Update recent locations in localStorage
    try {
      const existing = JSON.parse(localStorage.getItem('zoiko-recent-locations') || '[]')
      const updated = [finalFormatted, ...existing.filter((item) => item !== finalFormatted)].slice(0, 5)
      localStorage.setItem('zoiko-recent-locations', JSON.stringify(updated))
    } catch {
      // Ignore localStorage parse errors
    }

    localStorage.setItem('zoiko-user-loc', finalFormatted)
    localStorage.setItem('zoiko-loc-permission', 'granted')
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('zoiko-location-change'))
    onSave && onSave(finalFormatted)
    onOpenChange(false)
    setErrorMsg('')
    setShowDropdown(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-6 shadow-2xl rounded-2xl border-border bg-card">
        <DialogHeader className="flex flex-col items-center text-center gap-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MapPin className="size-6 text-teal" />
          </div>
          <DialogTitle className="text-lg font-bold text-foreground">
            Set your delivery location
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Enter a city, area, or 6-digit PIN code to check live medicine availability.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-2 flex flex-col gap-3">
          {/* Location Input Box with Live Spinner */}
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 size-4 text-muted-foreground" />
            <Input
              type="text"
              value={inputVal}
              onChange={handleInputChange}
              onFocus={() => setShowDropdown(true)}
              placeholder="e.g. Austin, TX, Nizampet, or 500043"
              disabled={isSaving}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveLocation()
                }
              }}
              className={cn(
                'h-11 pl-10 pr-10 text-xs font-medium rounded-xl border border-input bg-background shadow-xs focus-visible:ring-2 focus-visible:ring-primary/20',
                errorMsg && 'border-red-500 focus-visible:ring-red-500/20'
              )}
            />
            {isLoading && (
              <Loader2 className="absolute right-3.5 size-4 animate-spin text-teal shrink-0" />
            )}
          </div>

          {/* Validation Error Message & Network Retry Button */}
          {errorMsg && (
            <div className="flex items-start justify-between gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-500 border border-red-500/20 leading-snug">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {isNetworkError && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => saveLocation()}
                  className="h-6 px-2 text-[11px] font-semibold text-red-500 hover:bg-red-500/20 cursor-pointer shrink-0 gap-1"
                >
                  <RefreshCw className="size-3" />
                  Retry
                </Button>
              )}
            </div>
          )}

          {/* Autocomplete Typeahead Dropdown */}
          {showDropdown && suggestions.length > 0 && (
            <div className="absolute top-12 left-0 right-0 z-50 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-2xl text-popover-foreground">
              <div className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
                Live Geocoding Suggestions
              </div>
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => handleSelectSuggestion(s.name)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-muted/70 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MapPin className="size-3.5 text-teal shrink-0" />
                    <span className="truncate font-medium text-foreground">{s.name}</span>
                  </div>
                  {s.pin && <span className="font-mono text-[10px] text-muted-foreground shrink-0">{s.pin}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Dynamically Loaded Recent Searches / Popular Locations */}
          {recentLocations.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                <Sparkles className="size-3 text-amber-500" />
                Recent locations:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {recentLocations.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleSelectSuggestion(chip)}
                    className="rounded-lg bg-muted/60 hover:bg-teal/10 hover:text-teal px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors border border-border/50 cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 flex gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl text-xs" disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="teal" onClick={() => saveLocation()} className="rounded-xl text-xs font-semibold" disabled={isSaving || isLoading}>
            {isSaving ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Verifying...
              </>
            ) : (
              'Save location'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
