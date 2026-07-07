import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
/** Is this movement good? up+upIsGood or down+!upIsGood → positive. */
export function deltaSentiment(trend, upIsGood) {
    if (trend === 'flat')
        return 'neutral';
    const isUp = trend === 'up';
    return isUp === upIsGood ? 'positive' : 'negative';
}
const SENTIMENT_CLASS = {
    positive: 'text-success',
    negative: 'text-danger',
    neutral: 'text-muted-foreground',
};
export function TrendDelta({ trend, value, upIsGood = true, className, showIcon = true, }) {
    const sentiment = deltaSentiment(trend, upIsGood);
    const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight;
    return (<span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular', SENTIMENT_CLASS[sentiment], className)}>
      {showIcon && <Icon className="size-3.5" aria-hidden/>}
      {value}
    </span>);
}
