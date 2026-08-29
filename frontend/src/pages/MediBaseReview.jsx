import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Flash, useFlash } from '@/components/shared/flash'
import { formatRelative } from '@/utils/format'
import {
  listJurisdictions,
  listMedicinesForAdmin,
  transitionMedicineState,
  updateMedicine,
} from '@/services/medibase-api'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

// Every quality state a medicine identity can hold. The set a given identity
// may move to from its current state is narrower — the backend enforces the
// governed transition graph and this select simply reflects whatever it
// refuses with an inline error, rather than duplicating that graph here.
const QUALITY_STATES = [
  'NEEDS_REVIEW',
  'VERIFIED',
  'MAPPED',
  'PARTNER_SUPPLIED',
  'INFERRED',
  'DEPRECATED',
  'SUPPRESSED',
]

const QUALITY_FILTERS = [
  { value: 'NEEDS_REVIEW', label: 'Needs review' },
  { value: '', label: 'All quality states' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'MAPPED', label: 'Mapped' },
  { value: 'PARTNER_SUPPLIED', label: 'Partner-supplied' },
  { value: 'INFERRED', label: 'Inferred' },
  { value: 'DEPRECATED', label: 'Deprecated' },
  { value: 'SUPPRESSED', label: 'Suppressed' },
]

const selectClass =
  'h-8 rounded-lg border border-input bg-card px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50'

export default function MediBaseReview() {
  const [searchParams] = useSearchParams()
  // Arriving from the console search bar with a medicine name already typed
  // there (MSA-31). Read once: this page owns the query from here on, the
  // same as it would if the operator had typed it into this box directly.
  const [initialQuery] = useState(() => searchParams.get('q') || '')

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [flashMsg, flash] = useFlash()

  const [search, setSearch] = useState(initialQuery)
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery)
  // A medicine found by name could be in any quality state, not only
  // NEEDS_REVIEW — the default filter would otherwise hide the very record
  // the search bar was asked to find.
  const [qualityFilter, setQualityFilter] = useState(initialQuery ? '' : 'NEEDS_REVIEW')

  // Loaded once: jurisdictions rarely change mid-session, and every row's
  // dropdown reads from the same list. Null means "still loading" so the
  // dropdown can hold that state distinct from "loaded, and empty."
  const [jurisdictions, setJurisdictions] = useState(null)

  useEffect(() => {
    listJurisdictions()
      .then(setJurisdictions)
      .catch(() => setJurisdictions([]))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listMedicinesForAdmin({
        search: debouncedSearch,
        qualityState: qualityFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setItems(res.items)
      setTotal(res.total)
      setPageCount(res.pageCount)
      setError('')
    } catch (err) {
      setError(err?.message || 'Failed to load medicine identities')
      setItems([])
      setTotal(0)
      setPageCount(1)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, qualityFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const applyJurisdiction = async (id, jurisdictionId) => {
    setBusyId(id)
    setError('')
    try {
      await updateMedicine(id, { jurisdictionId: jurisdictionId || null })
      flash('Jurisdiction updated')
      await load()
    } catch (err) {
      setError(err?.message || 'Could not update jurisdiction.')
    } finally {
      setBusyId(null)
    }
  }

  const applyQualityState = async (id, toState) => {
    setBusyId(id)
    setError('')
    try {
      await transitionMedicineState(id, { toState })
      flash(`Marked ${toState.replace('_', ' ').toLowerCase()}`)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not change the quality state.')
    } finally {
      setBusyId(null)
    }
  }

  const columns = [
    {
      key: 'canonicalName',
      header: 'Medicine',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{r.canonicalName}</span>
          <span className="text-xs text-muted-foreground">{r.genericName || '—'}</span>
        </div>
      ),
    },
    {
      key: 'strength',
      header: 'Strength / form',
      cell: (r) => <span>{[r.strength, r.dosageForm].filter(Boolean).join(' · ') || '—'}</span>,
    },
    {
      key: 'jurisdiction',
      header: 'Jurisdiction',
      cell: (r) =>
        jurisdictions === null ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : jurisdictions.length === 0 ? (
          <span className="text-xs text-muted-foreground">None configured</span>
        ) : (
          <select
            value={r.jurisdictionId || ''}
            disabled={busyId === r.id}
            onChange={(e) => applyJurisdiction(r.id, e.target.value)}
            className={selectClass}
          >
            <option value="">Unassigned</option>
            {jurisdictions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.name}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: 'qualityState',
      header: 'Quality state',
      cell: (r) => (
        <select
          value={r.qualityState}
          disabled={busyId === r.id}
          onChange={(e) => applyQualityState(r.id, e.target.value)}
          className={selectClass}
        >
          {QUALITY_STATES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{formatRelative(r.updatedAt) || '—'}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Medicine Intelligence"
        title="MediBase™ Review Queue"
        subtitle="Curate identities pharmacies introduced to the catalog — assign a jurisdiction and move each past NEEDS_REVIEW as it is verified."
        breadcrumbs={[
          { label: 'ZoikoMeds', to: '/admin/dashboard' },
          { label: 'MediBase™', to: '/admin/medibase' },
          { label: 'Review queue' },
        ]}
      />

      {flashMsg && <Flash message={flashMsg} />}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}
      {jurisdictions?.length === 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          No jurisdictions exist in this deployment yet, so identities can be governed but not
          assigned a market. Create one before curating jurisdiction assignment here.
        </div>
      )}

      <Card>
        <CardContent className="py-5">
          <DataTable
            columns={columns}
            data={items}
            getRowId={(r) => r.id}
            searchPlaceholder="Search medicines…"
            pageSize={PAGE_SIZE}
            emptyTitle={debouncedSearch ? 'No matching medicines' : 'Nothing in this queue'}
            emptyDescription={
              debouncedSearch
                ? 'No canonical name, generic name or manufacturer matches that search.'
                : 'Every identity in this filter has already been curated.'
            }
            toolbar={
              <select
                value={qualityFilter}
                onChange={(e) => {
                  setQualityFilter(e.target.value)
                  setPage(1)
                }}
                className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {QUALITY_FILTERS.map((f) => (
                  <option key={f.value || 'all'} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            }
            server={{
              query: search,
              onQueryChange: setSearch,
              page,
              pageCount,
              total,
              onPageChange: setPage,
              loading,
            }}
          />
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading medicine identities…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
