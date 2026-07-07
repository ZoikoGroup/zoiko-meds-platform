/**
 * Chart tokens. Colors reference CSS custom properties so every chart
 * recolors instantly on theme toggle with zero JS — light & dark are both
 * validated categorical palettes (see index.css).
 */
/** Fixed categorical order — assign by entity, never cycled or by rank. */
export const CHART_SERIES = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
    'var(--chart-6)',
    'var(--chart-7)',
    'var(--chart-8)',
];
/** Sequential blue ramp for magnitude (heatmaps, choropleth). */
export const SEQUENTIAL = [
    'var(--seq-1)',
    'var(--seq-2)',
    'var(--seq-3)',
    'var(--seq-4)',
    'var(--seq-5)',
    'var(--seq-6)',
    'var(--seq-7)',
    'var(--seq-8)',
];
export const STATUS_COLOR = {
    good: 'var(--success)',
    warning: 'var(--warning)',
    serious: 'var(--info)',
    critical: 'var(--danger)',
};
export const CHART_GRID = 'var(--chart-grid)';
export const CHART_AXIS = 'var(--chart-axis)';
export const CHART_MUTED = 'var(--muted-foreground)';
/** Shared axis props for a recessive, hairline grid. */
export const axisProps = {
    stroke: CHART_AXIS,
    tick: { fill: CHART_MUTED, fontSize: 12 },
    tickLine: false,
    axisLine: false,
};
/** Map a 0–100 magnitude to a step of the sequential ramp. */
export function seqStep(value, max = 100) {
    const idx = Math.min(SEQUENTIAL.length - 1, Math.max(0, Math.round((value / max) * (SEQUENTIAL.length - 1))));
    return SEQUENTIAL[idx];
}
