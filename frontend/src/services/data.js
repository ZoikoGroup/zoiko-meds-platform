/**
 * Synthetic enterprise-intelligence datasets.
 *
 * Everything here is placeholder/aggregate telemetry for UI demonstration —
 * no patient data, no specific-medicine stock levels, no clinical claims.
 * Category labels are broad therapeutic areas; geographies are macro-regions
 * and jurisdictions used purely to shape the visualizations.
 */
/* --------------------------------- utils -------------------------------- */
/** Deterministic PRNG so charts are stable across reloads. */
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];
function spark(seed, n = 12, base = 60, spread = 24) {
    const rnd = mulberry32(seed);
    let v = base;
    return Array.from({ length: n }, () => {
        v += (rnd() - 0.45) * spread;
        v = Math.max(4, Math.min(100, v));
        return Math.round(v * 10) / 10;
    });
}
/* ------------------------------ identity -------------------------------- */
export const currentUser = {
    name: 'Dr. Amara Okafor',
    email: 'a.okafor@zoikomeds.io',
    role: 'Intelligence Director',
    initials: 'AO',
};
export const organizations = [
    {
        id: 'org-meridian',
        name: 'Meridian Health Network',
        plan: 'Enterprise',
        type: 'Health System',
        initials: 'MH',
    },
    {
        id: 'org-natl',
        name: 'National Health Directorate',
        plan: 'Public Sector',
        type: 'Government',
        initials: 'NH',
    },
    {
        id: 'org-atlas',
        name: 'Atlas BioSupply',
        plan: 'Enterprise',
        type: 'Enterprise',
        initials: 'AB',
    },
    {
        id: 'org-helix',
        name: 'Helix Research Consortium',
        plan: 'Scale',
        type: 'Research',
        initials: 'HR',
    },
];
export const notifications = [
    {
        id: 'n1',
        title: 'Access-risk threshold crossed',
        description: 'APAC access-risk index rose to 62 (elevated) over the last 24h.',
        time: '12m ago',
        severity: 'warning',
        read: false,
        channel: 'ZoikoSignal™',
    },
    {
        id: 'n2',
        title: 'Signal freshness restored',
        description: 'EMEA feed latency returned to under 3h after upstream recovery.',
        time: '1h ago',
        severity: 'good',
        read: false,
        channel: 'Pipeline',
    },
    {
        id: 'n3',
        title: 'New governance review queued',
        description: '18 MediBase™ identity mappings await normalization review.',
        time: '3h ago',
        severity: 'serious',
        read: false,
        channel: 'MediBase™',
    },
    {
        id: 'n4',
        title: 'API rate limit at 82%',
        description: 'Atlas BioSupply key is approaching its hourly request ceiling.',
        time: '5h ago',
        severity: 'warning',
        read: true,
        channel: 'ZoikoAvail™',
    },
    {
        id: 'n5',
        title: 'Quarterly briefing published',
        description: 'Q2 access-resilience briefing is ready for your organization.',
        time: 'Yesterday',
        severity: 'good',
        read: true,
        channel: 'Reports',
    },
];
/* ------------------------------ dashboard ------------------------------- */
export const kpis = [
    {
        id: 'confidence',
        label: 'Availability Confidence',
        value: '98.6%',
        delta: '+1.4 pts',
        deltaLabel: 'vs last month',
        trend: 'up',
        upIsGood: true,
        status: { label: 'High assurance', severity: 'good' },
        spark: spark(11, 12, 92, 8),
    },
    {
        id: 'coverage',
        label: 'Medicine Coverage',
        value: '312.4K',
        delta: '+8.2K',
        deltaLabel: 'normalized identities',
        trend: 'up',
        upIsGood: true,
        status: { label: 'Expanding', severity: 'good' },
        spark: spark(21, 12, 70, 16),
    },
    {
        id: 'regions',
        label: 'Active Regions',
        value: '148',
        delta: '+6',
        deltaLabel: 'jurisdictions live',
        trend: 'up',
        upIsGood: true,
        status: { label: 'Governed', severity: 'good' },
        spark: spark(31, 12, 60, 14),
    },
    {
        id: 'freshness',
        label: 'Signal Freshness',
        value: '2.8h',
        delta: '−0.6h',
        deltaLabel: 'median latency',
        trend: 'down',
        upIsGood: false,
        status: { label: 'Real-time', severity: 'good' },
        spark: spark(41, 12, 50, 20),
    },
    {
        id: 'jurisdiction',
        label: 'Jurisdiction Status',
        value: '96.1%',
        delta: '+0.9 pts',
        deltaLabel: 'compliant surfaces',
        trend: 'up',
        upIsGood: true,
        status: { label: 'In policy', severity: 'good' },
        spark: spark(51, 12, 88, 8),
    },
    {
        id: 'partners',
        label: 'Partner Organizations',
        value: '1,284',
        delta: '+37',
        deltaLabel: 'contributing sources',
        trend: 'up',
        upIsGood: true,
        status: { label: 'Growing', severity: 'good' },
        spark: spark(61, 12, 55, 18),
    },
    {
        id: 'api',
        label: 'API Health',
        value: '99.98%',
        delta: '+0.02 pts',
        deltaLabel: '30-day uptime',
        trend: 'flat',
        upIsGood: true,
        status: { label: 'Operational', severity: 'good' },
        spark: spark(71, 12, 96, 4),
    },
    {
        id: 'governance',
        label: 'Governance Score',
        value: '94 / 100',
        delta: '−2',
        deltaLabel: 'review backlog up',
        trend: 'down',
        upIsGood: true,
        status: { label: 'Attention', severity: 'warning' },
        spark: spark(81, 12, 90, 10),
    },
];
/** Availability confidence vs coverage index (%), 12 months, one axis. */
export const availabilityTrend = MONTHS.map((m, i) => {
    const rnd = mulberry32(1000 + i);
    return {
        date: m,
        confidence: Math.round((90 + i * 0.7 + rnd() * 3) * 10) / 10,
        coverage: Math.round((72 + i * 1.9 + rnd() * 4) * 10) / 10,
    };
});
/** Shortage-pressure index (0–100) with a rolling 3-month baseline. */
export const shortagePressure = MONTHS.map((m, i) => {
    const rnd = mulberry32(2000 + i);
    const pressure = Math.round((38 + Math.sin(i / 1.8) * 14 + rnd() * 8) * 10) / 10;
    return {
        date: m,
        pressure,
        baseline: Math.round((40 + Math.sin((i - 1) / 1.8) * 8) * 10) / 10,
    };
});
/** Signal freshness — share of feeds under the 6h SLA, and median hours. */
export const signalFreshness = MONTHS.map((m, i) => {
    const rnd = mulberry32(3000 + i);
    return {
        date: m,
        withinSla: Math.round((82 + i * 0.9 + rnd() * 4) * 10) / 10,
        medianHours: Math.round((5.5 - i * 0.18 + rnd()) * 10) / 10,
    };
});
export const confidenceDistribution = [
    { level: 'high', label: 'High', value: 64 },
    { level: 'moderate', label: 'Moderate', value: 24 },
    { level: 'low', label: 'Low', value: 9 },
    { level: 'unknown', label: 'Unknown', value: 3 },
];
export const topCategories = [
    { category: 'Cardiovascular', coverage: 96, signals: 4820 },
    { category: 'Anti-infectives', coverage: 93, signals: 4410 },
    { category: 'Respiratory', coverage: 91, signals: 3980 },
    { category: 'CNS & Neurology', coverage: 88, signals: 3620 },
    { category: 'Endocrine & Metabolic', coverage: 90, signals: 3410 },
    { category: 'Immunology', coverage: 85, signals: 2870 },
    { category: 'Oncology Support', coverage: 82, signals: 2540 },
    { category: 'Analgesics', coverage: 94, signals: 4210 },
];
export const regionRisk = [
    { id: 'na', region: 'North America', risk: 18, coverage: 97, confidence: 'high', trend: 'flat' },
    { id: 'emea', region: 'EMEA', risk: 31, coverage: 93, confidence: 'high', trend: 'down' },
    { id: 'latam', region: 'LATAM', risk: 54, coverage: 82, confidence: 'moderate', trend: 'up' },
    { id: 'apac', region: 'APAC', risk: 62, coverage: 79, confidence: 'moderate', trend: 'up' },
    { id: 'ssa', region: 'Sub-Saharan Africa', risk: 71, coverage: 68, confidence: 'low', trend: 'up' },
    { id: 'sasia', region: 'South Asia', risk: 58, coverage: 74, confidence: 'moderate', trend: 'flat' },
    { id: 'nordics', region: 'Nordics', risk: 14, coverage: 98, confidence: 'high', trend: 'flat' },
    { id: 'oceania', region: 'Oceania', risk: 22, coverage: 95, confidence: 'high', trend: 'down' },
];
/** Access-risk heatmap: region × quarter intensity (0–100). */
export const riskHeatmap = regionRisk.map((r, i) => {
    const rnd = mulberry32(4000 + i);
    return {
        region: r.region,
        cells: Array.from({ length: 8 }, (_, q) => Math.round(Math.max(2, Math.min(100, r.risk + (rnd() - 0.5) * 30 + q)))),
    };
});
export const HEATMAP_COLS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'];
export const jurisdictionComparison = [
    { jurisdiction: 'United States', coverage: 97, preparedness: 88 },
    { jurisdiction: 'Germany', coverage: 95, preparedness: 90 },
    { jurisdiction: 'United Kingdom', coverage: 94, preparedness: 86 },
    { jurisdiction: 'Japan', coverage: 92, preparedness: 84 },
    { jurisdiction: 'Brazil', coverage: 83, preparedness: 71 },
    { jurisdiction: 'India', coverage: 78, preparedness: 69 },
];
/** API request volume (thousands) split by governed vs sandbox traffic. */
export const apiUsage = MONTHS.map((m, i) => {
    const rnd = mulberry32(5000 + i);
    return {
        date: m,
        production: Math.round(180 + i * 22 + rnd() * 30),
        sandbox: Math.round(60 + i * 6 + rnd() * 20),
    };
});
/** Partner participation over time by organization type. */
export const partnerParticipation = MONTHS.map((m, i) => {
    const rnd = mulberry32(6000 + i);
    return {
        date: m,
        health: Math.round(280 + i * 14 + rnd() * 12),
        government: Math.round(120 + i * 6 + rnd() * 8),
        enterprise: Math.round(200 + i * 11 + rnd() * 10),
    };
});
export const jurisdictions = [
    { id: 'us', jurisdiction: 'United States', coverage: 97, preparedness: 88, freshnessHours: 2.1, status: 'governed', partners: 342 },
    { id: 'de', jurisdiction: 'Germany', coverage: 95, preparedness: 90, freshnessHours: 2.4, status: 'governed', partners: 188 },
    { id: 'uk', jurisdiction: 'United Kingdom', coverage: 94, preparedness: 86, freshnessHours: 2.6, status: 'governed', partners: 164 },
    { id: 'jp', jurisdiction: 'Japan', coverage: 92, preparedness: 84, freshnessHours: 3.0, status: 'governed', partners: 141 },
    { id: 'ca', jurisdiction: 'Canada', coverage: 96, preparedness: 87, freshnessHours: 2.3, status: 'governed', partners: 132 },
    { id: 'au', jurisdiction: 'Australia', coverage: 95, preparedness: 85, freshnessHours: 2.9, status: 'governed', partners: 118 },
    { id: 'br', jurisdiction: 'Brazil', coverage: 83, preparedness: 71, freshnessHours: 4.2, status: 'in-review', partners: 96 },
    { id: 'in', jurisdiction: 'India', coverage: 78, preparedness: 69, freshnessHours: 4.8, status: 'in-review', partners: 87 },
    { id: 'ke', jurisdiction: 'Kenya', coverage: 66, preparedness: 58, freshnessHours: 6.1, status: 'restricted', partners: 44 },
    { id: 'sg', jurisdiction: 'Singapore', coverage: 96, preparedness: 89, freshnessHours: 2.2, status: 'governed', partners: 71 },
];
