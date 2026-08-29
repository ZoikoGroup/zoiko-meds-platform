// Static reference content for the ZoikoAvail™ console — documentation, not
// measurements. Live health/latency/throughput/endpoint-status/security data
// comes from getZoikoAvailTelemetry() (@/services/admin-api), backed by real
// request telemetry (MSA-36). This file used to also export fabricated
// uptime/latency/endpoint fixtures with nothing behind them.

/** The intended auth flow for partner access — see Security Status on the
 * console for which of these steps are actually enforced today. */
export const authSteps = [
    { step: 1, title: 'Client credentials', detail: 'Exchange scoped key + secret for a short-lived token.' },
    { step: 2, title: 'Mutual TLS handshake', detail: 'Present the client certificate pinned to your tenant.' },
    { step: 3, title: 'Scope resolution', detail: 'Gateway resolves jurisdiction + product scopes.' },
    { step: 4, title: 'Governed response', detail: 'Aggregate-only payload returned with an audit trace ID.' },
];

/** Sample payload shown in the developer docs. */
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
