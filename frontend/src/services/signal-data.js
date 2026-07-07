export const signalOverview = [
    {
        id: 'shortage',
        label: 'Shortage intelligence',
        value: '37',
        unit: 'active pressure zones',
        delta: '+4',
        trend: 'up',
        upIsGood: false,
        severity: 'warning',
    },
    {
        id: 'demand',
        label: 'Demand movement',
        value: '+12.4%',
        unit: 'aggregate demand index',
        delta: '+3.1 pts',
        trend: 'up',
        upIsGood: true,
        severity: 'good',
    },
    {
        id: 'risk',
        label: 'Regional access risk',
        value: '48',
        unit: 'weighted index',
        delta: '+6',
        trend: 'up',
        upIsGood: false,
        severity: 'serious',
    },
    {
        id: 'restock',
        label: 'Restock signals',
        value: '1,902',
        unit: 'confirmed in 24h',
        delta: '+218',
        trend: 'up',
        upIsGood: true,
        severity: 'good',
    },
];
/** Demand vs supply signal index across 12 months (indexed to 100). */
export const demandMovement = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
].map((date, i) => ({
    date,
    demand: Math.round((100 + Math.sin(i / 1.5) * 8 + i * 1.2) * 10) / 10,
    supply: Math.round((100 + Math.cos(i / 2) * 6 + i * 0.6) * 10) / 10,
}));
export const shortageByCategory = [
    { category: 'Anti-infectives', pressure: 68 },
    { category: 'Oncology Support', pressure: 61 },
    { category: 'CNS & Neurology', pressure: 47 },
    { category: 'Respiratory', pressure: 42 },
    { category: 'Endocrine & Metabolic', pressure: 35 },
    { category: 'Cardiovascular', pressure: 29 },
];
export const restockSignals = [
    { id: 'r1', region: 'APAC', category: 'Anti-infectives', strength: 88, window: '24–48h', confidence: 'high' },
    { id: 'r2', region: 'EMEA', category: 'Respiratory', strength: 74, window: '2–4 days', confidence: 'high' },
    { id: 'r3', region: 'LATAM', category: 'CNS & Neurology', strength: 63, window: '3–5 days', confidence: 'moderate' },
    { id: 'r4', region: 'Sub-Saharan Africa', category: 'Oncology Support', strength: 41, window: '5–8 days', confidence: 'low' },
    { id: 'r5', region: 'South Asia', category: 'Endocrine & Metabolic', strength: 57, window: '3–6 days', confidence: 'moderate' },
];
/* ------------------------------ filters --------------------------------- */
export const dateRangeOptions = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'mtd', label: 'Month to date' },
    { value: 'qtd', label: 'Quarter to date' },
    { value: 'ytd', label: 'Year to date' },
];
export const medicineGroupOptions = [
    { value: 'all', label: 'All medicine groups' },
    { value: 'beta-blockers', label: 'Beta blockers' },
    { value: 'macrolides', label: 'Macrolides' },
    { value: 'bronchodilators', label: 'Bronchodilators' },
    { value: 'statins', label: 'Statins' },
    { value: 'antivirals', label: 'Antivirals' },
];
export const countryOptions = [
    { value: 'all', label: 'All countries' },
    { value: 'us', label: 'United States' },
    { value: 'de', label: 'Germany' },
    { value: 'uk', label: 'United Kingdom' },
    { value: 'jp', label: 'Japan' },
    { value: 'br', label: 'Brazil' },
    { value: 'in', label: 'India' },
];
export const regionOptions = [
    { value: 'all', label: 'All regions' },
    { value: 'na', label: 'North America' },
    { value: 'emea', label: 'EMEA' },
    { value: 'latam', label: 'LATAM' },
    { value: 'apac', label: 'APAC' },
    { value: 'ssa', label: 'Sub-Saharan Africa' },
];
export const categoryOptions = [
    { value: 'all', label: 'All categories' },
    { value: 'cardio', label: 'Cardiovascular' },
    { value: 'anti', label: 'Anti-infectives' },
    { value: 'resp', label: 'Respiratory' },
    { value: 'cns', label: 'CNS & Neurology' },
    { value: 'onco', label: 'Oncology Support' },
];
