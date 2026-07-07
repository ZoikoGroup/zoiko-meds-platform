import { cn } from '@/lib/utils';
export function BrandMark({ size = 34, className, }) {
    return (<div className={cn('grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-teal text-white shadow-sm', className)} style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h3.2l2-5.2 3.8 12 2.4-6.8H21"/>
      </svg>
    </div>);
}
export function Brand({ collapsed = false, className, }) {
    return (<div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      {!collapsed && (<div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">
            ZoikoMeds
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            Intelligence
          </span>
        </div>)}
    </div>);
}
