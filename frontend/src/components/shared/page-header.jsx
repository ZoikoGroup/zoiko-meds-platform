import { Link } from 'react-router-dom';
import { Fragment } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator, } from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';
export function PageHeader({ eyebrow, title, subtitle, breadcrumbs, actions, meta, variant = 'default', className, }) {
    const isHero = variant === 'hero';
    const content = (<div className={cn('flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between', isHero ? 'p-6 sm:p-8' : '')}>
      <div className="flex flex-col gap-2">
        {breadcrumbs && breadcrumbs.length > 0 && (<Breadcrumb className="mb-1">
            <BreadcrumbList>
              {breadcrumbs.map((c, i) => (<Fragment key={c.label}>
                  <BreadcrumbItem>
                    {c.to ? (<BreadcrumbLink asChild>
                        <Link to={c.to}>{c.label}</Link>
                      </BreadcrumbLink>) : (<BreadcrumbPage>{c.label}</BreadcrumbPage>)}
                  </BreadcrumbItem>
                  {i < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                </Fragment>))}
            </BreadcrumbList>
          </Breadcrumb>)}
        {eyebrow && (<span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </span>)}
        <h1 className={cn('font-semibold tracking-tight text-balance', isHero ? 'text-2xl sm:text-3xl lg:text-4xl' : 'text-2xl')}>
          {title}
        </h1>
        {subtitle && (<p className={cn('text-muted-foreground text-balance', isHero ? 'max-w-2xl text-base' : 'max-w-2xl text-sm')}>
            {subtitle}
          </p>)}
        {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && (<div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>)}
    </div>);
    if (isHero) {
        return (<section className={cn('relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft', className)}>
        <div className="absolute inset-0 bg-grid opacity-60" aria-hidden/>
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" aria-hidden/>
        <div className="absolute -left-16 top-1/2 size-56 rounded-full bg-teal/10 blur-3xl" aria-hidden/>
        <div className="relative">{content}</div>
      </section>);
    }
    return <div className={cn('', className)}>{content}</div>;
}
