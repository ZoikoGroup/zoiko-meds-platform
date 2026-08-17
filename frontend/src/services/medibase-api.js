import { apiFetch } from '@/lib/api-client'

// MediBase™ catalog governance (backend: modules/medibase, ADMIN role).
//
// Every figure on the MediBase page comes from these two endpoints. There is
// deliberately no local catalog dataset: a governance dashboard that invents
// its own numbers is worse than one that says it could not load, because the
// numbers look exactly as authoritative either way.

function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v)
  })
  const str = search.toString()
  return str ? `?${str}` : ''
}

/** Catalog-wide normalization, quality and governance statistics. */
export const getCatalogOverview = () => apiFetch('/medibase/admin/catalog/overview')

/** Paginated generic identities. `search` matches a generic root or trade name. */
export const listIdentities = (params) =>
  apiFetch(`/medibase/admin/catalog/identities${qs(params)}`)

// --- presentation mapping ---------------------------------------------------
// The API speaks in counts; the UI speaks in labelled, ordered series. These
// map one onto the other so the page itself holds no numbers.

/** Percentage of `total`, rounded, guarding the empty-catalog divide-by-zero. */
export const share = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

/**
 * Percentages for a set of bands that partition the catalog, guaranteed to sum
 * to 100 when the catalog is non-empty.
 *
 * Rounding each band on its own is what made the panels read 19 + 80 + 2 =
 * 101%: three values each rounded up half a point. Largest-remainder
 * apportionment hands the leftover points to the bands with the biggest
 * fractional parts instead, so the displayed figures add up to what the header
 * claims they are a share of.
 *
 * The correction is only applied when the bands genuinely account for every
 * record. If they do not, each band is rounded plainly so the shortfall stays
 * visible rather than being papered over into a tidy 100%.
 */
export function apportion(values, total) {
  if (!(total > 0)) return values.map(() => 0)

  const plain = values.map((v) => share(v, total))
  const sum = values.reduce((a, b) => a + b, 0)
  if (sum !== total) return plain

  const exact = values.map((v) => (v / total) * 100)
  const floors = exact.map(Math.floor)
  let remaining = 100 - floors.reduce((a, b) => a + b, 0)

  // Biggest fractional part first; ties go to the larger band.
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), size: values[i] }))
    .sort((a, b) => b.frac - a.frac || b.size - a.size)

  const out = [...floors]
  for (const { i } of order) {
    if (remaining <= 0) break
    out[i] += 1
    remaining -= 1
  }
  return out
}

/**
 * Compact count for the identifier-mapping row and governance tiles: 1.34M,
 * 312.4K, 148. Matches the existing visual density of those cards, which were
 * previously hardcoded in that abbreviated form.
 */
export function compact(n) {
  const v = Number(n) || 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}

/** Donut series for Normalization Status, in the order the legend lists them. */
export function normalizationSeries(overview) {
  const n = overview?.normalization
  if (!n) return []
  const [normalized, pending, conflict] = apportion(
    [n.normalized, n.pending, n.conflict],
    overview.total || 0,
  )
  return [
    { label: 'Fully normalized', value: normalized, severity: 'good' },
    { label: 'Pending mapping', value: pending, severity: 'warning' },
    { label: 'Conflict / review', value: conflict, severity: 'serious' },
  ]
}

/** Tier bars. Descriptions restate the backend rule, they are not data. */
export function qualitySeries(overview) {
  const q = overview?.quality
  if (!q) return []
  const [a, b, c] = apportion([q.A, q.B, q.C], overview.total || 0)
  return [
    { level: 'A', label: 'Tier A — verified', value: a, description: 'Multi-source verified, governed.' },
    { level: 'B', label: 'Tier B — provisional', value: b, description: 'Single-source, pending corroboration.' },
    { level: 'C', label: 'Tier C — restricted', value: c, description: 'Controlled or suppressed identities.' },
  ]
}

/** The four governance tiles, each with its live share of the catalog. */
export function governanceSeries(overview) {
  const g = overview?.governance
  if (!g) return []
  const counts = [g.governed, g.inReview, g.restricted, g.suppressed]
  const pcts = apportion(counts, overview.total || 0)
  const labels = ['Governed identities', 'In review', 'Restricted', 'Suppressed']
  return labels.map((label, i) => ({
    label,
    value: compact(counts[i]),
    hint: `${pcts[i]}% of catalog`,
  }))
}

/** The brand → generic → strength → form → market mapping row. */
export function identifierSeries(overview) {
  const m = overview?.identifierMapping
  if (!m) return []
  return [
    { layer: 'Brand', count: compact(m.brands), description: 'Trade names mapped to a governed generic root.' },
    { layer: 'Generic', count: compact(m.generics), description: 'Normalized INN-level identities.' },
    { layer: 'Strength', count: compact(m.strengths), description: 'Dose-strength variants resolved per identity.' },
    { layer: 'Dosage form', count: compact(m.dosageForms), description: 'Route and presentation classifications.' },
    { layer: 'Market', count: compact(m.markets), description: 'Jurisdiction-scoped availability contexts.' },
  ]
}

/**
 * Identity-graph branches for one generic root. Returns null when the catalog
 * is empty — the graph illustrates a real identity or it shows nothing.
 */
export function identityGraphFor(identity) {
  if (!identity) return null
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  return {
    root: { id: identity.id, label: identity.generic, kind: 'generic' },
    branches: [
      { id: 'brand', label: 'Brand', kind: 'brand', value: plural(identity.brands, 'trade name', 'trade names'), angle: -140 },
      { id: 'strength', label: 'Strength', kind: 'strength', value: plural(identity.strengths, 'dose strength', 'dose strengths'), angle: -70 },
      { id: 'form', label: 'Dosage form', kind: 'form', value: plural(identity.dosageForms, 'presentation', 'presentations'), angle: 0 },
      { id: 'market', label: 'Market', kind: 'market', value: plural(identity.markets, 'jurisdiction', 'jurisdictions'), angle: 70 },
      { id: 'quality', label: 'Governance', kind: 'quality', value: `Tier ${identity.quality} · ${identity.governance}`, angle: 140 },
    ],
  }
}
