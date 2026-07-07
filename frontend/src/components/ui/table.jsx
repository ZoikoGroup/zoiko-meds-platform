import { cn } from '@/lib/utils';
export function Table({ className, ...props }) {
    return (<div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props}/>
    </div>);
}
export function TableHeader({ className, ...props }) {
    return (<thead data-slot="table-header" className={cn('sticky top-0 z-10 bg-muted/60 backdrop-blur-sm [&_tr]:border-b [&_tr]:border-border', className)} {...props}/>);
}
export function TableBody({ className, ...props }) {
    return (<tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props}/>);
}
export function TableFooter({ className, ...props }) {
    return (<tfoot data-slot="table-footer" className={cn('border-t border-border bg-muted/40 font-medium', className)} {...props}/>);
}
export function TableRow({ className, ...props }) {
    return (<tr data-slot="table-row" className={cn('border-b border-border/70 transition-colors hover:bg-muted/40 data-[state=selected]:bg-accent', className)} {...props}/>);
}
export function TableHead({ className, ...props }) {
    return (<th data-slot="table-head" className={cn('h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)} {...props}/>);
}
export function TableCell({ className, ...props }) {
    return (<td data-slot="table-cell" className={cn('px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)} {...props}/>);
}
export function TableCaption({ className, ...props }) {
    return (<caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props}/>);
}
