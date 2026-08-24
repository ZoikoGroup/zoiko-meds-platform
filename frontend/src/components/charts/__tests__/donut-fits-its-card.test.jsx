// @vitest-environment jsdom
//
// Donut — must fit the card it is in, not the window it is on (MSA-28).
//
// The Super Admin dashboard puts this in one column of a three-column grid.
// That card holds 146–338px of content depending on screen width and whether
// the activity panel is open, while the donut used to lay itself out against
// the `sm:` viewport breakpoint — 640px of window — and reserve a hard 180px
// ring that refused to shrink. The row then needed ~334px, and Card has no
// overflow-hidden, so it spilled over the border onto the panel beside it.
//
// jsdom has no layout engine, so width cannot be asserted directly. What is
// asserted instead is the mechanism that makes the overflow impossible, since
// reintroducing either half of it reintroduces the bug.

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Donut } from '@/components/charts/donut'

// Recharts measures its container, which jsdom reports as 0×0 — it would warn
// and render nothing. The wrapper markup is what is under test here.
vi.mock('recharts', () => {
  const Passthrough = ({ children }) => <div>{children}</div>
  return {
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: Passthrough,
    Cell: () => null,
    Tooltip: () => null,
  }
})

const DATA = [
  { label: 'High confidence', value: 62 },
  { label: 'Moderate confidence', value: 24 },
  { label: 'Low confidence', value: 14 },
]

const renderDonut = () => {
  const { container } = render(
    <Donut data={DATA} centerValue="62%" centerLabel="High confidence" />,
  )
  return container
}

describe('Donut sizing', () => {
  it('splits on its own container width, not the viewport', () => {
    const container = renderDonut()

    expect(container.querySelector('.\\@container')).not.toBeNull()
    const row = container.querySelector('.\\@md\\:flex-row')
    expect(row).not.toBeNull()
    // The viewport breakpoint is what made a 232px card lay out as if it had
    // 640px to work with.
    expect(container.querySelector('.sm\\:flex-row')).toBeNull()
  })

  it('caps the ring rather than fixing it, so it can never exceed the card', () => {
    const container = renderDonut()

    const ring = container.querySelector('[style*="max-width"]')
    expect(ring).not.toBeNull()
    expect(ring.style.maxWidth).toBe('180px')
    // A fixed width is the thing that could not shrink. Height comes from
    // aspect-square now, so neither dimension is pinned.
    expect(ring.style.width).toBe('')
    expect(ring.style.height).toBe('')
    expect(ring.className).toContain('aspect-square')
  })

  it('lets a long legend label truncate instead of widening the row', () => {
    const container = renderDonut()

    const label = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === 'Moderate confidence',
    )
    expect(label).not.toBeNull()
    expect(label.className).toContain('truncate')
    // truncate only works if an ancestor may shrink below min-content.
    expect(container.querySelector('ul').className).toContain('min-w-0')
  })
})
