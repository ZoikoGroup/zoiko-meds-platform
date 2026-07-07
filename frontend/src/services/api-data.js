export const apiHealth = {
    uptime: '99.98%',
    p50: 84,
    p99: 214,
    requests24h: '4.62M',
    errorRate: '0.02%',
    rateCeiling: '600 req/min',
    sandbox: 'Operational',
};
/** Response time percentiles (ms) across 24 hours. */
export const responseTime = Array.from({ length: 24 }, (_, h) => {
    const load = Math.sin((h - 6) / 3.8);
    return {
        date: `${String(h).padStart(2, '0')}:00`,
        p50: Math.round(70 + load * 18 + 12),
        p99: Math.round(170 + load * 55 + 30),
    };
});
/** Request throughput (thousands/hour) over 24h, governed vs sandbox. */
export const requestThroughput = Array.from({ length: 24 }, (_, h) => {
    const load = Math.max(0.2, Math.sin((h - 4) / 3.6) + 0.6);
    return {
        date: `${String(h).padStart(2, '0')}:00`,
        production: Math.round(120 * load + 40),
        sandbox: Math.round(38 * load + 10),
    };
});
export const endpoints = [
    { id: 'e1', method: 'GET', path: '/v2/availability/confidence', description: 'Governed availability confidence bands by region.', status: 'operational', p50: 78, p99: 190, category: 'Availability' },
    { id: 'e2', method: 'GET', path: '/v2/signal/shortage-pressure', description: 'Aggregate shortage-pressure index time series.', status: 'operational', p50: 92, p99: 221, category: 'Signal' },
    { id: 'e3', method: 'GET', path: '/v2/medibase/identity/{id}', description: 'Normalized medicine identity + mapping graph.', status: 'operational', p50: 64, p99: 148, category: 'MediBase' },
    { id: 'e4', method: 'POST', path: '/v2/signal/subscribe', description: 'Register a governed webhook for access-risk events.', status: 'degraded', p50: 132, p99: 402, category: 'Signal' },
    { id: 'e5', method: 'GET', path: '/v2/jurisdiction/status', description: 'Compliance + governance state per jurisdiction.', status: 'operational', p50: 71, p99: 165, category: 'Governance' },
    { id: 'e6', method: 'GET', path: '/v2/regions/access-risk', description: 'Weighted regional access-risk scores.', status: 'operational', p50: 88, p99: 203, category: 'Availability' },
    { id: 'e7', method: 'POST', path: '/v2/exports/briefing', description: 'Queue a governed intelligence briefing export.', status: 'maintenance', p50: 240, p99: 610, category: 'Reports' },
];
export const exampleResponse = `{
  "region": "APAC",
  "as_of": "2026-07-06T09:00:00Z",
  "availability_confidence": {
    "band": "MODERATE",
    "score": 0.79,
    "coverage": 0.812,
    "freshness_hours": 2.8
  },
  "access_risk": {
    "index": 62,
    "trend": "rising",
    "drivers": ["demand_surge", "logistics_latency"]
  },
  "governance": {
    "jurisdiction_status": "governed",
    "aggregate_only": true,
    "phi": false
  }
}`;
export const securityStatus = [
    { label: 'OAuth 2.0 + mTLS', detail: 'Mutual TLS enforced on all production endpoints.', status: 'ok' },
    { label: 'Scoped API keys', detail: 'Per-key scopes with least-privilege defaults.', status: 'ok' },
    { label: 'Data residency', detail: 'Region-pinned processing for governed tenants.', status: 'ok' },
    { label: 'Key rotation', detail: '2 keys are older than the 90-day rotation policy.', status: 'attention' },
    { label: 'Aggregate-only guarantee', detail: 'No PHI, no exact stock, enforced at the gateway.', status: 'ok' },
];
export const authSteps = [
    { step: 1, title: 'Client credentials', detail: 'Exchange scoped key + secret for a short-lived token.' },
    { step: 2, title: 'Mutual TLS handshake', detail: 'Present the client certificate pinned to your tenant.' },
    { step: 3, title: 'Scope resolution', detail: 'Gateway resolves jurisdiction + product scopes.' },
    { step: 4, title: 'Governed response', detail: 'Aggregate-only payload returned with an audit trace ID.' },
];
export const rateTiers = [
    { tier: 'Sandbox', limit: '60 req/min', burst: '120', concurrency: '4' },
    { tier: 'Scale', limit: '300 req/min', burst: '600', concurrency: '16' },
    { tier: 'Enterprise', limit: '600 req/min', burst: '1,200', concurrency: '48' },
];
