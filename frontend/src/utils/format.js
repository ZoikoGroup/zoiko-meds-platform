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
/** "2h ago" style relative label from an ISO-ish string is provided directly in
 *  mock data; this keeps deterministic display without Date.now(). */
export function initials(name) {
    return name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}
