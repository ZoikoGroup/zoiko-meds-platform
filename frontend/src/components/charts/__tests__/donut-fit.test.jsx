// @vitest-environment jsdom
//
// The donut has to fit the card it is given, not the window.
//
// Both users of this chart (admin Dashboard → Confidence Distribution, MediBase →
// Normalization Status) put it in one column of a three-column grid. Opening the
// Live Telemetry panel takes 20rem off the main column, so that grid track loses
// roughly 150px at 1280px — but the row-vs-stack decision was a `sm:` breakpoint,
// which asks how wide the *window* is and learns nothing about the card. The row
// layout stayed on in a card far too narrow, and because the chart was
// `shrink-0` at a fixed pixel width and the legend could not shrink below its
// min-content, the difference left the card and ran under the panel.
//
// jsdom computes no layout, so what is asserted here is the contract that
// produces the right geometry: a container query instead of a media query, and
// nothing in the row with an immovable minimum.

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Donut } from '../donut'

// recharts' ResponsiveContainer observes its box; jsdom ships no ResizeObserver.
// It never reports a size here, which is fine — the chart's geometry is not what
// these tests read, only the classes that govern it.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

// The MediBase figures from the report, including the long label that set the floor.
const DATA = [
  { label: 'Fully normalized', value: 15, color: '#0a0' },
  { label: 'Pending mapping', value: 0, color: '#fa0' },
  { label: 'Conflict / review', value: 85, color: '#e33' },
]

const renderDonut = (props = {}) =>
  render(<Donut data={DATA} centerValue="15%" centerLabel="Normalized" {...props} />)

const classesOf = (el) => (el.getAttribute('class') || '').split(/\s+/)
const legend = () => screen.getByRole('list')

afterEach(cleanup)

describe('the layout responds to the card, not the viewport', () => {
  it('declares a container so its own width drives the decision', () => {
    const { container } = renderDonut()

    const scope = container.querySelector('.\\@container')

    expect(scope).not.toBeNull()
  })

  it('switches to a row on a container query, never a media query', () => {
    // The distinction is the whole bug: `sm:flex-row` is true at 1280px whether
    // the card has 150px or 400px to work with.
    const { container } = renderDonut()

    const row = container.querySelector('[class*="flex-col"][class*="flex-row"]')

    expect(row).not.toBeNull()
    const classes = classesOf(row)
    expect(classes).not.toContain('sm:flex-row')
    expect(classes.some((c) => /^@min-\[[^\]]+\]:flex-row$/.test(c))).toBe(true)
    // Stacked is the default; the row is the enhancement.
    expect(classes).toContain('flex-col')
  })
})

describe('nothing in the row has an immovable minimum', () => {
  it('lets the chart shrink below its nominal size', () => {
    // It was `shrink-0` with an inline fixed `width`, so it never gave ground.
    const { container } = renderDonut({ height: 180 })

    const chart = container.querySelector('.aspect-square')

    expect(chart).not.toBeNull()
    expect(classesOf(chart)).toContain('w-full')
    // A ceiling, not a fixed width.
    expect(chart.style.maxWidth).toBe('180px')
    expect(chart.style.width).toBe('')
  })

  it('lets the legend shrink past its min-content width', () => {
    // Without min-w-0 the longest label sets a floor the legend cannot pass,
    // and the excess becomes overflow rather than a narrower legend.
    renderDonut()

    expect(classesOf(legend())).toContain('min-w-0')
  })

  it('lets each label wrap instead of forcing the row wider', () => {
    renderDonut()

    const label = screen.getByText('Fully normalized')

    expect(classesOf(label)).toContain('min-w-0')
  })

  it('keeps the percentage at full size, so it stays readable', () => {
    // The value must not be what gets squeezed — it is the number being read.
    renderDonut()

    // Scoped to the legend: "15%" is also the centre readout.
    const row = within(legend())
      .getAllByRole('listitem')
      .find((li) => li.textContent.includes('Fully normalized'))
    const value = within(row).getByText('15%')

    expect(classesOf(value)).toContain('shrink-0')
  })

  it('keeps the colour swatch square rather than crushed', () => {
    renderDonut()

    const swatch = legend().querySelector('[aria-hidden]')

    expect(classesOf(swatch)).toContain('shrink-0')
  })
})

describe('no information is dropped to make it fit', () => {
  it('still lists every band with its value', () => {
    renderDonut()

    const rows = within(legend()).getAllByRole('listitem')

    expect(rows).toHaveLength(DATA.length)
    for (const d of DATA) {
      expect(rows.some((r) => r.textContent.includes(d.label))).toBe(true)
      expect(rows.some((r) => r.textContent.includes(`${d.value}%`))).toBe(true)
    }
  })

  it('keeps the centre readout', () => {
    renderDonut()

    expect(screen.getByText('Normalized')).toBeDefined()
  })

  it('respects a caller-supplied unit', () => {
    cleanup()
    render(<Donut data={[{ label: 'Signals', value: 12 }]} unit="" />)

    expect(within(legend()).getByText('12')).toBeDefined()
  })
})
