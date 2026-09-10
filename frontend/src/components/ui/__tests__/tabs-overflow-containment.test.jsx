// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs'

/**
 * The tab strip may be wider than the phone. The document may not.
 *
 * Measured in headless Chrome at a 360px layout viewport, Super Admin →
 * Commercial reported `documentElement.scrollWidth` of 568 against a
 * `clientWidth` of 360. Walking every element whose bounding rect escaped the
 * viewport, and discarding any with a clipping or scrolling ancestor, left
 * exactly one uncontained offender:
 *
 *   div.inline-flex.h-9.w-fit …   left 16, right 568, width 552, over 208
 *
 * — the TabsList. Five triggers with `whitespace-nowrap` come to 552px, `w-fit`
 * let the strip take all of it, and nothing above clipped, so that width became
 * the document's. The whole page could then be dragged sideways, which is what
 * made the test-mode banner and the Approved Prices card look clipped on the
 * left with a blank strip on the right.
 *
 * The Approved Prices table was NOT the cause and was not changed: the same
 * measurement showed a 947px table sitting inside a 278px scroll box, already
 * contained exactly as intended.
 *
 * After the wrapper, the same page measures 360 at every one of 320, 360, 375,
 * 390, 412 and 430, on all five tabs, and 1440 on a desktop.
 *
 * WHAT THIS TEST CAN SHOW
 *
 * jsdom has no layout engine, so it cannot repeat that measurement — every rect
 * is zero. It holds the structure the measurement proved necessary: a scroll
 * container that can shrink, wrapping a strip that keeps its natural width.
 */

const renderTabs = () =>
  render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Price catalog</TabsTrigger>
        <TabsTrigger value="b">Offers</TabsTrigger>
        <TabsTrigger value="c">Customers &amp; invoices</TabsTrigger>
        <TabsTrigger value="d">Billing access</TabsTrigger>
        <TabsTrigger value="e">Policy</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Catalog</TabsContent>
    </Tabs>,
  )

const strip = () => screen.getByRole('tablist')
const wrapper = () => strip().parentElement

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

describe('the tab strip scrolls itself rather than the page', () => {
  it('sits inside a horizontal scroll container', () => {
    renderTabs()

    expect(wrapper().className).toMatch(/overflow-x-auto/)
  })

  it('gives that container a width it cannot exceed', () => {
    // `w-full max-w-full` bounds it to the parent; `min-w-0` is what stops it
    // being sized by its content when the parent is a flex or grid container,
    // which would leave it 552px wide with nothing to scroll.
    renderTabs()
    const cls = wrapper().className

    expect(cls).toMatch(/(^|\s)w-full(\s|$)/)
    expect(cls).toMatch(/(^|\s)min-w-0(\s|$)/)
    expect(cls).toMatch(/(^|\s)max-w-full(\s|$)/)
  })

  it('keeps that scroll to itself', () => {
    renderTabs()

    expect(wrapper().className).toMatch(/overscroll-x-contain/)
  })

  it('lets the strip keep its natural width inside the box', () => {
    // `w-max`, not `w-fit`: the strip should stay as wide as its labels and let
    // the box scroll, rather than being squashed by the container.
    renderTabs()

    expect(strip().className).toMatch(/(^|\s)w-max(\s|$)/)
    expect(strip().className).not.toMatch(/(^|\s)w-fit(\s|$)/)
  })

  it('hides no tab to make room', () => {
    renderTabs()

    for (const label of ['Price catalog', 'Offers', 'Customers & invoices', 'Billing access', 'Policy']) {
      expect(screen.getByRole('tab', { name: label })).toBeDefined()
    }
  })

  it('still switches tabs', async () => {
    renderTabs()

    expect(screen.getByRole('tab', { name: 'Price catalog' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel')).toBeDefined()
  })

  it('keeps the triggers unwrappable, which is why the box scrolls', () => {
    renderTabs()

    expect(screen.getByRole('tab', { name: 'Policy' }).className).toMatch(/whitespace-nowrap/)
  })
})
