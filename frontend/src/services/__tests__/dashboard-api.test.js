import { describe, it, expect } from 'vitest'
import {
  apportion,
  categorySeries,
  confidenceSeries,
  formatCount,
  formatDelta,
  formatPct,
  isGap,
  kpiCards,
  relativeAge,
  shortageSeries,
} from '../dashboard-api'

/**
 * The Super Admin dashboard used to ship a hardcoded control panel: 1,284
 * pharmacies, 42.8K searches at +4.2%, 98.6% confirmation, 244K API requests,
 * 99.99% uptime, 48 integrations, and a dozen PRNG-generated chart series.
 *
 * These tests hold the line that replaced it: a value is rendered only when the
 * API measured it, and a metric the platform cannot measure renders as a gap —
 * never as a plausible number.
 */

const gap = (reason = 'no source') => ({ available: false, reason, requires: 'something' })

/** A rollup exactly as /admin/dashboard/overview returns it. */
const overview = (over = {}) => ({
  generatedAt: new Date().toISOString(),
  regionsLive: 0,
  kpis: {
    totalPharmacies: { value: 13, spark: [11, 11, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13] },
    verifiedPharmacies: { value: 11, shareOfTotal: 85 },
    pendingVerifications: { value: 1 },
    activeUsers: { value: 9, spark: [8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9] },
    totalMedicines: { value: 54, spark: [52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 54] },
    searchesToday: { value: 47, previous: 40, changePct: 17.5, spark: [5, 0, 0, 11, 1, 0, 0, 67, 0, 0, 40, 47] },
    confirmationRate: gap('No CONFIRMATION signal events have been recorded.'),
    apiRequestsToday: gap('The platform does not record per-request telemetry.'),
    systemHealth: gap('No uptime or health-probe data is collected.'),
    activeIntegrations: gap('There is no integration or connector model in the schema.'),
  },
  confidence: { high: 72, moderate: 23, low: 2, unknown: 1, total: 98 },
  freshness: { slaHours: 6, withinSla: 2, total: 98, pct: 2 },
  shortage: [{ month: '2026-07', searches: 55, zeroResults: 30, unmetPct: 35 }],
  categories: { classified: 5, total: 54, items: [{ code: 'N', category: 'Nervous System', count: 2, share: 40 }] },
  unavailable: { availabilityTrend: gap(), regionalRisk: gap() },
  ...over,
})

const byId = (cards, id) => cards.find((c) => c.id === id)

describe('KPI cards carry measured values only', () => {
  it('renders the live counts the API returned', () => {
    const cards = kpiCards(overview())
    expect(byId(cards, 'total-pharmacies').value).toBe('13')
    expect(byId(cards, 'verified-pharmacies').value).toBe('11')
    expect(byId(cards, 'pending-verifications').value).toBe('1')
    expect(byId(cards, 'active-users').value).toBe('9')
    expect(byId(cards, 'total-medicines').value).toBe('54')
    expect(byId(cards, 'searches-today').value).toBe('47')
  })

  it('shows no card at all before the API responds', () => {
    // Critically: not the old seeded array.
    expect(kpiCards(null)).toEqual([])
    expect(kpiCards(undefined)).toEqual([])
  })

  it.each([
    ['confirmation-rate', 'Confirmation Rate'],
    ['api-requests', 'API Requests Today'],
    ['system-health', 'System Health'],
    ['active-integrations', 'Active Integrations'],
  ])('renders %s as an em dash with the reason, not a number', (id, label) => {
    const card = byId(kpiCards(overview()), id)
    expect(card.label).toBe(label)
    expect(card.value).toBe('—')
    expect(card.unavailable).toBe(true)
    expect(card.status.label).toBe('No data')
    expect(card.deltaLabel).toMatch(/\w/)
    expect(card.spark).toEqual([])
  })

  it('never reproduces the seeded control-panel figures', () => {
    const values = kpiCards(overview()).map((c) => `${c.value} ${c.delta ?? ''}`)
    for (const seeded of ['1,284', '3,482', '312.4K', '42.8K', '98.6%', '244K', '99.99%', '48']) {
      expect(values.join(' | ')).not.toContain(seeded)
    }
  })

  it('derives the pharmacy delta from the sparkline it displays', () => {
    // 13 today against 11 twelve days ago.
    expect(byId(kpiCards(overview()), 'total-pharmacies').delta).toBe('+2')
  })

  it('quotes the search change against yesterday', () => {
    const card = byId(kpiCards(overview()), 'searches-today')
    expect(card.delta).toBe('+17.5%')
    expect(card.deltaLabel).toContain('vs yesterday')
  })

  it('says so plainly when yesterday gives no baseline', () => {
    const cards = kpiCards(
      overview({
        kpis: { ...overview().kpis, searchesToday: { value: 47, previous: 0, changePct: null, spark: [] } },
      }),
    )
    const card = byId(cards, 'searches-today')
    expect(card.delta).toBeNull()
    expect(card.deltaLabel).toContain('no baseline')
  })

  it('reports Active Users as enabled accounts, not weekly active', () => {
    // There is no session history; the old caption claimed a metric the
    // platform cannot measure.
    expect(byId(kpiCards(overview()), 'active-users').deltaLabel).toBe('enabled accounts')
  })

  it('clears the pending-verification warning when the queue is empty', () => {
    const cards = kpiCards(
      overview({ kpis: { ...overview().kpis, pendingVerifications: { value: 0 } } }),
    )
    expect(byId(cards, 'pending-verifications').status).toEqual({ label: 'Clear', severity: 'good' })
  })

  it('shows a measured confirmation rate when events exist', () => {
    const cards = kpiCards(
      overview({ kpis: { ...overview().kpis, confirmationRate: { value: 82, sample: 50 } } }),
    )
    const card = byId(cards, 'confirmation-rate')
    expect(card.value).toBe('82%')
    expect(card.unavailable).toBeUndefined()
    expect(card.deltaLabel).toContain('50')
  })
})

describe('confidence distribution', () => {
  it('is the live signal mix, summing to 100%', () => {
    const series = confidenceSeries(overview())
    expect(series.map((s) => s.label)).toEqual(['High', 'Moderate', 'Low', 'Unknown'])
    expect(series.reduce((a, s) => a + s.value, 0)).toBe(100)
    expect(series[0].count).toBe(72)
  })

  it('is empty when no availability signals exist', () => {
    const empty = overview({ confidence: { high: 0, moderate: 0, low: 0, unknown: 0, total: 0 } })
    expect(confidenceSeries(empty)).toEqual([])
    expect(confidenceSeries(null)).toEqual([])
  })

  it.each([
    [[10, 43, 0, 1], 54],
    [[1, 1, 1], 3],
    [[72, 23, 2, 1], 98],
  ])('apportions %j to exactly 100', (values, total) => {
    expect(apportion(values, total).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('returns zeros rather than forcing 100 on an empty population', () => {
    expect(apportion([0, 0], 0)).toEqual([0, 0])
  })
})

describe('chart series', () => {
  it('maps categories from ATC groups', () => {
    expect(categorySeries(overview())).toEqual([
      { category: 'Nervous System', coverage: 40, count: 2 },
    ])
  })

  it('maps the shortage series to unmet demand per month', () => {
    expect(shortageSeries(overview())).toEqual([{ date: '2026-07', unmet: 35, searches: 55 }])
  })

  it.each([
    ['categories', categorySeries],
    ['shortage', shortageSeries],
    ['confidence', confidenceSeries],
  ])('%s is empty when the rollup failed to load', (_l, build) => {
    expect(build(null)).toEqual([])
    expect(build({})).toEqual([])
  })
})

describe('formatting', () => {
  it('renders an em dash where there is no number', () => {
    expect(formatCount(undefined)).toBe('—')
    expect(formatCount(null)).toBe('—')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1284)).toBe('1,284')
  })

  it('signs deltas and drops empty ones', () => {
    expect(formatDelta(37)).toBe('+37')
    expect(formatDelta(-5)).toBe('−5')
    expect(formatDelta(0)).toBeNull()
    expect(formatDelta(null)).toBeNull()
    expect(formatPct(4.2)).toBe('+4.2%')
    expect(formatPct(null)).toBeNull()
  })

  it('detects a declared gap', () => {
    expect(isGap(gap())).toBe(true)
    expect(isGap({ value: 5 })).toBe(false)
    expect(isGap(null)).toBe(false)
  })

  it('ages the rollup timestamp', () => {
    expect(relativeAge(new Date().toISOString())).toBe('just now')
    expect(relativeAge(new Date(Date.now() - 5 * 60000).toISOString())).toBe('5m ago')
    expect(relativeAge(null)).toBeNull()
  })
})
