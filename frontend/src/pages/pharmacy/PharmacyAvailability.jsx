import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge, ConfidenceBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { getInventory, updateAvailability } from '@/services/pharmacy-api'
import { STATUS_META, AVAILABILITY_STATUSES } from '@/services/pharmacy-data'
import { Loader2, Clock, Search } from 'lucide-react'

export default function PharmacyAvailability() {
  const [rows, setRows] = useState(null)
  const [query, setQuery] = useState('')
  const [flashMsg, flash] = useFlash()

  useEffect(() => {
    let alive = true
    getInventory().then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [])

  const setStatus = async (m, status) => {
    setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, status, updated: 'just now' } : r)))
    await updateAvailability(m.id, status)
    flash(`${m.name} → ${STATUS_META[status].label}`)
  }

  if (!rows) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading availability…
      </div>
    )
  }

  const term = query.trim().toLowerCase()
  const visible = term
    ? rows.filter((m) => `${m.name} ${m.generic}`.toLowerCase().includes(term))
    : rows

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Availability"
        subtitle="Set the current availability for each medicine. Patients see this as a governed confidence signal — never exact stock."
      />
      {flashMsg && <Flash message={flashMsg} />}

      {/* Search */}
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search medicines…"
          aria-label="Search medicines"
          className="pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No medicines match “{query.trim()}”.
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((m) => {
          const meta = STATUS_META[m.status]
          return (
            <Card key={m.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold text-foreground">{m.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.generic} · {m.strength}</span>
                </div>
                <StatusBadge tone={meta.tone} size="sm">{meta.label}</StatusBadge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="size-3" />Updated {m.updated}</span>
                <span className="flex items-center gap-1.5">Confidence <ConfidenceBadge level={m.confidence} size="sm" /></span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 border-t border-border pt-3">
                {AVAILABILITY_STATUSES.map((s) => (
                  <Button
                    key={s.value}
                    size="sm"
                    variant={m.status === s.value ? 'default' : 'outline'}
                    onClick={() => setStatus(m, s.value)}
                    className="px-1 text-xs"
                  >
                    {s.label.replace(' Stock', '')}
                  </Button>
                ))}
              </div>
            </Card>
          )
        })}
      </div>
      )}
    </div>
  )
}
