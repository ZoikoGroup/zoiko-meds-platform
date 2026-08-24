import { useState } from 'react'
import { CheckCircle2, Loader2, ScanSearch, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/providers/auth-provider'
import { submitEnterpriseInquiry, INQUIRY_TYPE } from '@/services/enterprise-api'

/**
 * "Request Security & Procurement Review" — the form behind the CTA.
 *
 * Files a real EnterpriseInquiry of type SECURITY_REVIEW, which the API routes
 * to the security-procurement queue. The button used to be inert: it rendered,
 * it depressed, and nothing was ever requested (MSA-29).
 *
 * Name and work email are prefilled from the signed-in account, because the
 * person pressing this inside the console is usually asking on their own
 * behalf — both stay editable for the case where they are not.
 */

const ORGANIZATION_TYPES = [
  'Health system',
  'Hospital',
  'Pharmacy group',
  'Wholesaler',
  'Payer / PBM',
  'Digital health platform',
  'Government / public health',
  'Manufacturer',
  'Other',
]

export function SecurityReviewDialog({ open, onOpenChange, requestSource }) {
  const { user } = useAuth()
  const [form, setForm] = useState({
    fullName: '',
    workEmail: '',
    organizationName: '',
    organizationType: ORGANIZATION_TYPES[0],
    note: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  // Prefill once per opening rather than on every render: the fields are
  // editable, and re-syncing them to the account would undo what was typed.
  const [prefilledFor, setPrefilledFor] = useState(null)

  if (open && prefilledFor !== user?.id) {
    setPrefilledFor(user?.id ?? null)
    setForm((f) => ({
      ...f,
      fullName: f.fullName || user?.name || '',
      workEmail: f.workEmail || user?.email || '',
    }))
  }

  const set = (key) => (event) =>
    setForm((f) => ({ ...f, [key]: event.target.value }))

  const close = (next) => {
    onOpenChange(next)
    if (!next) {
      // Cleared on close so a second request starts fresh rather than reopening
      // on the previous confirmation.
      setReceipt(null)
      setError('')
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await submitEnterpriseInquiry({
        type: INQUIRY_TYPE.SECURITY_REVIEW,
        fullName: form.fullName.trim(),
        workEmail: form.workEmail.trim(),
        organizationName: form.organizationName.trim(),
        organizationType: form.organizationType,
        primaryInterest: 'Security & procurement review',
        note: form.note.trim() || undefined,
        requestSource: requestSource || 'governance',
      })
      setReceipt(result)
    } catch (err) {
      setError(err.message || 'Could not send your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {receipt ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" aria-hidden />
                Request received
              </DialogTitle>
              <DialogDescription>
                {receipt.message ||
                  'Your request has been received. ZoikoMeds will route it to the appropriate team.'}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              It has been filed with the security and procurement queue. Reference{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{receipt.id}</code>.
            </p>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ScanSearch className="size-5 text-primary" aria-hidden />
                Request Security &amp; Procurement Review
              </DialogTitle>
              <DialogDescription>
                Goes to the security and procurement queue with our governance,
                security and privacy posture. Please do not include patient
                identifiers, prescription detail or credentials.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sr-name">Your name</Label>
                <Input
                  id="sr-name"
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.fullName}
                  onChange={set('fullName')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sr-email">Work email</Label>
                <Input
                  id="sr-email"
                  type="email"
                  required
                  value={form.workEmail}
                  onChange={set('workEmail')}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sr-org">Organization</Label>
                <Input
                  id="sr-org"
                  required
                  minLength={2}
                  maxLength={200}
                  placeholder="Acme Health"
                  value={form.organizationName}
                  onChange={set('organizationName')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sr-org-type">Organization type</Label>
                <select
                  id="sr-org-type"
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary"
                  value={form.organizationType}
                  onChange={set('organizationType')}
                >
                  {ORGANIZATION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sr-note">What do you need to review? (optional)</Label>
              <textarea
                id="sr-note"
                rows={3}
                maxLength={2000}
                placeholder="Security questionnaire, data residency, DPA, penetration test summary…"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                value={form.note}
                onChange={set('note')}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Send request
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
