/* --------------------------- Health Systems ----------------------------- */
export const careWorkflow = [
    { id: 'w1', title: 'Signal ingestion', detail: 'Governed availability + access-risk feeds normalized in real time.', status: 'active' },
    { id: 'w2', title: 'Care navigation', detail: 'Availability guidance surfaced to navigation teams — never dispensing.', status: 'active' },
    { id: 'w3', title: 'Discharge support', detail: 'Access-risk context attached to discharge planning workflows.', status: 'active' },
    { id: 'w4', title: 'Escalation', detail: 'Elevated pressure routed to procurement + pharmacy leadership.', status: 'attention' },
];
export const hospitalIntelligence = [
    { label: 'Facilities connected', value: '342', delta: '+18', trend: 'up' },
    { label: 'Availability confidence', value: '95.2%', delta: '+1.1 pts', trend: 'up' },
    { label: 'Access-risk alerts (7d)', value: '61', delta: '+9', trend: 'up' },
    { label: 'Navigation resolutions', value: '4,908', delta: '+412', trend: 'up' },
];
export const dischargeSupport = [
    { label: 'Discharge plans enriched', value: 88, hint: 'share of eligible plans' },
    { label: 'Guidance acceptance', value: 76, hint: 'clinician-accepted context' },
    { label: 'Follow-up coverage', value: 82, hint: 'access continuity confirmed' },
];
/** Patient access continuity index across 12 months (aggregate, de-identified). */
export const patientAccessTrends = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
].map((date, i) => ({
    date,
    access: Math.round((78 + i * 1.3 + Math.sin(i / 2) * 3) * 10) / 10,
    guidance: Math.round((70 + i * 1.6 + Math.cos(i / 2) * 4) * 10) / 10,
}));
export const careNavigation = [
    { title: 'Availability guidance', detail: 'Confidence-banded availability context for navigation teams.' },
    { title: 'Alternative access routes', detail: 'Governed regional options when local pressure is elevated.' },
    { title: 'Continuity monitoring', detail: 'Track access continuity across the care episode.' },
];
/* ----------------------------- Government -------------------------------- */
export const publicHealthMetrics = [
    { id: 'coverage', label: 'Population coverage', value: '92.4%', delta: '+0.8 pts', trend: 'up', severity: 'good' },
    { id: 'risk', label: 'National access risk', value: '41', delta: '+5', trend: 'up', severity: 'warning' },
    { id: 'prep', label: 'Preparedness index', value: '84 / 100', delta: '+2', trend: 'up', severity: 'good' },
    { id: 'zones', label: 'Priority zones', value: '12', delta: '+3', trend: 'up', severity: 'serious' },
];
export const preparednessByRegion = [
    { region: 'North America', index: 88 },
    { region: 'EMEA', index: 85 },
    { region: 'APAC', index: 74 },
    { region: 'LATAM', index: 69 },
    { region: 'South Asia', index: 66 },
    { region: 'Sub-Saharan Africa', index: 58 },
];
export const privacyStatus = [
    { label: 'Aggregate-only outputs', detail: 'No individual-level data leaves the boundary.', status: 'ok' },
    { label: 'Jurisdiction data residency', detail: 'Processing pinned to sovereign regions.', status: 'ok' },
    { label: 'Differential access controls', detail: 'Role + jurisdiction scoped intelligence.', status: 'ok' },
    { label: 'Audit completeness', detail: 'Full access trace retained for 24 months.', status: 'ok' },
];
export const governanceIndicatorsGov = [
    { label: 'Policy compliance', value: 96 },
    { label: 'Data minimization', value: 99 },
    { label: 'Transparency reporting', value: 91 },
    { label: 'Review responsiveness', value: 88 },
];
/* ----------------------------- Enterprise -------------------------------- */
export const intelligenceStack = [
    {
        id: 'signal',
        name: 'ZoikoSignal™',
        tagline: 'Access-risk & shortage intelligence',
        description: 'Aggregate shortage-pressure, demand movement, and regional access-risk signals.',
        metrics: [
            { label: 'Signal freshness', value: '2.8h' },
            { label: 'Regions', value: '148' },
        ],
    },
    {
        id: 'avail',
        name: 'ZoikoAvail™',
        tagline: 'Governed availability API',
        description: 'A governed, aggregate-only API for availability confidence and access risk.',
        metrics: [
            { label: 'Uptime', value: '99.98%' },
            { label: 'p50 latency', value: '84ms' },
        ],
    },
    {
        id: 'medibase',
        name: 'MediBase™',
        tagline: 'Medicine identity graph',
        description: 'Normalized brand↔generic↔strength↔market identity resolution.',
        metrics: [
            { label: 'Identities', value: '312.4K' },
            { label: 'Normalized', value: '87%' },
        ],
    },
];
export const architectureLayers = [
    { id: 'sources', label: 'Governed sources', nodes: ['Partner feeds', 'Health systems', 'Public registries'] },
    { id: 'medibase', label: 'MediBase™ identity', nodes: ['Normalization', 'Governance', 'Quality tiers'] },
    { id: 'signal', label: 'ZoikoSignal™ intelligence', nodes: ['Shortage pressure', 'Access risk', 'Demand movement'] },
    { id: 'avail', label: 'ZoikoAvail™ delivery', nodes: ['Governed API', 'Exports', 'Webhooks'] },
];
export const useCases = [
    { id: 'u1', title: 'Procurement resilience', description: 'Anticipate access pressure and prioritize governed sourcing.', metric: '−31%', metricLabel: 'stockout exposure' },
    { id: 'u2', title: 'Public-health preparedness', description: 'Jurisdiction-aware access-risk monitoring for planning.', metric: '+18', metricLabel: 'preparedness index' },
    { id: 'u3', title: 'Care continuity', description: 'Availability guidance embedded in navigation workflows.', metric: '4.9K', metricLabel: 'resolutions / mo' },
    { id: 'u4', title: 'Supply intelligence', description: 'Aggregate demand + restock signals for planning teams.', metric: '2.8h', metricLabel: 'signal latency' },
];
export const procurementReadiness = [
    { label: 'Security & privacy review pack', done: true },
    { label: 'Data processing agreement (DPA)', done: true },
    { label: 'SOC 2 Type II report', done: true },
    { label: 'Jurisdiction residency addendum', done: true },
    { label: 'Sandbox evaluation environment', done: true },
    { label: 'Implementation runbook', done: false },
];
export const securityOverview = [
    { label: 'SOC 2 Type II', detail: 'Audited annually; report available under NDA.' },
    { label: 'ISO 27001', detail: 'Certified information-security management.' },
    { label: 'Aggregate-only', detail: 'No PHI; no exact stock; governance-enforced.' },
    { label: 'Encryption', detail: 'TLS 1.3 in transit, AES-256 at rest.' },
];
export const implementationTimeline = [
    { id: 't1', title: 'Discovery & scoping', detail: 'Jurisdictions, products, and governance scope defined.', time: 'Week 1–2', severity: 'good' },
    { id: 't2', title: 'Sandbox evaluation', detail: 'Scoped keys issued; governed sample data validated.', time: 'Week 3–4', severity: 'good' },
    { id: 't3', title: 'Integration', detail: 'API + webhook wiring into procurement / care systems.', time: 'Week 5–7', severity: 'warning' },
    { id: 't4', title: 'Governance sign-off', detail: 'Security, privacy, and residency review completed.', time: 'Week 8', severity: 'serious' },
    { id: 't5', title: 'Production rollout', detail: 'Progressive enablement across jurisdictions.', time: 'Week 9+', severity: 'good' },
];
