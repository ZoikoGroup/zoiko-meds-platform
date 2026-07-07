import { cn } from '@/lib/utils';
export function SectionHeading({ title, description, action, className, }) {
    return (<div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (<p className="text-sm text-muted-foreground">{description}</p>)}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>);
}
