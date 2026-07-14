import { Building2, Blocks, FileText, LayoutDashboard, Network, Radar, Settings, Webhook, Users, ShieldCheck, Bell, History, Scale } from 'lucide-react';
export const navSections = [
    {
        items: [
            { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, end: true },
        ],
    },
    {
        heading: 'Platform Governance',
        items: [
            { label: 'Leadership & Oversight', to: '/governance', icon: Scale },
            { label: 'Pharmacy Management', to: '/pharmacies', icon: Building2 },
            { label: 'Users & Roles', to: '/users', icon: Users },
            { label: 'Verification Center', to: '/verification', icon: ShieldCheck },
        ],
    },
    {
        heading: 'Medicine Intelligence',
        items: [
            { label: 'MediBase™ (Catalog)', to: '/medibase', icon: Network },
            { label: 'ZoikoAvail™ (Engine)', to: '/zoikoavail', icon: Webhook },
            { label: 'ZoikoSignal™ (Search)', to: '/zoikosignal', icon: Radar },
        ],
    },
    {
        heading: 'Workspace',
        items: [
            { label: 'Reports & Analytics', to: '/reports', icon: FileText },
            { label: 'Notifications', to: '/notifications', icon: Bell },
            { label: 'Audit Logs', to: '/audit-logs', icon: History },
            {
                label: 'API Integrations',
                to: '/settings?tab=integrations',
                icon: Blocks,
            },
            { label: 'System Settings', to: '/settings', icon: Settings, end: true },
        ],
    },
];
export const allNavLinks = navSections.flatMap((s) => s.items);
/** Per-route metadata for document titles + breadcrumbs. */
export const routeMeta = {
    '/dashboard': { title: 'Dashboard' },
    '/governance': { title: 'Leadership & Oversight', section: 'Platform Governance' },
    '/pharmacies': { title: 'Pharmacy Management', section: 'Platform Governance' },
    '/users': { title: 'Users & Roles', section: 'Platform Governance' },
    '/verification': { title: 'Verification Center', section: 'Platform Governance' },
    '/medibase': { title: 'MediBase™', section: 'Medicine Intelligence' },
    '/zoikoavail': { title: 'ZoikoAvail™', section: 'Medicine Intelligence' },
    '/zoikosignal': { title: 'ZoikoSignal™', section: 'Medicine Intelligence' },
    '/reports': { title: 'Reports & Analytics', section: 'Workspace' },
    '/notifications': { title: 'Notifications', section: 'Workspace' },
    '/audit-logs': { title: 'Audit Logs', section: 'Workspace' },
    '/settings': { title: 'Settings', section: 'Workspace' },
};
