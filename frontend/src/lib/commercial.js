// Commercial constants — ZM-COM-BILL-001.
//
// The doctrine tables, transcribed once so the console cannot drift from the
// document. Prices are deliberately absent: the only figure that may be shown as
// chargeable comes from the price catalog API. The $99-$299 Pro figure below is
// labelled a marketing range precisely because it must never be treated as a
// price (S-E2, S-M2).

/** S-2 — canonical commercial architecture. */
export const COMMERCIAL_OFFERS = [
  {
    code: 'PATIENT_CAREGIVER_ACCESS',
    label: 'Patient & Caregiver Access',
    role: 'Free public/user access',
    metric: 'No paid metric',
    launchPrice: 'Free',
    status: 'LOCKED',
    statusNote: 'Locked free launch access',
    variant: 'success',
  },
  {
    code: 'PHARMACY_NETWORK_CORE',
    label: 'Pharmacy Network Core',
    role: 'Supply-density participation',
    metric: 'Verified pharmacy location',
    launchPrice: 'Free',
    status: 'LOCKED',
    statusNote:
      'Free during the approved supply-density build phase. Never auto-converts to paid; any future change needs a new catalog version, notice and explicit acceptance.',
    variant: 'success',
  },
  {
    code: 'PHARMACY_INTELLIGENCE_PRO',
    label: 'Pharmacy Intelligence Pro',
    role: 'Operational intelligence',
    metric: 'Verified paid pharmacy location',
    launchPrice: 'Marketing range $99–$299 / location / month',
    status: 'EXACT PRICE REQUIRED',
    statusNote:
      'The published range is marketing copy, not a charge instruction. An approved per-market catalog record is required before any charge.',
    variant: 'warning',
  },
  {
    code: 'ENTERPRISE_API_DATA',
    label: 'Enterprise / API / Data',
    role: 'Institutional infrastructure',
    metric: 'Contract-defined',
    launchPrice: 'Custom',
    status: 'SALES-LED',
    statusNote: 'The signed Order Form controls scope, metric and billing schedule.',
    variant: 'info',
  },
]

/** Commercial classification → how it should read in the console. */
export const CLASSIFICATION_META = {
  DIRECTORY_UNCLAIMED: { label: 'Directory (unclaimed)', variant: 'secondary', billable: false },
  CLAIMED_PENDING: { label: 'Claimed — authority pending', variant: 'warning', billable: false },
  VERIFICATION_IN_REVIEW: { label: 'Verification in review', variant: 'warning', billable: false },
  VERIFIED_NETWORK_CORE: { label: 'Network Core (free)', variant: 'success', billable: false },
  PRO_EVALUATION: { label: 'Pro evaluation', variant: 'info', billable: false },
  PRO_ACTIVE: { label: 'Intelligence Pro', variant: 'default', billable: true },
  ENTERPRISE_CONTRACT_ACTIVE: { label: 'Enterprise contract', variant: 'default', billable: true },
  PILOT_NON_BILLABLE: { label: 'Pilot (non-billable)', variant: 'secondary', billable: false },
  INTERNAL: { label: 'Internal', variant: 'secondary', billable: false },
  DEMO: { label: 'Demo', variant: 'secondary', billable: false },
  QA: { label: 'QA', variant: 'secondary', billable: false },
  STAGING: { label: 'Staging', variant: 'secondary', billable: false },
  PARTNER_SANDBOX: { label: 'Partner sandbox', variant: 'secondary', billable: false },
  SUSPENDED_COMPLIANCE: { label: 'Suspended (compliance)', variant: 'danger', billable: false },
  REJECTED: { label: 'Rejected', variant: 'danger', billable: false },
  CLOSED: { label: 'Closed', variant: 'secondary', billable: false },
}

/** S-22 — the canonical billing RBAC matrix, as published. */
export const BILLING_RBAC_MATRIX = [
  {
    role: 'Pharmacy Org Owner',
    viewPlanUsage: 'Yes',
    paymentMethods: 'Yes',
    changePlan: 'Yes',
    cancel: 'Yes',
    refund: 'Request / policy',
    discounts: 'Yes',
    invoices: 'Yes',
  },
  {
    role: 'Billing Admin',
    viewPlanUsage: 'Yes',
    paymentMethods: 'Yes',
    changePlan: 'Yes',
    cancel: 'Yes',
    refund: 'Request / policy',
    discounts: 'Within policy',
    invoices: 'Yes',
  },
  {
    role: 'Pharmacy Admin / Superintendent',
    viewPlanUsage: 'Plan/usage only',
    paymentMethods: 'No',
    changePlan: 'No',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'No financial detail',
  },
  {
    role: 'Location Manager',
    viewPlanUsage: 'Location only',
    paymentMethods: 'No',
    changePlan: 'Request only',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'No',
  },
  {
    role: 'Pharmacist / Staff',
    viewPlanUsage: 'Operational limits only',
    paymentMethods: 'No',
    changePlan: 'No',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'No',
  },
  {
    role: 'Patient / Caregiver',
    viewPlanUsage: 'No',
    paymentMethods: 'No',
    changePlan: 'No',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'No',
  },
  {
    role: 'Enterprise Contract Admin',
    viewPlanUsage: 'Per scope',
    paymentMethods: 'Per contract',
    changePlan: 'Per contract',
    cancel: 'Per contract',
    refund: 'Request / policy',
    discounts: 'Per contract',
    invoices: 'Per scope',
  },
  {
    role: 'ZoikoMeds Billing Ops',
    viewPlanUsage: 'Tenant-scoped',
    paymentMethods: 'Support workflow',
    changePlan: 'Support workflow',
    cancel: 'Policy-controlled',
    refund: 'Policy-controlled',
    discounts: 'Policy-controlled',
    invoices: 'Internal/support',
  },
  {
    role: 'ZoikoMeds Verification Ops',
    viewPlanUsage: 'No payment access',
    paymentMethods: 'No',
    changePlan: 'No',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'No',
  },
  {
    role: 'Engineering',
    viewPlanUsage: 'No routine access',
    paymentMethods: 'No',
    changePlan: 'No',
    cancel: 'No',
    refund: 'No',
    discounts: 'No',
    invoices: 'Test mode only',
  },
]

/** Billing capabilities that can be granted, mirroring the backend enum. */
export const BILLING_CAPABILITIES = [
  { code: 'VIEW_PLAN_AND_USAGE', label: 'View plan & usage' },
  { code: 'VIEW_INVOICES', label: 'View invoices' },
  { code: 'MANAGE_PAYMENT_METHODS', label: 'Manage payment methods' },
  { code: 'CHANGE_PLAN', label: 'Change plan' },
  { code: 'CANCEL_SUBSCRIPTION', label: 'Cancel subscription' },
  { code: 'MANAGE_DISCOUNTS_AND_ADDONS', label: 'Manage discounts & add-ons' },
  { code: 'APPROVE_REFUND_OR_CREDIT', label: 'Approve refund or credit', financial: true },
  { code: 'MANAGE_PRICE_CATALOG', label: 'Manage price catalog', financial: true },
  { code: 'GRANT_CAPABILITIES', label: 'Grant capabilities to others', financial: true },
]

/** S-L1 — self-serve Pro delinquency timeline. Enterprise follows its contract. */
export const DELINQUENCY_TIMELINE = [
  { day: 'Day 0', action: 'Payment failure — recovery notices sent' },
  { day: 'Day 7', action: 'New paid-location expansion blocked' },
  { day: 'Day 14', action: 'Pro exports and advanced paid actions restricted' },
  {
    day: 'Day 20',
    action: 'Unpaid Pro downgrades to Network Core — the pharmacy stays in the free network',
  },
]

/** S-K3 — usage notification thresholds. */
export const USAGE_THRESHOLDS = [70, 85, 100]

/** Format minor units for display. Never used to compute a charge. */
export function formatMinor(amountMinor, currency) {
  if (amountMinor === null || amountMinor === undefined) return '—'
  const major = amountMinor / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(major)
  } catch {
    // Unknown currency code — show the number rather than crashing the page.
    return `${major.toFixed(2)} ${currency || ''}`.trim()
  }
}

export const BILLING_INTERVALS = [
  { code: 'MONTH', label: 'Monthly' },
  { code: 'YEAR', label: 'Annual' },
  { code: 'CONTRACT_DEFINED', label: 'Contract-defined' },
]

export const BILLING_CHANNELS = [
  { code: 'WEB_SELF_SERVE', label: 'Web self-serve' },
  { code: 'SALES_CONTRACT', label: 'Sales contract' },
  { code: 'MOBILE_COMPANION_ENTITLEMENT', label: 'Mobile companion entitlement' },
]
