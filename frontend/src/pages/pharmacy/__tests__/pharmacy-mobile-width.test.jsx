// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

/**
 * Two ways the pharmacy portal grew wider than the phone it was on.
 *
 * THE ACCOUNT MENU
 *
 * Tapping the avatar put a blank strip down the right-hand side of the whole
 * page. Not the menu's doing — the menu is portalled, positioned `fixed`, and
 * Radix clamps it to the viewport. It was the scroll lock behind it.
 *
 * A Radix menu is modal by default, which locks body scroll through
 * react-remove-scroll. That library hides the scrollbar and compensates for
 * the space it leaves with `body[data-scroll-locked] { margin-right: <gap>px }`,
 * where gap is `window.innerWidth - document.documentElement.clientWidth`. On a
 * desktop that difference is the scrollbar and the compensation is right. On a
 * phone there is no scrollbar: the difference is visual viewport minus layout
 * viewport, which is zero at 100% zoom and large once pinched out. So the page
 * was given a margin for a scrollbar that does not exist.
 *
 * The fix is a media-query override in index.css rather than `modal={false}`
 * on each menu, because it is a fact about touch devices rather than about any
 * one menu — and it leaves dismissal, focus trapping and outside-click alone.
 *
 * THE INVENTORY HEADER
 *
 * Export CSV, Import CSV and Add medicine sat in a flex row that could not
 * wrap. Every Button is `whitespace-nowrap`, so the row's min-content width is
 * the sum of all three — about 354px, against the 328 a 360px screen has after
 * the page's padding. PageHeader wraps its own actions, but this row is a
 * single item to it, so it had to wrap itself.
 *
 * WHAT THESE TESTS CAN AND CANNOT SHOW
 *
 * jsdom has no layout engine and applies no stylesheet: `scrollWidth` is
 * always 0, media queries never match, and index.css is never parsed. Nothing
 * here measures an overflow. The CSS rule is asserted by reading the
 * stylesheet, and the markup by its classes. Both are contracts, not pixels —
 * only a real device shows the result.
 */

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { name: 'Corner Chemist', email: 'ops@corner.test', initials: 'CC', roleLabel: 'Pharmacy' },
    logout: vi.fn(),
  }),
}))

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}))

const { PharmacyLayout } = await import('@/layouts/pharmacy-layout')

// vitest runs from the frontend root, so both sources are addressable from cwd.
const INDEX_CSS = readFileSync(resolve(cwd(), 'src/index.css'), 'utf8')
const INVENTORY = readFileSync(resolve(cwd(), 'src/pages/pharmacy/PharmacyInventory.jsx'), 'utf8')

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/pharmacy/dashboard']}>
      <PharmacyLayout />
    </MemoryRouter>,
  )

describe('the account menu does not put a margin on the page', () => {
  it('cancels the scrollbar compensation on a touch device', () => {
    // The rule react-remove-scroll writes, and the one that undoes it.
    const touchBlock = INDEX_CSS.slice(INDEX_CSS.indexOf('@media (hover: none) and (pointer: coarse)'))

    expect(touchBlock).toContain('body[data-scroll-locked]')
    expect(touchBlock).toMatch(/margin-right:\s*0\s*!important/)
  })

  it('leaves the compensation alone on a desktop', () => {
    // Behind a touch-primary query, so a mouse still gets the scrollbar gap it
    // needs and content does not jump when a menu opens.
    // Stated once, and only inside the touch query — an unconditional override
    // would make content jump sideways on every desktop menu open.
    // Comments stripped first: the rule is quoted in the one above it, and a
    // count that included prose would be counting the explanation.
    const rules = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules.match(/body\[data-scroll-locked\]/g) ?? []).toHaveLength(1)
    expect(INDEX_CSS).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*body\[data-scroll-locked\]/,
    )
  })

  it('still opens the account menu with every action', async () => {
    // The fix must not have cost the menu anything.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderLayout()

    await user.click(screen.getByRole('button', { name: /account menu/i }))
    const menu = await screen.findByRole('menu')

    expect(menu.textContent).toContain('ops@corner.test')
    expect(screen.getByRole('menuitem', { name: /pharmacy profile/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeDefined()
  })

  it('keeps the menu narrower than the narrowest phone', async () => {
    // 16rem against a 320px viewport. A width in vw, or one wider than this,
    // would overflow whatever the scroll lock did.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderLayout()

    await user.click(screen.getByRole('button', { name: /account menu/i }))
    const menu = await screen.findByRole('menu')

    expect(menu.className).toMatch(/(^|\s)w-64(\s|$)/)
    // The shared content carries `min-w-[12rem]` — 192px, inside a 320px
    // screen with room to spare. A floor in pixels is what would not be.
    expect(menu.className).not.toMatch(/min-w-\[\d+px\]/)
    expect(menu.className).not.toMatch(/100vw/)
  })

  it('truncates a long identity rather than widening the menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderLayout()

    await user.click(screen.getByRole('button', { name: /account menu/i }))
    const menu = await screen.findByRole('menu')
    const email = [...menu.querySelectorAll('span')].find((el) =>
      el.textContent.includes('ops@corner.test'),
    )

    expect(email.className).toContain('truncate')
    expect(email.parentElement.className).toContain('min-w-0')
  })
})

describe('the mobile header still carries its controls', () => {
  it('offers the menu, the theme switch and the account', () => {
    renderLayout()

    expect(screen.getByRole('button', { name: /open navigation/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /account menu/i })).toBeDefined()
  })

  it('shows the page title', () => {
    // Scoped to the header: "Dashboard" is also a link in the sidebar rail.
    const { container } = renderLayout()
    const header = container.querySelector('header')

    expect(header.textContent).toContain('Dashboard')
  })
})

describe('the inventory header wraps instead of overflowing', () => {
  it('lets the three action buttons fall onto a second line', () => {
    expect(INVENTORY).toMatch(/className="flex flex-wrap items-center gap-2"/)
    expect(INVENTORY).not.toMatch(/className="flex items-center gap-2">\s*\n\s*<Button variant="outline" size="sm" onClick=\{exportCsv\}/)
  })

  it('keeps all three actions, rather than dropping one to fit', () => {
    for (const label of ['Export CSV', 'Import CSV', 'Add medicine']) {
      expect(INVENTORY).toContain(label)
    }
  })
})

describe('a wide inventory table scrolls itself, not the page', () => {
  const DATA_TABLE = readFileSync(resolve(cwd(), 'src/components/shared/data-table.jsx'), 'utf8')
  const TABLE = readFileSync(resolve(cwd(), 'src/components/ui/table.jsx'), 'utf8')

  it('bounds the table in its own scrolling box', () => {
    // Already the case, and worth pinning: this is what stops a ten-column
    // inventory from making the whole document wider than the phone.
    expect(DATA_TABLE).toContain('overflow-auto')
    expect(TABLE).toContain('overflow-x-auto')
  })

  it('does not lock the shell to a desktop width', () => {
    expect(DATA_TABLE).not.toMatch(/(^|\s|")min-w-\[\d+px\]/)
    expect(INVENTORY).not.toMatch(/(^|\s|")min-w-\[/)
    expect(INVENTORY).not.toMatch(/(^|\s|")w-\[\d+px\]/)
    expect(INVENTORY).not.toContain('100vw')
  })

  it('keeps its dialog inside a phone', () => {
    // `sm:max-w-[440px]` — capped only once there is room for it. Unprefixed,
    // the cap would still not overflow, but the base dialog is `w-full` and
    // this states the intent.
    expect(INVENTORY).toMatch(/sm:max-w-\[440px\]/)
  })
})
