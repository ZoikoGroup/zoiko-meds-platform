import { Pill, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Bold the matched substring of `text` for the current `query`.
function Highlight({ text, query }) {
  const q = (query || '').trim()
  if (!q || !text) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-primary">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/**
 * Presentational dropdown for medicine autocomplete. Renders the full
 * lifecycle (loading / error / empty / results) and highlights the match.
 * Keyboard navigation is owned by the caller (activeIndex) so the input keeps
 * focus; hovering syncs the active row via onHover.
 */
export function MedicineSuggestions({
  id,
  query,
  suggestions = [],
  loading,
  error,
  activeIndex = -1,
  onSelect,
  onHover,
}) {
  const q = (query || '').trim()
  if (!q) return null

  return (
    <ul
      id={id}
      role="listbox"
      /* Bounded and scrollable rather than `overflow-hidden`: the list fits whole
         at the usual limits, but on a short viewport the last rows used to be cut
         off with nothing to say they were there. */
      className="absolute left-0 top-full z-20 mt-2 max-h-[min(22rem,60vh)] w-full overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 shadow-elevated"
    >
      {loading && (
        <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Searching MediBase™…
        </li>
      )}

      {!loading && error && (
        <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
          <AlertTriangle className="size-4 text-warning" /> Couldn’t load suggestions — keep typing to retry.
        </li>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <li className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-danger bg-danger/10 rounded-lg">
          <AlertTriangle className="size-4 shrink-0 text-danger" />
          <span>Invalid medicine — &ldquo;{q}&rdquo; was not found in the MediBase™ catalog.</span>
        </li>
      )}

      {!loading && !error && suggestions.map((s, idx) => (
        <li key={s.id} role="option" aria-selected={idx === activeIndex}>
          <button
            type="button"
            // Prevent the input's onBlur firing before the click registers.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover?.(idx)}
            onClick={() => onSelect(s)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
              idx === activeIndex ? 'bg-accent' : 'hover:bg-accent',
            )}
          >
            <Pill className="size-4 shrink-0 text-primary" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">
                <Highlight text={s.name} query={q} />
              </span>
              {(s.generic || s.manufacturer) && (
                <span className="truncate text-xs text-muted-foreground">
                  {[s.generic, s.manufacturer].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            {(s.strength || s.form) && (
              <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {[s.strength, s.form].filter(Boolean).join(' · ')}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
