import { AlertCircle, AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, MinusCircle, ShieldCheck, Wrench, XCircle, } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
const TONE = {
    good: { variant: 'success', Icon: CheckCircle2 },
    warning: { variant: 'warning', Icon: AlertTriangle },
    serious: { variant: 'info', Icon: AlertCircle },
    critical: { variant: 'danger', Icon: XCircle },
    neutral: { variant: 'secondary', Icon: MinusCircle },
};
/** Status is always icon + text + color — never color alone (WCAG 2.2). */
export function StatusBadge({ tone, children, ...props }) {
    const { variant, Icon } = TONE[tone];
    return (<Badge variant={variant} {...props}>
      <Icon aria-hidden/>
      {children}
    </Badge>);
}
/* ------------------------- domain-specific pills ------------------------ */
const SERVICE = {
    operational: { tone: 'good', label: 'Operational', Icon: CheckCircle2 },
    degraded: { tone: 'warning', label: 'Degraded', Icon: AlertTriangle },
    maintenance: { tone: 'serious', label: 'Maintenance', Icon: Wrench },
    down: { tone: 'critical', label: 'Down', Icon: XCircle },
};
export function ServiceStatusBadge({ status, ...props }) {
    const meta = SERVICE[status];
    return (<StatusBadge tone={meta.tone} {...props}>
      {meta.label}
    </StatusBadge>);
}
const CONFIDENCE = {
    high: { tone: 'good', label: 'High' },
    moderate: { tone: 'serious', label: 'Moderate' },
    low: { tone: 'warning', label: 'Low' },
    unknown: { tone: 'neutral', label: 'Unknown' },
};
export function ConfidenceBadge({ level, ...props }) {
    const meta = CONFIDENCE[level];
    return (<StatusBadge tone={meta.tone} {...props}>
      {meta.label}
    </StatusBadge>);
}
const GOVERNANCE = {
    governed: { tone: 'good', label: 'Governed', Icon: ShieldCheck },
    'in-review': { tone: 'warning', label: 'In review', Icon: Clock },
    restricted: { tone: 'serious', label: 'Restricted', Icon: CircleDashed },
    suppressed: { tone: 'critical', label: 'Suppressed', Icon: Ban },
};
export function GovernanceBadge({ state, ...props }) {
    const meta = GOVERNANCE[state];
    return (<Badge variant={TONE[meta.tone].variant} {...props}>
      <meta.Icon aria-hidden/>
      {meta.label}
    </Badge>);
}
