import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, FileDown, Loader2, Moon, Package, Sun, UserRound } from 'lucide-react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, } from '@/components/ui/command'
import { allNavLinks } from '@/routes/navigation'
import { useTheme } from '@/providers/theme-provider'
import { globalSearch } from '@/services/admin-api'

// Debounced, not on every keystroke: a fast typist would otherwise fire one
// request per character for a query that is about to change again anyway.
const SEARCH_DEBOUNCE_MS = 250

export function CommandPalette({ open, onOpenChange }) {
    const navigate = useNavigate()
    const { theme, toggleTheme } = useTheme()
    // Resolved from the nav rather than written out: routes/index.jsx rewrites
    // these at runtime to sit under /admin, and the two actions removed from
    // this group were hardcoded '/enterprise' and '/reports' -- one a route that
    // does not exist anywhere, the other missing that prefix. Both navigated
    // straight to the NotFound page (MSA-39, MSA-43).
    const exportCenter = allNavLinks.find((link) => link.to.endsWith('/reports'))

    const [query, setQuery] = useState('')
    // null = nothing searched yet (short query, or just opened) — distinct
    // from "searched and found nothing," which is an empty-arrays result.
    const [results, setResults] = useState(null)
    const [searching, setSearching] = useState(false)

    const run = (fn) => {
        onOpenChange(false)
        fn()
    }

    // A stale query or yesterday's results must not flash before the operator
    // has typed anything the next time this opens.
    useEffect(() => {
        if (!open) {
            setQuery('')
            setResults(null)
            setSearching(false)
        }
    }, [open])

    // The "intelligence" half of "Search pages, actions, and intelligence…"
    // (MSA-31): this used to only ever match the static nav labels below, so a
    // real pharmacy, user, or medicine name always came back "No results
    // found," however correctly it was typed.
    useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length < 2) {
            setResults(null)
            setSearching(false)
            return
        }
        setSearching(true)
        let alive = true
        const timer = setTimeout(() => {
            globalSearch(trimmed)
                .then((data) => alive && setResults(data))
                .catch(() => alive && setResults({ users: [], pharmacies: [], medicines: [] }))
                .finally(() => alive && setSearching(false))
        }, SEARCH_DEBOUNCE_MS)
        return () => {
            alive = false
            clearTimeout(timer)
        }
    }, [query])

    const hasResults = !!results && (results.users.length > 0 || results.pharmacies.length > 0 || results.medicines.length > 0)

    return (<CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions, and intelligence…" value={query} onValueChange={setQuery}/>
      <CommandList>
        {searching && (<div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin"/>
            Searching…
          </div>)}
        <CommandEmpty>No results found.</CommandEmpty>

        {results?.pharmacies.length > 0 && (<CommandGroup heading="Pharmacies">
            {results.pharmacies.map((p) => (<CommandItem key={`ph-${p.id}`} value={`pharmacy ${p.label} ${p.sublabel}`} onSelect={() => run(() => navigate(`/admin/pharmacies?pharmacy=${p.id}`))}>
                <Building2 />
                <span className="flex flex-col">
                  {p.label}
                  {p.sublabel && <span className="text-xs text-muted-foreground">{p.sublabel}</span>}
                </span>
              </CommandItem>))}
          </CommandGroup>)}

        {results?.users.length > 0 && (<CommandGroup heading="Users">
            {results.users.map((u) => (<CommandItem key={`user-${u.id}`} value={`user ${u.label} ${u.sublabel}`} onSelect={() => run(() => navigate(`/admin/users?q=${encodeURIComponent(u.label)}`))}>
                <UserRound />
                <span className="flex flex-col">
                  {u.label}
                  {u.sublabel && <span className="text-xs text-muted-foreground">{u.sublabel}</span>}
                </span>
              </CommandItem>))}
          </CommandGroup>)}

        {results?.medicines.length > 0 && (<CommandGroup heading="Medicines">
            {results.medicines.map((m) => (<CommandItem key={`med-${m.id}`} value={`medicine ${m.label} ${m.sublabel}`} onSelect={() => run(() => navigate(`/admin/medibase/review?q=${encodeURIComponent(m.label)}`))}>
                <Package />
                <span className="flex flex-col">
                  {m.label}
                  {m.sublabel && <span className="text-xs text-muted-foreground">{m.sublabel}</span>}
                </span>
              </CommandItem>))}
          </CommandGroup>)}

        {hasResults && <CommandSeparator />}

        <CommandGroup heading="Navigate">
          {allNavLinks.map((link) => (<CommandItem key={link.to} value={link.label} onSelect={() => run(() => navigate(link.to))}>
              <link.icon />
              {link.label}
            </CommandItem>))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {exportCenter && (<CommandItem value="export report download" onSelect={() => run(() => navigate(exportCenter.to))}>
            <FileDown />
            Open export center
          </CommandItem>)}
          <CommandItem value="toggle theme appearance" onSelect={toggleTheme}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            Toggle {theme === 'dark' ? 'light' : 'dark'} mode
            <CommandShortcut>Cmd Shift L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>);
}
