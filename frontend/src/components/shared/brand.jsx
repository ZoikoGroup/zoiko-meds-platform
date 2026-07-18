import { cn } from '@/lib/utils';

// ZoikoMeds mark: crossed pill capsules with a plus, on a navy disc.
export function BrandMark({ size, className }) {
    return (<svg className={cn('shrink-0', className)} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="22.5" fill="#2b4192"/>
      <rect x="18.9" y="10.7" width="10.2" height="26.6" rx="5.1" fill="#ffffff"/>
      <rect x="10.4" y="19.0" width="27.2" height="10.0" rx="5.0" fill="#10aaa4"/>
      <rect x="20.7" y="22.8" width="6.6" height="2.4" fill="#ffffff"/>
      <rect x="22.8" y="20.7" width="2.4" height="6.6" fill="#ffffff"/>
    </svg>);
}

export function Brand({ collapsed = false, size = 'default', className }) {
    const isLarge = size === 'large';
    const markSize = isLarge ? 48 : 34;
    const textSizeClass = isLarge ? 'text-[26px]' : 'text-[19px]';
    const trademarkSizeClass = isLarge ? 'text-[12px]' : 'text-[9px]';
    const gapClass = isLarge ? 'gap-3.5' : 'gap-2.5';

    return (<div className={cn('flex items-center', gapClass, className)}>
      <BrandMark size={markSize} />
      {!collapsed && (<span className={cn('font-extrabold tracking-tight leading-none', textSizeClass)}>
          <span className="text-foreground">Zoiko</span>
          <span className="text-teal">Meds</span>
          <span className={cn('align-super font-semibold text-muted-foreground', trademarkSizeClass)}>™</span>
        </span>)}
    </div>);
}
