import { Slot } from '@radix-ui/react-slot';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
export function Breadcrumb(props) {
    return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props}/>;
}
export function BreadcrumbList({ className, ...props }) {
    return (<ol data-slot="breadcrumb-list" className={cn('flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground', className)} {...props}/>);
}
export function BreadcrumbItem({ className, ...props }) {
    return (<li data-slot="breadcrumb-item" className={cn('inline-flex items-center gap-1.5', className)} {...props}/>);
}
export function BreadcrumbLink({ className, asChild, ...props }) {
    const Comp = asChild ? Slot : 'a';
    return (<Comp data-slot="breadcrumb-link" className={cn('transition-colors hover:text-foreground', className)} {...props}/>);
}
export function BreadcrumbPage({ className, ...props }) {
    return (<span data-slot="breadcrumb-page" role="link" aria-disabled="true" aria-current="page" className={cn('font-medium text-foreground', className)} {...props}/>);
}
export function BreadcrumbSeparator({ children, className, ...props }) {
    return (<li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn('[&>svg]:size-3.5', className)} {...props}>
      {children ?? <ChevronRight />}
    </li>);
}
export function BreadcrumbEllipsis({ className, ...props }) {
    return (<span role="presentation" aria-hidden="true" className={cn('flex size-8 items-center justify-center', className)} {...props}>
      <MoreHorizontal className="size-4"/>
      <span className="sr-only">More</span>
    </span>);
}
