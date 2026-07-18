import { apiFetch, getToken } from '@/lib/api-client'

// ZoikoSignal™ intelligence — the governed, aggregate-only demand & shortage
// surface (backend: modules/signal). Contract-scoped: requires an ENTERPRISE,
// GOVERNMENT or ADMIN role (SUPER_ADMIN satisfies). Everything here is
// k-anonymity-safe aggregate data — never user-level or exact stock.

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v)
  })
  const str = search.toString()
  return str ? `?${str}` : ''
}

/** High-level demand / shortage summary over a window. */
export function getIntelligenceSummary(params = {}) {
  return apiFetch(`/signal/intelligence/summary${qs(params)}`)
}

/** Time-bucketed, anonymized aggregate cells. */
export function getIntelligenceCells(params = {}) {
  return apiFetch(`/signal/intelligence${qs(params)}`)
}

/**
 * Stream a governed intelligence export (JSON or CSV) and trigger a download.
 * Goes direct to the API (not apiFetch) so we can save the raw file body.
 */
export async function downloadIntelligenceExport(params = {}, format = 'json') {
  const token = getToken()
  const res = await fetch(
    `${BASE_URL}/signal/intelligence/export${qs({ ...params, format })}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  )
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename =
    match?.[1] || `zoikosignal-intelligence.${format === 'csv' ? 'csv' : 'json'}`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
