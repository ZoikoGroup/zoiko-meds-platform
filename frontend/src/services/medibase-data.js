/**
 * Identity-graph examples use public generic (INN) names purely to illustrate
 * brand↔generic↔strength↔form↔market normalization. All attached metrics are
 * synthetic enterprise-intelligence values.
 */
export const medicineIdentities = [
    { id: 'm1', generic: 'Amoxicillin', brandCount: 214, strengths: 6, dosageForms: 5, markets: 92, normalization: 99, governance: 'governed', quality: 'A' },
    { id: 'm2', generic: 'Metformin', brandCount: 188, strengths: 4, dosageForms: 3, markets: 88, normalization: 98, governance: 'governed', quality: 'A' },
    { id: 'm3', generic: 'Atorvastatin', brandCount: 176, strengths: 5, dosageForms: 2, markets: 84, normalization: 97, governance: 'governed', quality: 'A' },
    { id: 'm4', generic: 'Salbutamol', brandCount: 143, strengths: 3, dosageForms: 4, markets: 79, normalization: 94, governance: 'in-review', quality: 'B' },
    { id: 'm5', generic: 'Omeprazole', brandCount: 201, strengths: 4, dosageForms: 3, markets: 90, normalization: 96, governance: 'governed', quality: 'A' },
    { id: 'm6', generic: 'Amlodipine', brandCount: 167, strengths: 4, dosageForms: 2, markets: 82, normalization: 95, governance: 'governed', quality: 'A' },
    { id: 'm7', generic: 'Levothyroxine', brandCount: 98, strengths: 8, dosageForms: 2, markets: 71, normalization: 91, governance: 'in-review', quality: 'B' },
    { id: 'm8', generic: 'Azithromycin', brandCount: 154, strengths: 3, dosageForms: 4, markets: 77, normalization: 88, governance: 'restricted', quality: 'C' },
];
export const identifierMapping = [
    { layer: 'Brand', count: '1.34M', description: 'Trade names mapped to a governed generic root.' },
    { layer: 'Generic', count: '312.4K', description: 'Normalized INN-level identities.' },
    { layer: 'Strength', count: '48.2K', description: 'Dose-strength variants resolved per identity.' },
    { layer: 'Dosage form', count: '11.7K', description: 'Route and presentation classifications.' },
    { layer: 'Market', count: '148', description: 'Jurisdiction-scoped availability contexts.' },
];
export const normalizationStatus = [
    { label: 'Fully normalized', value: 87, severity: 'good' },
    { label: 'Pending mapping', value: 9, severity: 'warning' },
    { label: 'Conflict / review', value: 4, severity: 'serious' },
];
export const qualityLevels = [
    { level: 'A', label: 'Tier A — verified', value: 62, description: 'Multi-source verified, governed.' },
    { level: 'B', label: 'Tier B — provisional', value: 29, description: 'Single-source, pending corroboration.' },
    { level: 'C', label: 'Tier C — restricted', value: 9, description: 'Controlled or suppressed identities.' },
];
/** Schematic identity graph — a governed generic root fanning out to layers. */
export const identityGraph = {
    root: { id: 'root', label: 'Amoxicillin', kind: 'generic' },
    branches: [
        { id: 'brand', label: 'Brand', kind: 'brand', value: '214 trade names', angle: -140 },
        { id: 'strength', label: 'Strength', kind: 'strength', value: '6 dose strengths', angle: -70 },
        { id: 'form', label: 'Dosage form', kind: 'form', value: '5 presentations', angle: 0 },
        { id: 'market', label: 'Market', kind: 'market', value: '92 jurisdictions', angle: 70 },
        { id: 'quality', label: 'Governance', kind: 'quality', value: 'Tier A · governed', angle: 140 },
    ],
};
export const governanceIndicators = [
    { label: 'Governed identities', value: '298.1K', hint: '95.4% of catalog' },
    { label: 'In review', value: '10.6K', hint: '3.4% of catalog' },
    { label: 'Restricted', value: '3.7K', hint: 'Controlled substances' },
    { label: 'Suppressed', value: '0.9K', hint: 'Policy-withheld' },
];
