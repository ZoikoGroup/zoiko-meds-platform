/** Number / date formatting helpers used across the dashboard. */
const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
});
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** 1284 → "1,284"; 1_284_000 → "1.3M" when compact. */
export function formatNumber(value, opts) {
    return opts?.compact ? compact.format(value) : grouped.format(value);
}
export function formatPercent(value, fractionDigits = 1) {
    return `${value.toFixed(fractionDigits)}%`;
}
export function formatSigned(value, suffix = '') {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value}${suffix}`;
}
export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: value >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: value >= 10000 ? 1 : 0,
    }).format(value);
}
export function formatMs(value) {
    return `${value.toFixed(0)}ms`;
}
const RELATIVE_UNITS = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
];
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
/**
 * "6 minutes ago" / "in 54 minutes" from a real timestamp.
 *
 * Server timestamps arrive as ISO strings; anything unparseable answers null so
 * the caller can render an em dash rather than "Invalid Date". Sub-minute gaps
 * round to "now": a sync that finished four seconds ago is not usefully
 * described as four seconds ago, and the number would be stale on sight.
 */
export function formatRelative(iso, now = Date.now()) {
    if (!iso)
        return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then))
        return null;
    const seconds = Math.round((then - now) / 1000);
    if (Math.abs(seconds) < 45)
        return 'just now';
    for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(seconds) >= size || unit === 'second') {
            return relative.format(Math.round(seconds / size), unit);
        }
    }
    return null;
}
export function initials(name) {
    return name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}
