import { Download, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
/** One row of filter controls above the charts, with a trailing export action. */
export function FilterBar({ children, onExport, exportLabel = 'Export', className, }) {
    return (<div className={cn('flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft lg:flex-row lg:items-center', className)}>
      <span className="flex items-center gap-2 pl-1 text-sm font-medium text-muted-foreground lg:mr-1">
        <SlidersHorizontal className="size-4"/>
        <span className="lg:sr-only xl:not-sr-only">Filters</span>
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {onExport && (<Button variant="outline" size="sm" onClick={onExport} className="lg:ml-auto">
          <Download />
          {exportLabel}
        </Button>)}
    </div>);
}
