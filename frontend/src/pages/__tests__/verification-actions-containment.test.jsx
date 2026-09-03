// @vitest-environment jsdom
//
// Verification Center — the three review actions staying inside the workspace
// card.
//
// "Reject Application", "Request Info" and "Approve Pharmacy" together need
// about 500px, and every Button carries `whitespace-nowrap shrink-0` — none of
// them can give up a pixel. The row was `flex items-center justify-end` with no
// wrap, inside a `lg:col-span-7` column of a 12-column grid keyed to the
// viewport. The 20rem Live Telemetry panel takes its width out of that column
// without moving a breakpoint, so at 1280px the workspace measured ~306px of
// content — and because the row is right-aligned, the overflow left the card by
// its *left* edge and ran across the queue column beside it.
//
// jsdom has no layout engine, so this holds the structural rules that make the
// overflow impossible rather than measuring pixels: the row wraps, the grid
// follows its own width, and neither column can be widened by its contents.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(resolve(cwd(), 'src/pages/VerificationCenter.jsx'), 'utf8')
const BUTTON = readFileSync(resolve(cwd(), 'src/components/ui/button.jsx'), 'utf8')

/** The class list of the row holding the three review actions. */
const ACTION_ROW =
  SOURCE.match(/className="(flex[^"]*justify-end[^"]*)"/)?.[1] ?? ''

/** The class list of the page's two-column grid. */
const PAGE_GRID = SOURCE.match(/className="(grid grid-cols-1 gap-6[^"]*)"/)?.[1] ?? ''

describe('the premise: these buttons cannot shrink', () => {
  it('every Button is nowrap and shrink-0', () => {
    // Which is why the containing row, not the buttons, has to give.
    expect(BUTTON).toContain('whitespace-nowrap')
    expect(BUTTON).toContain('shrink-0')
  })
})

describe('the action row', () => {
  it('exists and is still right-aligned', () => {
    expect(ACTION_ROW).not.toBe('')
    expect(ACTION_ROW).toContain('justify-end')
  })

  it('wraps, so it can never overflow at any width', () => {
    expect(ACTION_ROW).toContain('flex-wrap')
  })

  it('still carries all three actions', () => {
    for (const label of ['Reject Application', 'Request Info', 'Approve Pharmacy']) {
      expect(SOURCE).toContain(label)
    }
  })
})

describe('the page grid follows its own width, not the viewport', () => {
  it('is a query container', () => {
    // The telemetry panel changes this grid's width without changing the
    // viewport, so the viewport cannot be what decides the split.
    expect(SOURCE).toContain('@container')
  })

  it('no longer pins the split to a viewport breakpoint', () => {
    expect(PAGE_GRID).not.toBe('')
    expect(PAGE_GRID).not.toMatch(/\b(sm|md|lg|xl|2xl):grid-cols-/)
  })

  it('goes two columns only once the workspace can hold the row', () => {
    // 60rem is where col-span-7 of a gap-6 twelve-column grid clears 550px.
    expect(PAGE_GRID).toContain('@min-[60rem]:grid-cols-12')
    expect(PAGE_GRID).toContain('grid-cols-1')
  })

  it('spans both columns off the same threshold', () => {
    expect(SOURCE).toContain('@min-[60rem]:col-span-5')
    expect(SOURCE).toContain('@min-[60rem]:col-span-7')
    expect(SOURCE).not.toContain('lg:col-span-5')
    expect(SOURCE).not.toContain('lg:col-span-7')
  })

  it('stops either column being widened by its contents', () => {
    // A grid item defaults to `min-width: auto`, so an overflowing child widens
    // the track and pushes the card out of the grid rather than being clipped.
    expect(SOURCE).toContain('@min-[60rem]:col-span-5 flex min-w-0 flex-col')
    expect(SOURCE).toContain('min-w-0 @min-[60rem]:col-span-7')
  })
})

describe('the fix is structural, not cosmetic', () => {
  it('does not position the actions over the content', () => {
    expect(ACTION_ROW).not.toContain('absolute')
    expect(ACTION_ROW).not.toContain('fixed')
    expect(ACTION_ROW).not.toContain('sticky')
  })

  it('does not shrink the button text', () => {
    expect(ACTION_ROW).not.toMatch(/text-\[?(xs|10px|11px)/)
  })

  it('does not hide anything to make it fit', () => {
    expect(ACTION_ROW).not.toContain('overflow-hidden')
    expect(ACTION_ROW).not.toContain('truncate')
  })

  it('leaves Live Telemetry alone', () => {
    // The panel is not the bug and is not removed; the page just stops assuming
    // it is absent.
    expect(SOURCE).not.toContain('rightSidebarOpen')
  })
})
