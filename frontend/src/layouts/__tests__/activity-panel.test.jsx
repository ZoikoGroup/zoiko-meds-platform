// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The Live Telemetry panel showed a fabricated console.
 *
 * "Availability Engine — Healthy", "SSO Gateways — 100% Uptime", a stock
 * shortage in APAC, a licence expiring in three days, two pharmacies awaiting
 * approval in London and Berlin, an API key rotated three hours ago — none of
 * it came from anywhere. There was no fetch in the file at all, and every
 * "2h ago" was a string literal that had read "2h ago" since the day it was
 * written. An operator watching that panel was watching a picture of a
 * platform, not this one.
 *
 * These tests hold every row to a source: the gateway telemetry endpoint, the
 * verification queue, the audit log — or an honest placeholder where the
 * platform has nothing to report.
 */

const telemetry = vi.fn()
const verifications = vi.fn()
const auditLogs = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getZoikoAvailTelemetry: (...a) => telemetry(...a),
  listVerifications: (...a) => verifications(...a),
  listAuditLogs: (...a) => auditLogs(...a),
}))

// The layout renders the whole admin chrome; the parts under test are the four
// panel sections, so the rest is stubbed down to nothing.
vi.mock('@/layouts/sidebar', () => ({ Sidebar: () => null }))
vi.mock('@/layouts/topbar', () => ({ Topbar: () => null }))
vi.mock('@/layouts/command-palette', () => ({ CommandPalette: () => null }))
vi.mock('@/providers/theme-provider', () => ({ useTheme: () => ({ toggleTheme: () => {} }) }))

const { AppLayout } = await import('../app-layout')

// vitest runs from the frontend root, so the source is addressable from cwd.
const SOURCE = readFileSync(resolve(cwd(), 'src/layouts/app-layout.jsx'), 'utf8')

const HOURS = (n) => new Date(Date.now() - n * 3600_000).toISOString()

const HEALTH = {
  health: { status: 'operational', uptime: 99.4, p50: 42, p99: 310, requests24h: 1284 },
}

const QUEUE = [
  { id: 'v1', pharmacy: 'Northgate Chemist', city: 'Leeds', status: 'PENDING', date: HOURS(2) },
  {
    id: 'v2',
    pharmacy: 'Riverside Pharmacy',
    city: 'Bristol',
    status: 'UNDER_REVIEW',
    date: HOURS(5),
  },
  {
    id: 'v3',
    pharmacy: 'Old Mill Dispensary',
    city: 'Derby',
    status: 'APPROVED',
    date: HOURS(9),
  },
]

const AUDIT = {
  items: [
    {
      id: 'a1',
      action: 'pharmacy.inventory.import',
      summary: 'Imported 42 medicines for Northgate Chemist',
      actor: 'ops@zoiko.test',
      timestamp: HOURS(1),
    },
  ],
}

const renderPanel = () =>
  render(
    <MemoryRouter initialEntries={['/admin/dashboard']}>
      <AppLayout />
    </MemoryRouter>,
  )

/** The section box that follows a given panel heading. */
const sectionFor = (heading) => screen.getByRole('heading', { name: heading }).parentElement

beforeEach(() => {
  localStorage.setItem('zoiko-right-sidebar-open', '1')
  telemetry.mockResolvedValue(HEALTH)
  verifications.mockResolvedValue(QUEUE)
  auditLogs.mockResolvedValue(AUDIT)
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('nothing in the panel is invented', () => {
  it.each([
    'Availability Engine',
    'Normalization Sync',
    'SSO Gateways',
    '100% Uptime',
    'Stock Shortage: APAC',
    'Insulin supply chain latency detected in region.',
    'Licensing Expiry Warning',
    'Meridian Pharmacy Group license expires in 3 days.',
    'City Meds Clinic',
    'PharmaCare Ltd',
    'API Key Rotated',
    'Atlas BioSupply rotated key ID ending ...8f91.',
    'Backup Finished',
    'Database snapshot completed (Size: 4.8 GB).',
  ])('never renders the fabricated %s', async (text) => {
    renderPanel()
    await waitFor(() => expect(telemetry).toHaveBeenCalled())
    expect(screen.queryByText(text)).toBeNull()
  })

  it('has no hardcoded relative timestamp left in the source', () => {
    // The old panel's ages were string literals: 10m ago, 1h ago, 2h ago,
    // 5h ago, 3h ago, 6h ago. Every age on screen is now computed from a real
    // ISO timestamp by relativeAge(), so none of these can appear unless the
    // data says so.
    expect(SOURCE).not.toMatch(/["'`]\s*\d+[mhd] ago/)
  })
})

describe('Live Telemetry', () => {
  it('reports the gateway health the backend measured', async () => {
    renderPanel()
    expect(await screen.findByText('Healthy')).toBeDefined()
    expect(screen.getByText('99.4%')).toBeDefined()
    expect(screen.getByText('42 ms')).toBeDefined()
    expect(screen.getByText('1,284')).toBeDefined()
  })

  it('says degraded when the gateway is degraded', async () => {
    telemetry.mockResolvedValue({ health: { ...HEALTH.health, status: 'degraded' } })
    renderPanel()
    expect(await screen.findByText('Degraded')).toBeDefined()
  })

  it('shows no data when the gateway log is empty', async () => {
    // A real reading of an unused gateway, not a missing feature.
    telemetry.mockResolvedValue({
      health: { status: 'disabled', uptime: null, p50: null, p99: null, requests24h: 0 },
    })
    renderPanel()
    await waitFor(() =>
      expect(within(sectionFor('Live Telemetry')).getByText('No data available')).toBeDefined(),
    )
  })

  it('shows no data when the endpoint fails rather than a green tick', async () => {
    telemetry.mockRejectedValue(new Error('502'))
    renderPanel()
    await waitFor(() =>
      expect(within(sectionFor('Live Telemetry')).getByText('No data available')).toBeDefined(),
    )
  })

  it('does not blank the other feeds when telemetry fails', async () => {
    telemetry.mockRejectedValue(new Error('502'))
    renderPanel()
    expect(await screen.findByText('Northgate Chemist')).toBeDefined()
    expect(await screen.findByText('Pharmacy Inventory Import')).toBeDefined()
  })
})

describe('Critical Alerts', () => {
  it('is marked Coming soon, because nothing can produce an alert', () => {
    // No alert or incident model exists, and Pharmacy has no licence expiry
    // column — so neither alert the panel used to show is computable at all.
    renderPanel()
    const section = sectionFor('Critical Alerts')
    expect(within(section).getByText('Coming soon')).toBeDefined()
    expect(within(section).getByText(/not yet available/i)).toBeDefined()
  })
})

describe('Pending Approvals', () => {
  it('lists the pharmacies actually waiting on a reviewer', async () => {
    renderPanel()
    expect(await screen.findByText('Northgate Chemist')).toBeDefined()
    expect(screen.getByText('Riverside Pharmacy')).toBeDefined()
    expect(screen.getByText('Leeds')).toBeDefined()
  })

  it('leaves out a request that has already been decided', async () => {
    renderPanel()
    await screen.findByText('Northgate Chemist')
    expect(screen.queryByText('Old Mill Dispensary')).toBeNull()
  })

  it('dates each row from its own timestamp', async () => {
    renderPanel()
    await screen.findByText('Northgate Chemist')
    const rows = within(sectionFor('Pending Approvals')).getAllByRole('link')
    expect(within(rows[0]).getByText('2h ago')).toBeDefined()
    expect(within(rows[1]).getByText('5h ago')).toBeDefined()
  })

  it('says so when the queue is empty', async () => {
    verifications.mockResolvedValue([])
    renderPanel()
    await waitFor(() =>
      expect(
        within(sectionFor('Pending Approvals')).getByText('No pending approvals'),
      ).toBeDefined(),
    )
  })

  it('caps the list at what the panel has room for', async () => {
    verifications.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        id: `v${i}`,
        pharmacy: `Pharmacy ${i}`,
        city: 'Leeds',
        status: 'PENDING',
        date: HOURS(i + 1),
      })),
    )
    renderPanel()
    await screen.findByText('Pharmacy 0')
    expect(within(sectionFor('Pending Approvals')).getAllByRole('link')).toHaveLength(3)
  })
})

describe('Recent Activity', () => {
  it('shows the audit log, titled readably', async () => {
    renderPanel()
    expect(await screen.findByText('Pharmacy Inventory Import')).toBeDefined()
    expect(screen.getByText('Imported 42 medicines for Northgate Chemist')).toBeDefined()
  })

  it('credits the actor and ages the entry from its timestamp', async () => {
    renderPanel()
    await screen.findByText('Pharmacy Inventory Import')
    expect(screen.getByText('ops@zoiko.test · 1h ago')).toBeDefined()
  })

  it('asks the backend only for what it can show', async () => {
    renderPanel()
    await waitFor(() => expect(auditLogs).toHaveBeenCalledWith({ page: 1, pageSize: 4 }))
  })

  it('says no data when the log is empty', async () => {
    auditLogs.mockResolvedValue({ items: [] })
    renderPanel()
    await waitFor(() =>
      expect(within(sectionFor('Recent Activity')).getByText('No data available')).toBeDefined(),
    )
  })
})

describe('the panel only costs anything while it is open', () => {
  it('fetches nothing when the panel is closed', async () => {
    localStorage.setItem('zoiko-right-sidebar-open', '0')
    renderPanel()
    await new Promise((r) => setTimeout(r, 0))
    expect(telemetry).not.toHaveBeenCalled()
    expect(verifications).not.toHaveBeenCalled()
    expect(auditLogs).not.toHaveBeenCalled()
  })
})
