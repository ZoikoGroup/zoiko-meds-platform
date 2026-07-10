import { useState, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import * as admin from '@/services/admin-api'

const STATUS_LABEL = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under Review',
  ESCALATED: 'Escalated',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REQUEST_INFO: 'Request Info',
}
const STATUS_VARIANT = {
  PENDING: 'secondary',
  UNDER_REVIEW: 'info',
  ESCALATED: 'destructive',
  APPROVED: 'success',
  REJECTED: 'destructive',
  REQUEST_INFO: 'warning',
}

export default function VerificationCenter() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await admin.listVerifications()
      setRequests(items)
      setActiveId((prev) => prev || items[0]?.id || null)
    } catch (err) {
      setError(err.message || 'Failed to load verification requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeRequest = requests.find((r) => r.id === activeId)

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
      await load()
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
        description="Verify uploaded licenses, inspect regulatory documents, and approve pharmacy sources."
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: queue */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <Card className="border-border/70 bg-card flex-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Verification Queue</CardTitle>
                <CardDescription>Awaiting compliance officer validation</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-3">
                {requests.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    No verification requests.
                  </p>
                )}
                {requests.map((r) => {
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
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          {/* Right: workspace */}
          <div className="lg:col-span-7">
            {activeRequest ? (
              <Card className="border-border/70 bg-card h-full flex flex-col justify-between">
                <div>
                  <CardHeader className="border-b pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg font-semibold">{activeRequest.pharmacy}</CardTitle>
                        <CardDescription>License validation request #{activeRequest.id.slice(-6)}</CardDescription>
                      </div>
                      <Badge variant="outline" className="h-fit">
                        Assigned: {activeRequest.reviewer || 'Unassigned'}
                      </Badge>
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

                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uploaded Documents</h4>
                      <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-3">
                        <div className="flex items-center gap-2.5">
                          <FileText className="size-5 text-primary shrink-0" />
                          <div className="flex flex-col">
                            <span className="font-medium text-xs text-foreground">
                              {activeRequest.docName || 'No document'}
                            </span>
                            <span className="text-[10px] text-muted-foreground">PDF document · verified upload signature</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" className="h-8 text-xs flex gap-1" asChild>
                          <a href={activeRequest.docUrl || '#'} download>
                            <Paperclip className="size-3.5" />
                            View File
                          </a>
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
                  <div className="flex items-center justify-end gap-3.5">
                    <Button
                      variant="outline"
                      disabled={busy}
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
                      disabled={busy}
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
      )}
    </div>
  )
}
