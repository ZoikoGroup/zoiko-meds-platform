import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shown on pharmacy-portal surfaces when the signed-in account has no pharmacy
 * linked yet. Those endpoints answer 403, and the portal used to fall back to
 * demo stock — which reads as the operator's own inventory. This states the real
 * situation and points at the one action that resolves it.
 */
export function PharmacyOnboardingState({ title, description, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Building2 className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-sm font-semibold">
        {title || 'Your pharmacy is not set up yet'}
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {description ||
          'Add your pharmacy name, licence number and address so the ZoikoMeds team can verify you. Once verified, this page shows your live data.'}
      </p>
      <Button asChild size="sm" className="mt-5">
        <Link to="/pharmacy/profile">Complete pharmacy profile</Link>
      </Button>
    </div>
  )
}
