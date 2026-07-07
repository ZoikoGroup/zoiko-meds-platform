import { Building2, Blocks, FileText, HeartPulse, Landmark, LayoutDashboard, Network, Radar, Settings, Webhook, } from 'lucide-react';
export const navSections = [
    {
        items: [
            { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, end: true },
        ],
    },
    {
        heading: 'Medicine Intelligence',
        items: [
            { label: 'ZoikoSignal™', to: '/zoikosignal', icon: Radar },
            { label: 'ZoikoAvail™ API', to: '/zoikoavail', icon: Webhook },
            { label: 'MediBase™', to: '/medibase', icon: Network },
        ],
    },
    {
        heading: 'Solutions',
        items: [
            { label: 'Health Systems', to: '/health-systems', icon: HeartPulse },
            { label: 'Government & Public Health', to: '/government', icon: Landmark },
            { label: 'Enterprise Solutions', to: '/enterprise', icon: Building2 },
        ],
    },
    {
        heading: 'Workspace',
        items: [
            { label: 'Reports', to: '/reports', icon: FileText },
            {
                label: 'API Integrations',
                to: '/settings?tab=integrations',
                icon: Blocks,
            },
            { label: 'Settings', to: '/settings', icon: Settings, end: true },
        ],
    },
];
export const allNavLinks = navSections.flatMap((s) => s.items);
/** Per-route metadata for document titles + breadcrumbs. */
export const routeMeta = {
    '/dashboard': { title: 'Dashboard' },
    '/zoikosignal': { title: 'ZoikoSignal™', section: 'Medicine Intelligence' },
    '/zoikoavail': { title: 'ZoikoAvail™ API', section: 'Medicine Intelligence' },
    '/medibase': { title: 'MediBase™', section: 'Medicine Intelligence' },
    '/health-systems': { title: 'Health Systems', section: 'Solutions' },
    '/government': { title: 'Government & Public Health', section: 'Solutions' },
    '/enterprise': { title: 'Enterprise Solutions', section: 'Solutions' },
    '/reports': { title: 'Reports', section: 'Workspace' },
    '/settings': { title: 'Settings', section: 'Workspace' },
};
