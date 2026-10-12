import { useState } from 'react'
import { Loader2, Search as SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { matchMedicines } from '@/services/medicine-api'

/**
 * Asking the patient which medicine this is.
 *
 * Shown for the two states where the system has deliberately refused to decide:
 * AMBIGUOUS, where the line read cleanly but the catalog offers several
 * answers, and USER_CONFIRMATION_REQUIRED, where the handwriting itself could
 * not be read. In both, picking one automatically is the failure mode this
 * whole feature is built to avoid — "Amo... 500" has an obvious nearest
 * neighbour in the catalog, and acting on it would be guessing at somebody's
 * medication.
 *
 * Two ways out, and both end at MediBase: choose one of the candidates the
 * catalog already returned, or search the catalog for something else. Typed
 * text is a *query*, never an answer — nothing becomes verified without a
 * catalog identity behind it, so a patient cannot type "Amoxicillin" and have
 * that treated as a confirmed medicine.
 */
export function MedicineConfirmation({ medicine, onConfirm, t }) {
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const candidates = medicine.candidates ?? []
  // Catalog suggestions and search hits are the same kind of thing — a MediBase
  // identity — so they share one selection.
  const options = results ?? candidates

  const runSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError('')
    setSelected(null)
    try {
      const rows = await matchMedicines(q, 8)
      setResults(rows)
      if (!rows.length) {
        setSearchError(
          t('noCatalogMatch', 'No medicine in the ZoikoMeds catalog matches that. Check the spelling and try again.'),
        )
      }
    } catch {
      setSearchError(t('catalogSearchFailed', 'Could not search the catalog just now. Please try again.'))
    } finally {
      setSearching(false)
    }
  }

  const chosen = options.find((option) => option.id === selected) ?? null

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.04] p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{medicine.reason}</p>

      {options.length > 0 && (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('possibleMatches', 'Possible matches')}>
          {options.map((option) => (
            <li key={option.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                  selected === option.id
                    ? 'border-primary bg-primary/[0.06]'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <input
                  type="radio"
                  name={`confirm-${medicine.key}`}
                  value={option.id}
                  checked={selected === option.id}
                  onChange={() => setSelected(option.id)}
                  className="mt-0.5 size-3.5 shrink-0 accent-primary"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {option.brandName ?? option.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {/* Identity, not internal scoring — a match score means
                        nothing to a patient and invites false confidence. */}
                    {[option.genericName, option.strength, option.dosageForm, option.manufacturer]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {options.length
            ? t('searchDifferentMedicine', 'Or search for a different medicine')
            : t('searchForMedicine', 'Search for this medicine')}
        </label>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void runSearch()
              }
            }}
            placeholder={t('medicineNamePlaceholder', 'Medicine name')}
            className="h-9 text-sm"
            aria-label={t('searchForMedicine', 'Search for this medicine')}
          />
          <Button size="sm" variant="outline" onClick={runSearch} disabled={searching || !query.trim()}>
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <SearchIcon className="size-3.5" />}
            {t('search', 'Search')}
          </Button>
        </div>
        {searchError && <p className="text-[11px] text-warning">{searchError}</p>}
      </div>

      <Button
        size="sm"
        className="self-start"
        // Disabled until something from the catalog is actually selected. There
        // is deliberately no path from the text box straight to confirmed.
        disabled={!chosen}
        onClick={() => chosen && onConfirm(chosen)}
      >
        {t('confirmMedicine', 'Confirm medicine')}
      </Button>
    </div>
  )
}
