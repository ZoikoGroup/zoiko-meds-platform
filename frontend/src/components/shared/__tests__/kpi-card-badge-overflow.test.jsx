// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Clock } from 'lucide-react'
import { KpiCard } from '../kpi-card'
import { kpiCards } from '@/services/dashboard-api'

/**
 * The "Pending Action" badge used to leave its card.
 *
 * Not because the badge was too wide — because the KPI grid was keyed to the
 * viewport (`lg:grid-cols-5`) while the 20rem Live Telemetry panel took its
 * space out of the row without moving a breakpoint. Five columns then measured
 * ~112px at 1280px, ~176px even at the 1600px max-width cap; the card's own
 * content box was 72–136px, and the header row wanted about 152px. A Badge is
 * `whitespace-nowrap shrink-0`, so it could not give up a pixel, and the
 * surplus spilled out of a Card that carries `overflow-hidden`.
 *
 * Only this one card overflowed because only this one shows a 14-character
 * label, and only while the review queue is non-empty — at zero it reads
 * "Clear". Which is exactly the reported "overlaps only when Live Telemetry is
 * open".
 *
 * jsdom has no layout engine, so these tests hold the two structural rules
 * that make the overflow impossible rather than measuring pixels: the grid
 * sizes to its own width, and the header row wraps.
 */

const SOURCE = (path) => readFileSync(resolve(cwd(), path), 'utf8')
const DASHBOARD = SOURCE('src/pages/Dashboard.jsx')
const CARD = SOURCE('src/components/shared/kpi-card.jsx')

/** The KPI grid's own class list — the only grid on the page with five columns. */
const KPI_GRID = DASHBOARD.match(/className="([^"]*grid-cols-5[^"]*)"/)?.[1] ?? ''

const overview = (pending) => ({
  kpis: {
    totalPharmacies: { value: 12, spark: [] },
    verifiedPharmacies: { value: 9, shareOfTotal: 75 },
    pendingVerifications: { value: pending },
    activeUsers: { value: 40, spark: [] },
    totalMedicines: { value: 800, spark: [] },
    searchesToday: { value: 5, previous: 4, changePct: 25, spark: [] },
  },
})

/** The Pending Verifications card as the dashboard builds it. */
const pendingCard = (pending) =>
  kpiCards(overview(pending)).find((m) => m.id === 'pending-verifications')

const renderPending = (pending) => {
  const { container } = render(<KpiCard metric={pendingCard(pending)} icon={Clock} />)
  return container
}

const headerRow = (container) => container.querySelector('.flex-wrap')

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

describe('the KPI grid sizes to the space it actually has', () => {
  it('is a query container', () => {
    // The panel changes the grid's width without changing the viewport, so the
    // grid has to measure itself.
    expect(DASHBOARD).toContain('@container')
  })

  it('no longer pins its columns to a viewport breakpoint', () => {
    expect(KPI_GRID).not.toBe('')
    expect(KPI_GRID).not.toMatch(/\b(sm|md|lg|xl|2xl):grid-cols-/)
  })

  it('steps 1 → 2 → 3 → 5 columns on its own width', () => {
    // Each threshold leaves ≥192px per column, which is the ~152px the header
    // row needs plus the card's 40px of padding.
    for (const cls of [
      'grid-cols-1',
      '@min-[25rem]:grid-cols-2',
      '@min-[38rem]:grid-cols-3',
      '@min-[64rem]:grid-cols-5',
    ]) {
      expect(KPI_GRID).toContain(cls)
    }
  })
})

describe('the card header row wraps instead of overflowing', () => {
  it('lets the row wrap', () => {
    expect(headerRow(renderPending(3))).not.toBeNull()
  })

  it('keeps the icon square rather than letting it absorb the badge', () => {
    const icon = renderPending(3).querySelector('.size-9')
    expect(icon.className).toContain('shrink-0')
  })

  it('puts the icon and the badge in the same wrapping row', () => {
    const row = headerRow(renderPending(3))
    expect(row.querySelector('.size-9')).not.toBeNull()
    expect(row.contains(screen.getByText('Pending Action'))).toBe(true)
  })

  it('leaves the badge sizing to its own content', () => {
    renderPending(3)
    const pill = screen.getByText('Pending Action').closest('span')
    expect(pill.className).toContain('w-fit')
  })
})

describe('the fix is structural, not cosmetic', () => {
  it('does not shrink the label', () => {
    // The rejected shortcut. "Pending Action" is the operator's cue that the
    // review queue needs attention; abbreviating it hides the problem.
    expect(pendingCard(3).status.label).toBe('Pending Action')
  })

  it('does not shrink the badge text', () => {
    renderPending(3)
    const pill = screen.getByText('Pending Action').closest('span')
    // The `sm` badge size, unchanged.
    expect(pill.className).toContain('text-[11px]')
  })

  it('does not take the badge out of the flow', () => {
    // The other rejected shortcut: absolute positioning would stop the badge
    // overlapping the card edge by making it overlap the value instead.
    expect(CARD).not.toMatch(/StatusBadge[^>]*className="[^"]*absolute/)
    renderPending(3)
    const pill = screen.getByText('Pending Action').closest('span')
    expect(pill.className).not.toContain('absolute')
  })

  it('keeps the overflow guard, so a future long label is clipped and not smeared', () => {
    expect(CARD).toContain('overflow-hidden')
  })
})

describe('every queue depth the card can be in', () => {
  it('reads Clear at zero, and never overflows because it cannot', () => {
    const container = renderPending(0)
    expect(screen.getByText('Clear')).toBeDefined()
    expect(screen.getByText('0')).toBeDefined()
    expect(headerRow(container)).not.toBeNull()
  })

  it('reads Pending Action at one', () => {
    renderPending(1)
    expect(screen.getByText('Pending Action')).toBeDefined()
    expect(screen.getByText('1')).toBeDefined()
  })

  it('reads Pending Action at 99', () => {
    renderPending(99)
    expect(screen.getByText('Pending Action')).toBeDefined()
    expect(screen.getByText('99')).toBeDefined()
  })

  it('still wraps rather than clips at four figures', () => {
    const container = renderPending(1240)
    expect(screen.getByText('Pending Action')).toBeDefined()
    expect(screen.getByText('1,240')).toBeDefined()
    expect(headerRow(container)).not.toBeNull()
  })
})
