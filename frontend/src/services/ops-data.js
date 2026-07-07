export const reports = [
    { id: 'rp1', name: 'Q2 Access-Resilience Briefing', type: 'Executive briefing', owner: 'A. Okafor', updated: '2h ago', status: 'ready', format: 'PDF' },
    { id: 'rp2', name: 'APAC Shortage-Pressure Digest', type: 'Regional digest', owner: 'System', updated: 'Daily · 06:00', status: 'scheduled', format: 'PDF' },
    { id: 'rp3', name: 'Jurisdiction Compliance Export', type: 'Governance export', owner: 'R. Silva', updated: '1d ago', status: 'ready', format: 'CSV' },
    { id: 'rp4', name: 'Partner Participation Rollup', type: 'Network report', owner: 'System', updated: 'Weekly · Mon', status: 'scheduled', format: 'XLSX' },
    { id: 'rp5', name: 'Signal Freshness SLA Report', type: 'Operations', owner: 'System', updated: 'Running…', status: 'running', format: 'JSON' },
    { id: 'rp6', name: 'MediBase Normalization Audit', type: 'Data quality', owner: 'K. Tanaka', updated: '3d ago', status: 'ready', format: 'CSV' },
    { id: 'rp7', name: 'Access-Risk Forecast (draft)', type: 'Forecast', owner: 'A. Okafor', updated: '5h ago', status: 'failed', format: 'PDF' },
];
export const users = [
    { id: 'u1', name: 'Amara Okafor', email: 'a.okafor@zoikomeds.io', role: 'Owner', status: 'active', lastActive: '2m ago' },
    { id: 'u2', name: 'Rafael Silva', email: 'r.silva@zoikomeds.io', role: 'Admin', status: 'active', lastActive: '18m ago' },
    { id: 'u3', name: 'Keiko Tanaka', email: 'k.tanaka@zoikomeds.io', role: 'Analyst', status: 'active', lastActive: '1h ago' },
    { id: 'u4', name: 'Lena Hoffmann', email: 'l.hoffmann@zoikomeds.io', role: 'Analyst', status: 'active', lastActive: '3h ago' },
    { id: 'u5', name: 'Marcus Bell', email: 'm.bell@zoikomeds.io', role: 'Viewer', status: 'invited', lastActive: '—' },
    { id: 'u6', name: 'Priya Nair', email: 'p.nair@zoikomeds.io', role: 'Auditor', status: 'active', lastActive: 'Yesterday' },
    { id: 'u7', name: 'Tom Weaver', email: 't.weaver@zoikomeds.io', role: 'Viewer', status: 'suspended', lastActive: '2w ago' },
];
export const roleMatrix = [
    { capability: 'View intelligence', Owner: true, Admin: true, Analyst: true, Viewer: true, Auditor: true },
    { capability: 'Export & briefings', Owner: true, Admin: true, Analyst: true, Viewer: false, Auditor: true },
    { capability: 'Manage API keys', Owner: true, Admin: true, Analyst: false, Viewer: false, Auditor: false },
    { capability: 'Manage users & roles', Owner: true, Admin: true, Analyst: false, Viewer: false, Auditor: false },
    { capability: 'Configure governance', Owner: true, Admin: false, Analyst: false, Viewer: false, Auditor: false },
    { capability: 'Read audit logs', Owner: true, Admin: true, Analyst: false, Viewer: false, Auditor: true },
];
export const auditLogs = [
    { id: 'a1', actor: 'a.okafor@zoikomeds.io', action: 'Exported briefing', resource: 'Q2 Access-Resilience Briefing', timestamp: '2026-07-06 09:12 UTC', scope: 'Reports' },
    { id: 'a2', actor: 'r.silva@zoikomeds.io', action: 'Rotated API key', resource: 'key_atlas_prod', timestamp: '2026-07-06 08:41 UTC', scope: 'Security' },
    { id: 'a3', actor: 'system', action: 'Governance review queued', resource: '18 identity mappings', timestamp: '2026-07-06 07:55 UTC', scope: 'MediBase' },
    { id: 'a4', actor: 'k.tanaka@zoikomeds.io', action: 'Updated normalization rule', resource: 'rule_inn_2049', timestamp: '2026-07-05 16:20 UTC', scope: 'MediBase' },
    { id: 'a5', actor: 'p.nair@zoikomeds.io', action: 'Viewed audit log', resource: 'audit/stream', timestamp: '2026-07-05 14:03 UTC', scope: 'Security' },
    { id: 'a6', actor: 'a.okafor@zoikomeds.io', action: 'Invited member', resource: 'm.bell@zoikomeds.io', timestamp: '2026-07-05 11:47 UTC', scope: 'Organization' },
];
export const apiKeys = [
    { id: 'k1', label: 'Production · Availability', prefix: 'zk_live_9f2a', scope: 'availability, signal', created: '2025-11-02', lastUsed: '2m ago', status: 'active' },
    { id: 'k2', label: 'Production · MediBase', prefix: 'zk_live_4c81', scope: 'medibase', created: '2025-09-18', lastUsed: '14m ago', status: 'active' },
    { id: 'k3', label: 'Sandbox · Eval', prefix: 'zk_test_2be7', scope: 'all (sandbox)', created: '2026-01-20', lastUsed: '1h ago', status: 'active' },
    { id: 'k4', label: 'Legacy · Exports', prefix: 'zk_live_0a55', scope: 'reports', created: '2024-08-11', lastUsed: '30d ago', status: 'revoked' },
];
export const integrations = [
    { id: 'i1', name: 'Epic Interconnect', category: 'Health system EHR', status: 'operational', lastSync: '4m ago' },
    { id: 'i2', name: 'Oracle Cerner', category: 'Health system EHR', status: 'operational', lastSync: '6m ago' },
    { id: 'i3', name: 'SAP Ariba', category: 'Procurement', status: 'operational', lastSync: '12m ago' },
    { id: 'i4', name: 'Snowflake', category: 'Data warehouse', status: 'operational', lastSync: '2m ago' },
    { id: 'i5', name: 'ServiceNow', category: 'ITSM / escalation', status: 'degraded', lastSync: '41m ago' },
    { id: 'i6', name: 'Slack', category: 'Alerting', status: 'operational', lastSync: '1m ago' },
    { id: 'i7', name: 'Okta SSO', category: 'Identity', status: 'operational', lastSync: '3m ago' },
    { id: 'i8', name: 'Power BI', category: 'Analytics', status: 'maintenance', lastSync: '2h ago' },
];
export const billingSummary = {
    plan: 'Enterprise',
    seats: '48 of 60',
    apiTier: '600 req/min',
    renewal: 'Mar 1, 2027',
    usageThisCycle: 72,
    invoices: [
        { id: 'inv-2026-06', period: 'Jun 2026', amount: '$48,000', status: 'Paid' },
        { id: 'inv-2026-05', period: 'May 2026', amount: '$48,000', status: 'Paid' },
        { id: 'inv-2026-04', period: 'Apr 2026', amount: '$44,000', status: 'Paid' },
    ],
};
