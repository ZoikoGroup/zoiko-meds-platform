import { Inbox, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
export function EmptyState({ icon: Icon = Inbox, title, description, action, className, }) {
    return (<div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden/>
      </span>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {description && (<p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>)}
      {action && <div className="mt-5">{action}</div>}
    </div>);
}
export function ErrorState({ title = 'Something went wrong', description = 'We could not load this intelligence surface. Please try again.', onRetry, className, }) {
    return (<div role="alert" className={cn('flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger/5 px-6 py-14 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <TriangleAlert className="size-6" aria-hidden/>
      </span>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry && (<Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Retry
        </Button>)}
    </div>);
}
