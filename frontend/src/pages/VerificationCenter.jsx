import { useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileText, Check, X, AlertCircle, Clock, ShieldCheck, User, Paperclip, MessageSquare } from 'lucide-react'

const initialRequests = [
  {
    id: 'req-1',
    pharmacy: 'West End Health Hub',
    licenseNumber: 'LC-881273',
    submittedBy: 'Dr. Sarah Jenkins',
    date: '2025-07-08',
    status: 'Pending',
    reviewer: 'Naveen Kumar',
    docName: 'pharmacy_license_v2.pdf',
    docUrl: '#',
    notes: 'Awaiting primary authority check.'
  },
  {
    id: 'req-2',
    pharmacy: 'Sao Paulo Biopharma',
    licenseNumber: 'LC-441293',
    submittedBy: 'Marta Souza',
    date: '2025-07-07',
    status: 'Under Review',
    reviewer: 'Dr. Amara Okafor',
    docName: 'corporate_incorporation_br.pdf',
    docUrl: '#',
    notes: 'Document matches Brazil regulatory register.'
  },
  {
    id: 'req-3',
    pharmacy: 'Apex Meds Supply',
    licenseNumber: 'LC-661273',
    submittedBy: 'Marcus Vance',
    date: '2025-07-05',
    status: 'Escalated',
    reviewer: 'Dr. Amara Okafor',
    docName: 'license_compliance_apex.pdf',
    docUrl: '#',
    notes: 'Secondary board license verification required.'
  }
]

export default function VerificationCenter() {
  const [requests, setRequests] = useState(initialRequests)
  const [activeId, setActiveId] = useState(initialRequests[0]?.id)
  const [reviewNote, setReviewNote] = useState('')

  const activeRequest = requests.find((r) => r.id === activeId)

  const handleAction = (status) => {
    if (!activeRequest) return
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== activeId) return r
        return {
          ...r,
          status,
          notes: reviewNote || r.notes
        }
      })
    )
    setReviewNote('')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verification Center"
        description="Verify uploaded licenses, inspect regulatory documents, and approve pharmacy sources."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Side: Requests List Queue */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <Card className="border-border/70 bg-card flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Verification Queue</CardTitle>
              <CardDescription>Awaiting compliance officer validation</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-3">
              {requests.map((r) => {
                const isActive = r.id === activeId
                const severity = r.status === 'Pending' ? 'warning' : r.status === 'Under Review' ? 'info' : r.status === 'Approved' ? 'good' : 'critical'
                
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
                      <Badge variant={severity === 'good' ? 'default' : severity === 'warning' ? 'secondary' : 'destructive'}>
                        {r.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>License: {r.licenseNumber}</span>
                      <span>{r.date}</span>
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Detailed request workspace */}
        <div className="lg:col-span-7">
          {activeRequest ? (
            <Card className="border-border/70 bg-card h-full flex flex-col justify-between">
              <div>
                <CardHeader className="border-b pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-semibold">{activeRequest.pharmacy}</CardTitle>
                      <CardDescription>License validation request #{activeRequest.id}</CardDescription>
                    </div>
                    <Badge variant="outline" className="h-fit">
                      Assigned: {activeRequest.reviewer}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="pt-6 flex flex-col gap-5 text-sm">
                  {/* Telemetry info grid */}
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
                      <code className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded w-fit">{activeRequest.licenseNumber}</code>
                    </div>
                  </div>

                  {/* Document Box */}
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uploaded Documents</h4>
                    <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-3">
                      <div className="flex items-center gap-2.5">
                        <FileText className="size-5 text-primary shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium text-xs text-foreground">{activeRequest.docName}</span>
                          <span className="text-[10px] text-muted-foreground">PDF document · verified upload signature</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-8 text-xs flex gap-1" asChild>
                        <a href={activeRequest.docUrl} download>
                          <Paperclip className="size-3.5" />
                          View File
                        </a>
                      </Button>
                    </div>
                  </div>

                  {/* Current reviewer notes */}
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Reviewer Notes</h4>
                    <p className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                      {activeRequest.notes}
                    </p>
                  </div>

                  {/* Add action note form */}
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
                    className="border-danger/30 text-danger hover:bg-danger/5"
                    onClick={() => handleAction('Rejected')}
                  >
                    <X className="size-4 shrink-0" />
                    Reject Application
                  </Button>
                  <Button
                    variant="outline"
                    className="border-warning/30 text-warning hover:bg-warning/5"
                    onClick={() => handleAction('Request Info')}
                  >
                    <AlertCircle className="size-4 shrink-0" />
                    Request Info
                  </Button>
                  <Button
                    className="bg-success text-white hover:bg-success/95"
                    onClick={() => handleAction('Approved')}
                  >
                    <Check className="size-4 shrink-0" />
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
  )
}
