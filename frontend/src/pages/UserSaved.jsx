import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'
import { ConfidenceBadge } from '@/components/shared/status'
import { Flash, useFlash } from '@/components/shared/flash'
import { mapsHref } from '@/lib/availability'
import { listSaved, unsaveMedicine } from '@/services/user-api'
import { Search, Trash2, ShieldCheck, Clock, Heart, Navigation, Loader2 } from 'lucide-react'

export default function UserSaved() {
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [flashMsg, flash] = useFlash()
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    listSaved()
      .then((rows) => alive && setSaved(rows))
      .catch((err) => alive && flash(err.message || 'Could not load saved medicines'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = async (id, name) => {
    const prev = saved
    setSaved((rows) => rows.filter((m) => m.id !== id)) // optimistic
    try {
      await unsaveMedicine(id)
      flash(`Removed ${name} from saved`)
    } catch (err) {
      setSaved(prev) // revert
      flash(err.message || 'Could not remove medicine')
    }
  }

  const distanceLabel = (d) => (d == null ? '—' : `${d} km`)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Saved medicines"
        subtitle="Track availability confidence for the medicines you follow across verified pharmacies."
      />

      {flashMsg && <Flash message={flashMsg} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your saved medicines…
        </div>
      ) : saved.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No saved medicines yet"
          description="Save a medicine from search to track its availability confidence here."
          action={
            <Button onClick={() => navigate('/search')}>
              <Search className="size-4" />
              Search medicines
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((med) => (
            <Card key={med.id} className="transition-shadow hover:shadow-card">
              <CardContent className="flex flex-col gap-4 py-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-foreground">{med.name}</span>
                    <span className="text-xs text-muted-foreground">{med.generic} · {med.strength}</span>
                  </div>
                  <ConfidenceBadge level={med.confidence} size="sm" />
                </div>

                <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3 text-xs">
                  <span className="flex items-center justify-between">
                    <span className="text-muted-foreground">Pharmacy</span>
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <ShieldCheck className="size-3.5 text-teal" />{med.pharmacy}
                    </span>
                  </span>
                  <span className="flex items-center justify-between">
                    <span className="text-muted-foreground">Distance</span>
                    <span className="font-semibold text-foreground tabular">{distanceLabel(med.distance)}</span>
                  </span>
                  <span className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last confirmed</span>
                    <span className="flex items-center gap-1 font-semibold text-foreground"><Clock className="size-3" />{med.updated}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/search?q=${encodeURIComponent(med.name)}`)}>
                    <Search className="size-3.5" />
                    Check availability
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Directions to ${med.pharmacy}`} asChild>
                    <a href={mapsHref(med.pharmacy)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground">
                      <Navigation className="size-4" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="text-danger hover:bg-danger/5" aria-label={`Remove ${med.name}`} onClick={() => remove(med.id, med.name)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
