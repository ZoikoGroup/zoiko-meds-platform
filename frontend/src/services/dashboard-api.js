import { apiFetch } from '@/lib/api-client'

// Super Admin dashboard (backend: modules/admin, SUPER_ADMIN role).
//
// There is deliberately no local dataset behind this page. Where the platform
// cannot measure something, the API returns `{ available: false, reason,
// requires }` and the UI renders the panel's container with that reason —
// never a stand-in number. On a governance console a fabricated figure is
// indistinguishable from a measured one, and someone will act on it.

/** Catalog-wide dashboard rollup: KPIs, confidence, freshness, shortage. */
export const getDashboardOverview = () => apiFetch('/admin/dashboard/overview')

/** True when the API declared this metric unmeasurable. */
export const isGap = (m) => !!m && m.available === false

const nf = new Intl.NumberFormat('en-US')

/** Thousands-separated count, or an em dash when there is no value. */
export const formatCount = (n) => (typeof n === 'number' ? nf.format(n) : '—')

/** Signed percentage, e.g. "+4.2%" / "−3.1%". */
export function formatPct(value) {
  if (typeof value !== 'number') return null
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value)}%`
}

/** Signed whole number, e.g. "+37" / "−5". */
export function formatDelta(value) {
  if (typeof value !== 'number' || value === 0) return null
  return value > 0 ? `+${nf.format(value)}` : `−${nf.format(Math.abs(value))}`
}

const trendOf = (n) => (typeof n !== 'number' || n === 0 ? 'flat' : n > 0 ? 'up' : 'down')

/** The card shape for a metric the platform cannot measure. */
function unavailableCard(id, label, gapInfo) {
  return {
    id,
    label,
    value: '—',
    delta: null,
    // The card's caption becomes the reason, so the gap is legible on the
    // dashboard itself rather than only in a report.
    deltaLabel: gapInfo?.reason ?? 'No data source',
    trend: 'flat',
    upIsGood: true,
    status: { label: 'No data', severity: 'neutral' },
    spark: [],
    unavailable: true,
  }
}

/** Change between the first and last point of a sparkline, when it has one. */
function sparkDelta(spark) {
  if (!Array.isArray(spark) || spark.length < 2) return null
  return spark[spark.length - 1] - spark[0]
}

/**
 * The ten KPI cards, in the dashboard's existing order.
 *
 * Labels and captions describe what is actually measured. Two differ from the
 * original mock because the mock's wording claimed something the data does not
 * support: "weekly active" (no session history exists — this counts enabled
 * accounts) and "vs last month" (the series is the trailing 12 days).
 */
export function kpiCards(overview) {
  if (!overview) return []
  const k = overview.kpis
  const pharmacyDelta = sparkDelta(k.totalPharmacies?.spark)
  const userDelta = sparkDelta(k.activeUsers?.spark)
  const medicineDelta = sparkDelta(k.totalMedicines?.spark)

  return [
    {
      id: 'total-pharmacies',
      label: 'Total Pharmacies',
      value: formatCount(k.totalPharmacies?.value),
      delta: formatDelta(pharmacyDelta),
      deltaLabel: 'vs 12 days ago',
      trend: trendOf(pharmacyDelta),
      upIsGood: true,
      status: { label: 'Active', severity: 'good' },
      spark: k.totalPharmacies?.spark ?? [],
    },
    {
      id: 'verified-pharmacies',
      label: 'Verified Pharmacies',
      value: formatCount(k.verifiedPharmacies?.value),
      delta: `${k.verifiedPharmacies?.shareOfTotal ?? 0}%`,
      deltaLabel: 'of the estate certified',
      trend: 'flat',
      upIsGood: true,
      status: { label: 'Compliant', severity: 'good' },
      spark: [],
    },
    {
      id: 'pending-verifications',
      label: 'Pending Verifications',
      value: formatCount(k.pendingVerifications?.value),
      delta: null,
      deltaLabel: 'review queue',
      trend: 'flat',
      upIsGood: false,
      status:
        (k.pendingVerifications?.value ?? 0) > 0
          ? { label: 'Pending Action', severity: 'warning' }
          : { label: 'Clear', severity: 'good' },
      spark: [],
    },
    {
      id: 'active-users',
      label: 'Active Users',
      value: formatCount(k.activeUsers?.value),
      delta: formatDelta(userDelta),
      // Not weekly-active: no session or last-seen data exists to measure that.
      deltaLabel: 'enabled accounts',
      trend: trendOf(userDelta),
      upIsGood: true,
      status: { label: 'Enabled', severity: 'good' },
      spark: k.activeUsers?.spark ?? [],
    },
    {
      id: 'total-medicines',
      label: 'Total Medicines',
      value: formatCount(k.totalMedicines?.value),
      delta: formatDelta(medicineDelta),
      deltaLabel: 'in MediBase catalog',
      trend: trendOf(medicineDelta),
      upIsGood: true,
      status: { label: 'Expanding', severity: 'good' },
      spark: k.totalMedicines?.spark ?? [],
    },
    {
      id: 'searches-today',
      label: 'Searches Today',
      value: formatCount(k.searchesToday?.value),
      delta: formatPct(k.searchesToday?.changePct),
      // No baseline yesterday means no percentage to quote, so say which it is.
      deltaLabel:
        k.searchesToday?.changePct == null
          ? 'ZoikoSignal volume · no baseline yesterday'
          : 'ZoikoSignal volume vs yesterday',
      trend: trendOf(k.searchesToday?.changePct),
      upIsGood: true,
      status: { label: 'Nominal', severity: 'good' },
      spark: k.searchesToday?.spark ?? [],
    },
    isGap(k.confirmationRate)
      ? unavailableCard('confirmation-rate', 'Confirmation Rate', k.confirmationRate)
      : {
          id: 'confirmation-rate',
          label: 'Confirmation Rate',
          value: `${k.confirmationRate?.value ?? 0}%`,
          delta: null,
          deltaLabel: `across ${formatCount(k.confirmationRate?.sample)} signal events`,
          trend: 'flat',
          upIsGood: true,
          status: { label: 'Measured', severity: 'good' },
          spark: [],
        },
    unavailableCard('api-requests', 'API Requests Today', k.apiRequestsToday),
    unavailableCard('system-health', 'System Health', k.systemHealth),
    unavailableCard('active-integrations', 'Active Integrations', k.activeIntegrations),
  ]
}

/**
 * Confidence-band percentages that sum to 100 (largest remainder), so the
 * legend adds up to the share the centre figure claims.
 */
export function confidenceSeries(overview) {
  const c = overview?.confidence
  if (!c || !c.total) return []
  const counts = [c.high, c.moderate, c.low, c.unknown]
  const pcts = apportion(counts, c.total)
  const meta = [
    { level: 'high', label: 'High' },
    { level: 'moderate', label: 'Moderate' },
    { level: 'low', label: 'Low' },
    { level: 'unknown', label: 'Unknown' },
  ]
  return meta.map((m, i) => ({ ...m, value: pcts[i], count: counts[i] }))
}

/** Therapeutic categories, strongest first, as the bar chart consumes them. */
export function categorySeries(overview) {
  const items = overview?.categories?.items ?? []
  return items.map((c) => ({ category: c.category, coverage: c.share, count: c.count }))
}

/** Monthly unmet-demand series for the shortage chart. */
export function shortageSeries(overview) {
  return (overview?.shortage ?? []).map((m) => ({
    date: m.month,
    unmet: m.unmetPct,
    searches: m.searches,
  }))
}

/**
 * Percentages summing to exactly 100 when the bands partition the population.
 * Rounding each independently drifts to 99 or 101, which a legend beside a
 * "share of total" heading cannot afford.
 */
export function apportion(values, total) {
  if (!(total > 0)) return values.map(() => 0)
  const plain = values.map((v) => Math.round((v / total) * 100))
  if (values.reduce((a, b) => a + b, 0) !== total) return plain

  const exact = values.map((v) => (v / total) * 100)
  const out = exact.map(Math.floor)
  let remaining = 100 - out.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), size: values[i] }))
    .sort((a, b) => b.frac - a.frac || b.size - a.size)
  for (const { i } of order) {
    if (remaining <= 0) break
    out[i] += 1
    remaining -= 1
  }
  return out
}

/** "2m ago" style age for the rollup timestamp in the hero. */
export function relativeAge(iso) {
  if (!iso) return null
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
