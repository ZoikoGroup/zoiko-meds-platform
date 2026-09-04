import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FileText,
  Check,
  X,
  AlertCircle,
  User,
  Paperclip,
  MessageSquare,
  Loader2,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  ListFilter,
  MapPin,
  Building2,
  ClipboardList,
} from 'lucide-react'
import * as admin from '@/services/admin-api'

/**
 * What a single-value change row is called, when there is nothing to compare
 * it against. Keyed on the API's `kind`, never on the filename or the notes.
 */
/**
 * The queue card's one-line reason — shorter than the panel's label, because a
 * card has room for a few words and a reviewer is scanning, not reading.
 */
const QUEUE_REASON = {
  FIRST_TIME_VERIFICATION: 'Initial verification',
  DOCUMENT_SUBMISSION: 'Document submitted',
  DOCUMENT_REPLACEMENT: 'Document replaced',
  PHARMACY_NAME_CHANGE: 'Name change',
  LICENCE_NUMBER_CHANGE: 'Licence change',
  NAME_AND_LICENCE_CHANGE: 'Name + licence change',
  PROFILE_REVERIFICATION: 'Profile re-verification',
  REQUEST_INFO_RESPONSE: 'Responded to info request',
  UNRECORDED: 'Details not recorded',
}

const CHANGE_KIND_LABEL = {
  DOCUMENT_SUBMITTED: 'New document',
  DOCUMENT_REPLACED: 'New document',
  SUBMITTED: 'Submitted',
  CHANGED: 'Requested',
}
import { formatBytes, formatDocType } from './pharmacy/verification-document'
import {
  REQUEST_STATUS_LABEL as STATUS_LABEL,
  REQUEST_STATUS_VARIANT as STATUS_VARIANT,
  OPEN_REQUEST_STATUSES as PENDING_STATUSES,
  pharmacyRecordPath,
  queueTabFor,
} from '@/lib/verification'

export default function VerificationCenter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [queueTab, setQueueTab] = useState('PENDING')
  const [reviewNote, setReviewNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [openingDoc, setOpeningDoc] = useState(false)

  const counts = useMemo(() => {
    return {
      PENDING: requests.filter((r) => PENDING_STATUSES.includes(r.status)).length,
      APPROVED: requests.filter((r) => r.status === 'APPROVED').length,
      REJECTED: requests.filter((r) => r.status === 'REJECTED').length,
      ALL: requests.length,
    }
  }, [requests])

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (queueTab === 'PENDING') return PENDING_STATUSES.includes(r.status)
      if (queueTab === 'APPROVED') return r.status === 'APPROVED'
      if (queueTab === 'REJECTED') return r.status === 'REJECTED'
      return true
    })
  }, [requests, queueTab])

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    setError('')
    try {
      const items = await admin.listVerifications()
      setRequests(items)
    } catch (err) {
      setError(err.message || 'Failed to load verification requests')
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [])

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

  // Arriving from a Pharmacy Management link (?request=<id>): switch to a tab
  // that actually shows that request, select it, then drop the param. Held in
  // state so the auto-select effect below stands down until it has been applied
  // — otherwise it would immediately pull the selection back to the queue head.
  /**
   * Open the licence document the pharmacy uploaded.
   *
   * Fetched rather than linked: the route is SUPER_ADMIN-only, and a plain
   * anchor sends no Authorization header — the reviewer would get a 401 page
   * instead of the file. The blob URL is revoked once the tab has it.
   */
  const openDocument = async (request) => {
    if (!request?.id || openingDoc) return
    setOpeningDoc(true)
    setError('')
    try {
      const blob = await admin.getVerificationDocument(request.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err?.message || 'That document could not be opened.')
    } finally {
      setOpeningDoc(false)
    }
  }

  const [pendingFocus, setPendingFocus] = useState(
    () => searchParams.get('request') || null
  )

  useEffect(() => {
    if (!pendingFocus || requests.length === 0) return
    const target = requests.find((r) => r.id === pendingFocus)
    if (target) {
      setQueueTab(queueTabFor(target.status))
      setActiveId(target.id)
      setReviewNote('')
    }
    setPendingFocus(null)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('request')
        return next
      },
      { replace: true }
    )
  }, [pendingFocus, requests, setSearchParams])

  // Automatically keep activeId set to a valid item in the filtered list
  useEffect(() => {
    if (pendingFocus) return
    if (filteredRequests.length > 0) {
      const existsInFiltered = filteredRequests.some((r) => r.id === activeId)
      if (!existsInFiltered) {
        setActiveId(filteredRequests[0].id)
      }
    } else {
      setActiveId(null)
    }
  }, [filteredRequests, activeId, pendingFocus])

  const activeRequest = useMemo(
    () => requests.find((r) => r.id === activeId),
    [requests, activeId]
  )

  const handleAction = async (status) => {
    if (!activeRequest) return
    setBusy(true)
    setError('')
    try {
      await admin.updateVerification(activeId, {
        status,
        note: reviewNote || undefined,
      })
      setReviewNote('')
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
      await load(true)
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verification Center"
        subtitle="Verify uploaded licenses, inspect regulatory documents, and approve pharmacy sources."
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading verification queue…
        </div>
      ) : (
        <div className="@container">
          {/*
            Two columns only once the workspace column can actually hold the
            review actions on one line. `lg:grid-cols-12` was keyed to the
            viewport, so the 20rem Live Telemetry panel narrowed the col-span-7
            workspace to ~306px at 1280px without moving the breakpoint — and
            the three action buttons, which together need about 500px and are
            all `whitespace-nowrap shrink-0`, ran out of the card's left edge
            into the queue column. 60rem is the width at which col-span-7
            clears 550px.
          */}
          <div className="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-12">
            {/* Left: queue + tab filters */}
            <div className="@min-[60rem]:col-span-5 flex min-w-0 flex-col gap-4">
              <Card className="border-border/70 bg-card flex-1">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Verification Queue</CardTitle>
                    <Badge variant="outline" className="text-xs font-medium">
                      {counts.PENDING} Pending
                    </Badge>
                  </div>
                  <CardDescription>Filter requests by compliance status</CardDescription>

                  {/* Queue Filter Tabs */}
                  <div className="flex flex-wrap gap-1 pt-3 border-t mt-2">
                    <button
                      onClick={() => setQueueTab('PENDING')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        queueTab === 'PENDING'
                          ? 'bg-primary text-white'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Clock className="size-3" />
                      Pending ({counts.PENDING})
                    </button>
                    <button
                      onClick={() => setQueueTab('APPROVED')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        queueTab === 'APPROVED'
                          ? 'bg-success text-white'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <CheckCircle className="size-3" />
                      Approved ({counts.APPROVED})
                    </button>
                    <button
                      onClick={() => setQueueTab('REJECTED')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        queueTab === 'REJECTED'
                          ? 'bg-danger text-white'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <XCircle className="size-3" />
                      Rejected ({counts.REJECTED})
                    </button>
                    <button
                      onClick={() => setQueueTab('ALL')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        queueTab === 'ALL'
                          ? 'bg-foreground text-background'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <ListFilter className="size-3" />
                      All ({counts.ALL})
                    </button>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-2 p-3 max-h-[600px] overflow-y-auto">
                  {filteredRequests.length === 0 ? (
                    <div className="p-8 text-sm text-muted-foreground text-center flex flex-col items-center justify-center gap-2">
                      <CheckCircle className="size-8 text-success/70" />
                      <span>No {queueTab.toLowerCase()} verification requests.</span>
                    </div>
                  ) : (
                    filteredRequests.map((r) => {
                      const isActive = r.id === activeId
                      return (
                        <button
                          key={r.id}
                          onClick={() => {
                            setActiveId(r.id)
                            setReviewNote('')
                          }}
                          className={`w-full text-left rounded-lg p-3.5 border transition-all flex flex-col gap-1.5 ${
                            isActive
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border/80 hover:bg-accent/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm text-foreground truncate max-w-[180px]">
                              {r.pharmacy}
                            </span>
                            <Badge variant={STATUS_VARIANT[r.status] || 'secondary'}>
                              {STATUS_LABEL[r.status] || r.status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>License: {r.licenseNumber}</span>
                            <span>{new Date(r.date).toLocaleDateString()}</span>
                          </div>
                          {/* One line on why this is in the queue, so a
                              reviewer can tell a document refresh from a licence
                              change without opening every card. The label comes
                              from the API's request type; the detail stays in
                              the panel. */}
                          {r.requestTypeLabel && (
                            <span className="truncate text-left text-xs font-medium text-foreground/80">
                              {QUEUE_REASON[r.requestType] ?? r.requestTypeLabel}
                            </span>
                          )}
                        </button>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: workspace */}
            <div className="min-w-0 @min-[60rem]:col-span-7">
              {activeRequest ? (
                <Card className="border-border/70 bg-card h-full flex flex-col justify-between">
                  <div>
                    <CardHeader className="border-b pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg font-semibold">{activeRequest.pharmacy}</CardTitle>
                            <Badge variant={STATUS_VARIANT[activeRequest.status] || 'secondary'}>
                              {STATUS_LABEL[activeRequest.status] || activeRequest.status}
                            </Badge>
                          </div>
                          <CardDescription>License validation request #{activeRequest.id.slice(-6)}</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="h-fit">
                            Assigned: {activeRequest.reviewer || 'Unassigned'}
                          </Badge>
                          {/* The governance record this decision writes to. */}
                          {activeRequest.pharmacyId && (
                            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                              <Link to={pharmacyRecordPath(activeRequest.pharmacyId)}>
                                <Building2 className="size-3.5" />
                                View pharmacy record
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-6 flex flex-col gap-5 text-sm">
                      <div className="grid grid-cols-2 gap-4 border-b pb-5">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">Submitting Executive</span>
                          <span className="font-semibold text-foreground flex items-center gap-1">
                            <User className="size-4 text-muted-foreground shrink-0" />
                            {activeRequest.submittedBy}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">License Registration</span>
                          <code className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded w-fit">
                            {activeRequest.licenseNumber}
                          </code>
                        </div>
                      </div>

                      {/*
                        Why this request exists.

                        The panel showed a pharmacy, a licence, a document and a
                        status, and nothing about the submission behind them — a
                        reviewer opening a request could see a file was attached
                        and not whether it was a first submission, a replacement,
                        an answer to a question they had asked, or a licence
                        change that happened to carry a file. The only free space
                        was Reviewer Notes, which the reviewer writes themselves
                        and is therefore empty exactly when it is needed.

                        Every value here is computed by the API from recorded
                        submission facts. Nothing is read out of notes or
                        filenames.
                      */}
                      <div className="flex flex-col gap-2.5 border-b pb-5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <ClipboardList className="size-3.5" /> Submission Summary
                        </h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              Request type
                            </span>
                            <span className="text-xs font-semibold text-foreground">
                              {activeRequest.requestTypeLabel ?? 'Submission details not recorded'}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              Submitted
                            </span>
                            <span className="text-xs font-semibold text-foreground">
                              {activeRequest.date
                                ? new Date(activeRequest.date).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              Submitted by
                            </span>
                            <span className="truncate text-xs font-semibold text-foreground">
                              {activeRequest.submittedBy || '—'}
                            </span>
                          </div>
                        </div>
                        {/* Said out loud rather than left to be inferred from an
                            empty section: "no identity change" and "we have not
                            told you about the identity" look identical
                            otherwise, and only one of them is safe to approve
                            quickly. */}
                        {activeRequest.identityUnchanged &&
                          !activeRequest.isFirstTimeVerification && (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              No pharmacy identity fields were changed — the verified name and
                              licence number stand as approved.
                            </p>
                          )}
                        {activeRequest.isFirstTimeVerification && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            This pharmacy has no previously approved identity, so the details below
                            are what it is submitting for the first time.
                          </p>
                        )}
                      </div>

                      {/*
                        What the reviewer is actually being asked to decide.
                        The panel used to show one identity — the pharmacy's live
                        row, which had already been overwritten at submission —
                        under a generic note saying only that "name or licence"
                        had changed. Approving meant agreeing to something the
                        page could not name.
                      */}
                      {activeRequest.changes?.length > 0 && (
                        <div className="flex flex-col gap-2.5 border-b pb-5">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
                            <AlertCircle className="size-3.5" /> Changes Requiring Verification
                          </h4>
                          {activeRequest.reason && (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {activeRequest.reason}
                            </p>
                          )}
                          <div className="flex flex-col gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3.5">
                            {activeRequest.changes.map((change) => (
                              <div key={change.field} className="flex flex-col gap-1.5">
                                <span className="text-xs font-semibold text-foreground">
                                  {change.label}
                                </span>
                                {/* A comparison needs two values. Where the
                                    API reports no previous one — a first
                                    submission, or a replaced document whose old
                                    name the system genuinely did not keep — the
                                    single value is shown as submitted rather
                                    than as a change from "Not set", which reads
                                    as a fact about the old record. */}
                                {change.previousValue == null ? (
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                      {CHANGE_KIND_LABEL[change.kind] ?? 'Submitted'}
                                    </span>
                                    <span className="truncate text-xs font-semibold text-foreground">
                                      {change.requestedValue ?? '—'}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                        {change.field === 'verificationDocument'
                                          ? 'Previous document'
                                          : 'Current verified'}
                                      </span>
                                      {/* Struck through so the direction of the
                                          change reads without being explained. */}
                                      <span className="truncate text-xs text-muted-foreground line-through">
                                        {change.previousValue}
                                      </span>
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                        {change.field === 'verificationDocument'
                                          ? 'New document'
                                          : 'Requested'}
                                      </span>
                                      <span className="truncate text-xs font-semibold text-foreground">
                                        {change.requestedValue ?? '—'}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            The pharmacy keeps its current identity until you approve. Patients see
                            the current value, not the requested one.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-col gap-2.5 border-b pb-5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="size-3.5" /> Pharmacy Profile Address
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-muted/20 p-3.5 rounded-lg border border-border/80">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">Address Line</span>
                            <span className="font-medium text-foreground">{activeRequest.addressLine1 || '—'}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">City</span>
                            <span className="font-medium text-foreground">{activeRequest.city || '—'}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">State / Region</span>
                            <span className="font-medium text-foreground">{activeRequest.region || '—'}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">Postal Code</span>
                            <span className="font-medium text-foreground">{activeRequest.postalCode || '—'}</span>
                          </div>
                          <div className="flex flex-col gap-0.5 sm:col-span-2">
                            <span className="text-muted-foreground">Country</span>
                            <span className="font-medium text-foreground">{activeRequest.country || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uploaded Documents</h4>
                        <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-3">
                          {/*
                            Read off `document`, the VerificationDocument row
                            actually attached to this request, rather than the
                            docName column copied beside it — that copy is
                            written at upload time and a request whose copy
                            drifted offered View File on a file that is not
                            there. Nothing here consults the pharmacy's profile:
                            what the operator sees on their own page is a
                            different question from what is attached here.
                          */}
                          <div className="flex items-center gap-2.5">
                            <FileText className="size-5 text-primary shrink-0" />
                            <div className="flex flex-col">
                              <span className="font-medium text-xs text-foreground">
                                {activeRequest.document?.filename || 'No document'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {activeRequest.document
                                  ? [
                                      formatDocType(activeRequest.document.mimeType),
                                      formatBytes(activeRequest.document.sizeBytes),
                                      activeRequest.document.uploadedAt
                                        ? `uploaded ${new Date(
                                            activeRequest.document.uploadedAt,
                                          ).toLocaleDateString()}`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')
                                  : 'The pharmacy has not attached a document to this request'}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs flex gap-1"
                            disabled={!activeRequest.document || openingDoc}
                            onClick={() => openDocument(activeRequest)}
                          >
                            <Paperclip className="size-3.5" />
                            View File
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Reviewer Notes</h4>
                        <p className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-line">
                          {activeRequest.notes || 'No notes yet.'}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 pt-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="size-4" />
                          Add Reviewer Action Note
                        </label>
                        <Input
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder="Add compliance notes, clarification inquiries, or boarding details..."
                          className="text-xs py-2 h-9"
                        />
                      </div>
                    </CardContent>
                  </div>

                  <CardHeader className="border-t pt-4">
                    {/*
                      Wraps. Every Button is `whitespace-nowrap shrink-0`, so with
                      no wrap the row could only overflow — and `justify-end` sent
                      the overflow out of the left edge, over the queue column.
                    */}
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Button
                        variant="outline"
                        disabled={busy || activeRequest.status === 'REJECTED'}
                        className="border-danger/30 text-danger hover:bg-danger/5"
                        onClick={() => handleAction('REJECTED')}
                      >
                        <X className="size-4 shrink-0" />
                        Reject Application
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        className="border-warning/30 text-warning hover:bg-warning/5"
                        onClick={() => handleAction('REQUEST_INFO')}
                      >
                        <AlertCircle className="size-4 shrink-0" />
                        Request Info
                      </Button>
                      <Button
                        className="bg-success text-white hover:bg-success/95"
                        disabled={busy || activeRequest.status === 'APPROVED'}
                        onClick={() => handleAction('APPROVED')}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 shrink-0" />}
                        Approve Pharmacy
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              ) : (
                <div className="h-full flex items-center justify-center border border-dashed rounded-lg p-10 text-muted-foreground">
                  Select an application record to review compliance files.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
