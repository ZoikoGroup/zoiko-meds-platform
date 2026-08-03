import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Pill, ShieldCheck, Heart, MapPin, Navigation, Clock, Info,
  AlertTriangle, Loader2, ChevronRight, LineChart,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfidenceBadge } from '@/components/shared/status'
import { PageHeader } from '@/components/shared/page-header'
import { Seo } from '@/components/shared/seo'
import { Flash, useFlash } from '@/components/shared/flash'
import { cn } from '@/lib/utils'
import { AVAILABILITY, CONFIRM_NOTE, SCOPE_NOTE, mapsHref, byConfidence } from '@/lib/availability'
import { getMedicineById, getMedicineAvailability, matchMedicines } from '@/services/medicine-api'
import { useSavedMedicines, useSaveMedicine, useUnsaveMedicine } from '@/hooks/use-saved-medicines'

// Governance-approved FAQ (no clinical advice, dosing, or substitution guidance).
const FAQS = [
  { q: 'Does availability mean the medicine is in stock?', a: 'No. ZoikoMeds shows a governed confidence signal from verified pharmacies — not exact stock. Always confirm with the pharmacy before visiting.' },
  { q: 'Can I reserve or buy this medicine here?', a: 'No. ZoikoMeds is not a pharmacy, marketplace, or delivery service. We only help you understand where a medicine may be available.' },
  { q: 'Why do pharmacies show different confidence levels?', a: 'Confidence reflects how recent and reliable each pharmacy’s signal is. Fresher signals from highly reliable, verified pharmacies score higher.' },
  { q: 'Is this medical advice?', a: 'No. ZoikoMeds does not provide medical advice, prescribing, or substitution guidance. Speak to a qualified healthcare professional for clinical questions.' },
]

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function AlternativeCard({ med }) {
  return (
    <Link
      to={`/medicine/${med.id}`}
      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Pill className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">{med.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {[med.strength, med.form].filter(Boolean).join(' · ') || med.generic}
          </span>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

export default function MedicineDetail() {
  const { id } = useParams()
  const [flashMsg, flash] = useFlash()
  const [medicine, setMedicine] = useState(null)
  const [pharmacies, setPharmacies] = useState([])
  const [alternatives, setAlternatives] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const { data: savedMedicines = [] } = useSavedMedicines()
  const saveMutation = useSaveMedicine()
  const unsaveMutation = useUnsaveMedicine()

  const isSaved = useMemo(() => {
    if (!id || !Array.isArray(savedMedicines)) return false
    return savedMedicines.some((m) => m.id === id)
  }, [id, savedMedicines])

  const saving = saveMutation.isPending || unsaveMutation.isPending

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    getMedicineById(id)
      .then((med) => {
        if (!alive) return
        if (!med) { setError(true); return }
        setMedicine(med)
        getMedicineAvailability(id).then((rows) => alive && setPharmacies(rows)).catch(() => {})
        matchMedicines(med.generic || med.name, 12)
          .then((rows) => alive && setAlternatives(rows.filter((m) => m.id !== id)))
          .catch(() => {})
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [id])

  const handleSaveToggle = useCallback(async () => {
    if (saving) return
    if (isSaved) {
      try {
        await unsaveMutation.mutateAsync(id)
        flash('Removed from your saved medicines.')
      } catch (err) {
        flash(err?.message || 'Could not remove medicine from saved list.')
      }
    } else {
      try {
        await saveMutation.mutateAsync(id)
        flash('Added to your saved medicines.')
      } catch (err) {
        const msg = err?.message ?? ''
        if (msg.includes('already')) {
          flash('Already in your saved medicines.')
        } else if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('sign in')) {
          flash('Please sign in to save medicines.')
        } else {
          flash(`Could not save medicine: ${msg || 'Unknown error'}`)
        }
      }
    }
  }, [id, isSaved, saving, saveMutation, unsaveMutation, flash])

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !medicine) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-20 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-warning/10 text-warning">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Medicine not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          We couldn’t find this medicine in MediBase™. It may have been suppressed or the link is out of date.
        </p>
        <Button asChild><Link to="/search">Back to search</Link></Button>
      </div>
    )
  }

  const brandAlts = alternatives.filter((m) => !m.isGeneric)
  const genericAlts = alternatives.filter((m) => m.isGeneric)
  const sortedPharmacies = [...pharmacies].sort((a, b) => byConfidence(a.confidence, b.confidence))
  const bestBand = sortedPharmacies[0]?.confidence

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
      <Seo
        title={`${medicine.name} — availability & information | ZoikoMeds`}
        description={`Availability confidence, verified pharmacies, and governed identity for ${medicine.name}${medicine.generic ? ` (${medicine.generic})` : ''}. Not exact stock.`}
        type="article"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        }}
      />

      {flashMsg && <Flash message={flashMsg} />}

      <PageHeader
        eyebrow="MediBase™ identity"
        title={medicine.name}
        subtitle={medicine.description || `${medicine.generic || medicine.name} — governed medicine identity.`}
        breadcrumbs={[{ label: 'Search', to: '/search' }, { label: medicine.name }]}
        meta={
          <>
            <Badge variant={medicine.rx ? 'warning' : 'secondary'} size="sm">{medicine.rx ? 'Prescription' : 'OTC'}</Badge>
            {bestBand && <ConfidenceBadge level={bestBand} size="sm" />}
            {medicine.isGeneric && <Badge variant="outline" size="sm">Generic</Badge>}
          </>
        }
        actions={
          <>
            <Button
              variant={isSaved ? 'secondary' : 'outline'}
              onClick={handleSaveToggle}
              disabled={saving}
              className={cn(
                'transition-all duration-200',
                isSaved && 'border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600'
              )}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Heart className={cn('size-4 transition-transform active:scale-125', isSaved ? 'fill-red-500 text-red-500' : '')} />
              )}
              {isSaved ? 'Saved medicine' : 'Save medicine'}
            </Button>
            <Button asChild>
              <Link to={`/search?q=${encodeURIComponent(medicine.name)}`}>
                <MapPin className="size-4" />
                Find near me
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Medicine information */}
        <Card className="flex flex-col gap-1 p-6 lg:col-span-2">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Info className="size-4 text-primary" />
            Medicine information
          </h2>
          <InfoRow label="Brand name" value={medicine.name} />
          <InfoRow label="Generic name" value={medicine.generic} />
          <InfoRow label="Strength" value={medicine.strength} />
          <InfoRow label="Dosage form" value={medicine.form} />
          <InfoRow label="Route" value={medicine.route} />
          <InfoRow label="Manufacturer" value={medicine.manufacturer} />
          <InfoRow label="Also sold as" value={medicine.brands?.length ? medicine.brands.join(', ') : null} />
          <InfoRow label="Category" value={medicine.category?.replace(/_/g, ' ').toLowerCase()} />
        </Card>

        {/* Availability summary (historical timeline needs backend snapshots) */}
        <Card className="flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <LineChart className="size-4 text-primary" />
            Availability now
          </h2>
          {bestBand ? (
            <>
              <div className="flex items-center gap-2">
                <ConfidenceBadge level={bestBand} />
                <span className="text-sm text-muted-foreground">best signal nearby</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {AVAILABILITY[bestBand]?.plain} across {sortedPharmacies.length} verified{' '}
                {sortedPharmacies.length === 1 ? 'pharmacy' : 'pharmacies'}.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No recent availability signal for this medicine.</p>
          )}
          <p className="mt-auto flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            A historical confidence timeline arrives once the backend stores signal snapshots over time.
          </p>
        </Card>
      </div>

      {/* Available pharmacies */}
      <section className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <ShieldCheck className="size-5 text-primary" />
          Available pharmacies
          {sortedPharmacies.length > 0 && <Badge size="sm">{sortedPharmacies.length}</Badge>}
        </h2>
        {sortedPharmacies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No verified pharmacies are reporting availability for this medicine yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sortedPharmacies.map((p, i) => (
              <Card key={p.pharmacy?.id ?? i} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                      <ShieldCheck className="size-4 shrink-0 text-primary" />
                      <span className="truncate">{p.pharmacy?.name}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[p.pharmacy?.city, p.pharmacy?.region].filter(Boolean).join(', ') || '—'}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ConfidenceBadge level={p.confidence} size="sm" />
                    <span className="text-[11px] text-muted-foreground">Updated {p.updated}</span>
                  </div>
                </div>
                {p.confidence !== 'high' && (
                  <p className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning">
                    Requires confirmation — call before visiting.
                  </p>
                )}
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <a
                    href={mapsHref(`${p.pharmacy?.name}, ${[p.pharmacy?.city, p.pharmacy?.region].filter(Boolean).join(', ')}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation className="size-3.5" />
                    Directions
                  </a>
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Alternatives */}
      {(brandAlts.length > 0 || genericAlts.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {brandAlts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Brand alternatives</h2>
              <div className="flex flex-col gap-2.5">{brandAlts.slice(0, 6).map((m) => <AlternativeCard key={m.id} med={m} />)}</div>
            </section>
          )}
          {genericAlts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Generic alternatives</h2>
              <div className="flex flex-col gap-2.5">{genericAlts.slice(0, 6).map((m) => <AlternativeCard key={m.id} med={m} />)}</div>
            </section>
          )}
        </div>
      )}

      {/* FAQ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">Frequently asked questions</h2>
        <div className="flex flex-col gap-2.5">
          {FAQS.map((f) => (
            <Card key={f.q} className="flex flex-col gap-1.5 p-5">
              <span className="text-sm font-semibold text-foreground">{f.q}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{f.a}</span>
            </Card>
          ))}
        </div>
      </section>

      {/* Safety disclaimer */}
      <Card className="flex items-start gap-3 border-primary/20 bg-primary/5 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground">
          <p>{CONFIRM_NOTE}</p>
          <p className="text-muted-foreground">{SCOPE_NOTE}</p>
        </div>
      </Card>
    </div>
  )
}
