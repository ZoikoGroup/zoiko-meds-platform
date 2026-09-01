import { useState, useMemo, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CLASSIFICATION_META } from '@/lib/commercial'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Building2,
  CheckCircle2,
  Ban,
  Eye,
  Plus,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  ExternalLink,
  MapPin,
  MapPinOff,
} from 'lucide-react'
import * as admin from '@/services/admin-api'
import {
  isShortMapsLink,
  isValidCoordinate,
  parseGoogleMapsUrl,
} from '@/lib/google-maps-url'
import {
  PHARMACY_STATUS_LABEL as STATUS_LABEL,
  PHARMACY_STATUS_VARIANT as STATUS_VARIANT,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_VARIANT,
  indexRequestsByPharmacy,
  isOpenRequest,
  verificationRequestPath,
} from '@/lib/verification'

export default function PharmacyManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pharmacies, setPharmacies] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [countryFilter, setCountryFilter] = useState('All')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedPharmacy, setSelectedPharmacy] = useState(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  // The coordinate editor in the details dialog, and what it last said.
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')

  const [newForm, setNewForm] = useState({
    name: '',
    licenseNumber: '',
    addressLine1: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
    phone: '',
    availabilityScore: 100,
  })

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    setError('')
    try {
      // Verification requests are fetched alongside the records so each row can
      // show where its pharmacy sits in the review flow. A failure there must
      // not blank the table, so it degrades to "no request" instead.
      const [res, reqs] = await Promise.all([
        admin.listPharmacies({ pageSize: 200 }),
        admin.listVerifications().catch(() => []),
      ])
      setPharmacies(res.items)
      setRequests(reqs)
    } catch (err) {
      setError(err.message || 'Failed to load pharmacies')
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [])

  const requestByPharmacy = useMemo(
    () => indexRequestsByPharmacy(requests),
    [requests]
  )

  useEffect(() => {
    load()

    const handleSync = () => load(true)
    window.addEventListener('pharmacy-status-updated', handleSync)
    window.addEventListener('focus', handleSync)
    return () => {
      window.removeEventListener('pharmacy-status-updated', handleSync)
      window.removeEventListener('focus', handleSync)
    }
  }, [load])

  // Arriving from the Verification Center's "View pharmacy record" link: open
  // that record, then drop the param so a background refresh cannot reopen the
  // dialog after the reviewer closes it.
  const focusPharmacyId = searchParams.get('pharmacy')
  useEffect(() => {
    if (!focusPharmacyId || pharmacies.length === 0) return
    const match = pharmacies.find((p) => p.id === focusPharmacyId)
    if (match) {
      setSelectedPharmacy(match)
      setIsDetailsOpen(true)
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('pharmacy')
        return next
      },
      { replace: true }
    )
  }, [focusPharmacyId, pharmacies, setSearchParams])

  const run = useCallback(
    async (action) => {
      setError('')
      try {
        await action()
        window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
        await load(true)
      } catch (err) {
        setError(err.message || 'Action failed')
      }
    },
    [load]
  )

  // The jurisdiction a pharmacy's country already resolves to on save, when it
  // has one — falling back to its raw country text for a pharmacy still
  // waiting on that (no country set yet, or one that never resolved to a
  // known jurisdiction). Grouping on this instead of the raw text is what
  // keeps "India" / "india" / "IN" from listing as three separate locations
  // (MSA-32).
  const locationKey = (p) => p.jurisdiction?.code || p.country || null

  const locationOptions = useMemo(() => {
    const labelByKey = new Map()
    pharmacies.forEach((p) => {
      const key = locationKey(p)
      if (key && !labelByKey.has(key)) labelByKey.set(key, p.jurisdiction?.name || p.country)
    })
    return [
      { value: 'All', label: 'All Locations' },
      ...[...labelByKey.entries()].map(([value, label]) => ({ value, label })),
    ]
  }, [pharmacies])

  const filteredPharmacies = useMemo(() => {
    return pharmacies.filter((p) => {
      const matchStatus = statusFilter === 'All' || p.status === statusFilter
      const matchCountry = countryFilter === 'All' || locationKey(p) === countryFilter
      return matchStatus && matchCountry
    })
  }, [pharmacies, statusFilter, countryFilter])

  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedIds(next)
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredPharmacies.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredPharmacies.map((p) => p.id)))
  }

  const bulk = (status) =>
    run(() => admin.bulkPharmacyStatus([...selectedIds], status)).then(() =>
      setSelectedIds(new Set())
    )

  /**
   * Approve a pharmacy through its verification request whenever it has one.
   *
   * Flipping the pharmacy record directly would leave the request behind with
   * no decision, no reviewer note and no notification to the pharmacy user —
   * the record would read VERIFIED while the queue still showed it pending.
   * Deciding the request moves both together, because the backend sets the
   * pharmacy to VERIFIED as part of approving. This also re-syncs a record that
   * has already drifted from its request. Only pharmacies with no request at
   * all use the direct verify endpoint.
   */
  const approve = (row, note = 'Approved from Pharmacy Management.') => {
    const request = requestByPharmacy.get(row.id)
    return run(() =>
      request
        ? admin.updateVerification(request.id, { status: 'APPROVED', note })
        : admin.verifyPharmacy(row.id)
    )
  }

  // Bulk deliberately only routes *open* requests through review: re-deciding
  // an already-closed one would fire another "verification approved" notice at
  // the pharmacy user for every row in the selection.
  const bulkApprove = () =>
    run(async () => {
      const ids = [...selectedIds]
      const throughReview = ids.filter((id) =>
        isOpenRequest(requestByPharmacy.get(id)?.status)
      )
      for (const id of throughReview) {
        await admin.updateVerification(requestByPharmacy.get(id).id, {
          status: 'APPROVED',
          note: 'Approved from Pharmacy Management (bulk action).',
        })
      }
      const direct = ids.filter((id) => !throughReview.includes(id))
      if (direct.length) await admin.bulkPharmacyStatus(direct, 'VERIFIED')
    }).then(() => setSelectedIds(new Set()))

  const toggleSuspend = (row) =>
    run(() =>
      row.status === 'SUSPENDED'
        ? admin.verifyPharmacy(row.id)
        : admin.suspendPharmacy(row.id)
    )

  const handleAddPharmacy = async (e) => {
    e.preventDefault()
    // City and country are required (MSA-33): without them geocoding has
    // nothing to resolve, so the pharmacy would save with no coordinates and
    // be invisible to every distance-bounded patient search.
    if (!newForm.name || !newForm.licenseNumber || !newForm.city || !newForm.country) return
    await run(() => admin.createPharmacy(newForm))
    setIsAddOpen(false)
    setNewForm({
      name: '',
      licenseNumber: '',
      addressLine1: '',
      city: '',
      region: '',
      postalCode: '',
      country: '',
      phone: '',
      availabilityScore: 100,
    })
  }

  /**
   * Put a pharmacy on the map.
   *
   * A pharmacy with no coordinates passes every check this console displays and
   * is still invisible to patients: distance-bounded search drops it before it
   * is ranked. Correcting that needed a database client until now.
   *
   * Accepts either a "lat, lng" pair or a Google Maps URL with coordinates in
   * it, because the second is what someone actually has to hand — you look the
   * branch up on Maps, right-click the shopfront, and copy. Short goo.gl links
   * carry no coordinates until their redirect is followed, so those are asked
   * to be expanded first rather than silently failing.
   */
  const handleSetPin = async (pharmacy) => {
    setPinError('')
    const raw = pinInput.trim()
    if (!raw) return

    if (isShortMapsLink(raw)) {
      setPinError(
        'Short maps links (maps.app.goo.gl) do not carry coordinates. Open it in a ' +
          'browser and paste the full URL, or paste the "lat, lng" pair.',
      )
      return
    }

    // Handles both forms already: a bare "lat, lng" pair and the coordinates
    // embedded in a full Maps URL.
    const parsed = parseGoogleMapsUrl(raw)

    if (!parsed || !isValidCoordinate(parsed.latitude, parsed.longitude)) {
      setPinError('Could not read a coordinate pair out of that. Paste "lat, lng" or a full Google Maps URL.')
      return
    }

    try {
      const updated = await admin.updatePharmacy(pharmacy.id, {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
      })
      // The dialog is rendered from this object, so it has to carry the new pin
      // or the panel keeps showing "not located" over a pharmacy that now is.
      setSelectedPharmacy(updated)
      setPinInput('')
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
      await load(true)
    } catch (err) {
      // The backend refuses a pin that sits in a different city from the
      // address on the record; that message names the distance, so show it.
      setPinError(err.message || 'Could not save that location.')
    }
  }

  const columns = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={selectedIds.size > 0 && selectedIds.size === filteredPharmacies.length}
          onChange={handleSelectAll}
          className="rounded border-border/80 accent-primary"
        />
      ),
      cell: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => handleToggleSelect(row.id)}
          className="rounded border-border/80 accent-primary"
        />
      ),
    },
    {
      key: 'name',
      header: 'Pharmacy Name',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <span>{row.name}</span>
        </div>
      ),
    },
    {
      // Commercial standing, separate from verification status: a pharmacy can be
      // verified and still non-billable (ZM-COM-BILL-001).
      key: 'commercial',
      header: 'Commercial',
      cell: (row) => {
        const plan = CLASSIFICATION_META[row.commercialClassification]
        if (!plan) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={plan.variant} size="sm">{plan.label}</Badge>
            {plan.billable && (
              <span className="text-[11px] font-medium text-warning">billable</span>
            )}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] || 'secondary'}>
          {STATUS_LABEL[row.status] || row.status}
        </Badge>
      ),
    },
    {
      key: 'verification',
      header: 'Verification Request',
      cell: (row) => {
        const request = requestByPharmacy.get(row.id)
        if (!request) {
          return <span className="text-xs text-muted-foreground">No request</span>
        }
        return (
          <Link
            to={verificationRequestPath(request.id)}
            className="group inline-flex items-center gap-1.5"
            title="Open this request in the Verification Center"
          >
            <Badge variant={REQUEST_STATUS_VARIANT[request.status] || 'secondary'}>
              {REQUEST_STATUS_LABEL[request.status] || request.status}
            </Badge>
            <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        )
      },
    },
    {
      key: 'licenseNumber',
      header: 'License Number',
      cell: (row) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {row.licenseNumber || '—'}
        </code>
      ),
    },
    {
      key: 'city',
      header: 'Location',
      // The address AND whether the pharmacy is actually on the map.
      //
      // Every rule that hides a pharmacy from patient search reads latitude and
      // longitude, and this console showed neither — so a pharmacy with no pin
      // looked completely healthy here while being invisible to every patient,
      // and there was no way to tell the two apart without querying the
      // database. "Not located" is the single most common reason a verified,
      // participating pharmacy returns no results.
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {[row.addressLine1, row.city, row.region, row.postalCode, row.country].filter(Boolean).join(', ') || '—'}
          </span>
          {!row.located ? (
            <Badge variant="destructive" className="w-fit gap-1">
              <MapPinOff className="size-3" />
              Not located — hidden from search
            </Badge>
          ) : row.locationPrecision === 'APPROXIMATE' ? (
            <span
              className="inline-flex w-fit items-center gap-1 text-[11px] text-warning"
              title="Placed by geocoding the area, not the street address. Distances shown to patients are approximate."
            >
              <MapPin className="size-3" />
              Approximate · {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
            </span>
          ) : (
            <span className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground tabular">
              <MapPin className="size-3" />
              {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'availabilityScore',
      header: 'Reliability Score',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full ${row.availabilityScore > 85 ? 'bg-success' : row.availabilityScore > 60 ? 'bg-warning' : 'bg-danger'}`}
              style={{ width: `${row.availabilityScore}%` }}
            />
          </div>
          <span className="font-semibold text-xs text-foreground tabular">
            {row.availabilityScore}%
          </span>
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last Sync',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.updatedAt).toLocaleString()}
        </span>
      ),
    },
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Statuses</option>
        <option value="VERIFIED">Verified</option>
        <option value="INFO_REQUESTED">Information Requested</option>
        <option value="PENDING">Pending</option>
        <option value="SUSPENDED">Suspended</option>
        <option value="REJECTED">Rejected</option>
        <option value="UNVERIFIED">Unverified</option>
      </select>

      <select
        value={countryFilter}
        onChange={(e) => setCountryFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        {locationOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <Button
        size="sm"
        onClick={() => setIsAddOpen(true)}
        className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center"
      >
        <Plus className="size-3.5" />
        Add Pharmacy
      </Button>
    </div>
  )

  const rowActions = (row) => {
    const request = requestByPharmacy.get(row.id)
    return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setSelectedPharmacy(row)
          setIsDetailsOpen(true)
        }}
        title="View record"
      >
        <Eye className="size-4" />
      </Button>
      {request && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={isOpenRequest(request.status) ? 'text-warning' : 'text-muted-foreground'}
          asChild
          title={
            isOpenRequest(request.status)
              ? 'Review the open verification request'
              : 'View the decided verification request'
          }
        >
          <Link to={verificationRequestPath(request.id)}>
            <ShieldCheck className="size-4" />
          </Link>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className={row.status === 'SUSPENDED' ? 'text-success' : 'text-danger'}
        onClick={() => toggleSuspend(row)}
        title={row.status === 'SUSPENDED' ? 'Verify' : 'Suspend'}
      >
        {row.status === 'SUSPENDED' ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
      </Button>
    </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pharmacy Governance & Management"
        description="Verify licensing compliance, audit inventory streams, and toggle operational permissions."
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {selectedIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm"
        >
          <span className="font-semibold text-primary">
            {selectedIds.size} pharmacies selected for bulk action
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={bulkApprove} className="bg-success text-white hover:bg-success/95">
              Approve All
            </Button>
            <Button size="sm" onClick={() => bulk('SUSPENDED')} className="bg-danger text-white hover:bg-danger/95">
              Suspend All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </motion.div>
      )}

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading pharmacies…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredPharmacies}
              getRowId={(row) => row.id}
              searchable
              searchPlaceholder="Search by pharmacy name or license..."
              searchAccessor={(row) => `${row.name} ${row.licenseNumber || ''}`}
              toolbar={toolbar}
              rowActions={rowActions}
            />
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Pharmacy Record Details</DialogTitle>
            <DialogDescription>
              Platform governance log for {selectedPharmacy?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedPharmacy && (
            <div className="grid gap-4 py-4 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Verification status</span>
                <Badge variant={STATUS_VARIANT[selectedPharmacy.status] || 'secondary'}>
                  {STATUS_LABEL[selectedPharmacy.status] || selectedPharmacy.status}
                </Badge>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">License Registration</span>
                <code>{selectedPharmacy.licenseNumber || '—'}</code>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Headquarters Location</span>
                <span className="text-right max-w-[240px] font-medium">{[selectedPharmacy.addressLine1, selectedPharmacy.city, selectedPharmacy.region, selectedPharmacy.postalCode, selectedPharmacy.country].filter(Boolean).join(', ') || '—'}</span>
              </div>
              {/* Map position — the column patient search actually filters on. */}
              <div className="flex flex-col gap-2 border-b pb-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Map position</span>
                  {selectedPharmacy.located ? (
                    <span className="text-right font-medium tabular">
                      {selectedPharmacy.latitude.toFixed(5)}, {selectedPharmacy.longitude.toFixed(5)}
                      {selectedPharmacy.locationPrecision === 'APPROXIMATE' && (
                        <span className="ms-1 text-xs font-normal text-warning">(approximate)</span>
                      )}
                    </span>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <MapPinOff className="size-3" />
                      Not located
                    </Badge>
                  )}
                </div>
                {!selectedPharmacy.located && (
                  <p className="text-xs text-muted-foreground">
                    Patient search is distance-bounded, so this pharmacy is returned to
                    nobody until it has a position — whatever its verification status says.
                  </p>
                )}
                {selectedPharmacy.locationPrecision === 'APPROXIMATE' && (
                  <p className="text-xs text-muted-foreground">
                    Placed by geocoding the area rather than the street address. Patients
                    see its distance as approximate; a precise pin replaces it.
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-xs"
                    placeholder='"28.6139, 77.2090" or a Google Maps URL'
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    disabled={!pinInput.trim()}
                    onClick={() => handleSetPin(selectedPharmacy)}
                  >
                    <MapPin className="size-3.5" />
                    Set
                  </Button>
                </div>
                {pinError && <p className="text-xs text-danger">{pinError}</p>}
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Availability Engine Score</span>
                <span className="font-semibold">{selectedPharmacy.availabilityScore}%</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Last Database Sync</span>
                <span>{new Date(selectedPharmacy.updatedAt).toLocaleString()}</span>
              </div>

              {/* The review side of the same flow, so the two never look unrelated. */}
              {(() => {
                const request = requestByPharmacy.get(selectedPharmacy.id)
                if (!request) {
                  return (
                    <div className="flex justify-between pb-1">
                      <span className="text-muted-foreground">Verification request</span>
                      <span className="text-xs text-muted-foreground">
                        None on file
                      </span>
                    </div>
                  )
                }
                return (
                  <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Verification request
                      </span>
                      <Badge variant={REQUEST_STATUS_VARIANT[request.status] || 'secondary'}>
                        {REQUEST_STATUS_LABEL[request.status] || request.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Submitted by</span>
                      <span className="max-w-[240px] truncate text-right font-medium">
                        {request.submittedBy}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Reviewer</span>
                      <span className="font-medium">{request.reviewer || 'Unassigned'}</span>
                    </div>
                    <Button variant="outline" size="sm" className="mt-1 h-8 text-xs" asChild>
                      <Link to={verificationRequestPath(request.id)}>
                        <ShieldCheck className="size-3.5" />
                        {isOpenRequest(request.status)
                          ? 'Review in Verification Center'
                          : 'Open in Verification Center'}
                      </Link>
                    </Button>
                  </div>
                )
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
              Close
            </Button>
            {selectedPharmacy?.status !== 'VERIFIED' && (
              <Button
                onClick={() => {
                  approve(selectedPharmacy)
                  setIsDetailsOpen(false)
                }}
              >
                {isOpenRequest(requestByPharmacy.get(selectedPharmacy?.id)?.status)
                  ? 'Approve & Close Request'
                  : 'Approve Pharmacy'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Pharmacy Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Register New Pharmacy</DialogTitle>
            <DialogDescription>
              Enroll a pharmacy source under platform governance rules.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPharmacy} className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Pharmacy Corporate Name</label>
              <Input
                value={newForm.name}
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                placeholder="e.g. HealthBridge Pharmacy"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">License Number</label>
              <Input
                value={newForm.licenseNumber}
                onChange={(e) => setNewForm({ ...newForm, licenseNumber: e.target.value })}
                placeholder="e.g. LC-109283"
                required
              />
            </div>
            {/* The branch's own street address. Coordinates are geocoded from
                the whole address — city and country alone resolve to the city
                centre, which would put every branch in town on one map pin. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Street address</label>
              <Input
                value={newForm.addressLine1}
                onChange={(e) => setNewForm({ ...newForm, addressLine1: e.target.value })}
                placeholder="e.g. 214 W Kinzie St"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">City</label>
                <Input
                  value={newForm.city}
                  onChange={(e) => setNewForm({ ...newForm, city: e.target.value })}
                  placeholder="e.g. Chicago"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">State / region</label>
                <Input
                  value={newForm.region}
                  onChange={(e) => setNewForm({ ...newForm, region: e.target.value })}
                  placeholder="e.g. Illinois"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Postal code</label>
                <Input
                  value={newForm.postalCode}
                  onChange={(e) => setNewForm({ ...newForm, postalCode: e.target.value })}
                  placeholder="e.g. 60654"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Country</label>
                <Input
                  value={newForm.country}
                  onChange={(e) => setNewForm({ ...newForm, country: e.target.value })}
                  placeholder="e.g. United States"
                  required
                />
              </div>
            </div>
            {/* Shown to patients on this pharmacy's search result. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Contact number</label>
              <Input
                value={newForm.phone}
                onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })}
                placeholder="e.g. +1 312 555 0142"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Submit Enrollment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
