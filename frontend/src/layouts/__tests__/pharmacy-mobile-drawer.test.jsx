// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

/**
 * The pharmacy portal's navigation drawer on a phone.
 *
 * Reported from a real device: the drawer showed the menu down to Settings and
 * no further. Partner Support and Sign Out were below the fold with no way to
 * scroll to them, and the only way to reach them was to pinch-zoom the page
 * out — which shrank the dashboard to unreadable and left the layout looking
 * broken.
 *
 * The cause was one utility. The nav was `flex-1 overflow-y-auto shrink-0
 * lg:shrink`: a column flex child with `flex-shrink: 0` is laid out at its full
 * content height regardless of the container's, so seventeen rows made it
 * taller than the drawer, the `mt-auto` footer was pushed past the bottom edge,
 * and `overflow-y-auto` never engaged because the box was never smaller than
 * its contents. `lg:shrink` handed shrinking back at 1024px, which is why the
 * desktop rail was fine and only the drawer broke.
 *
 * WHAT THESE TESTS CAN AND CANNOT SHOW
 *
 * jsdom has no layout engine: every element reports zero height, so nothing
 * here can observe an overflow, a scroll, or a row falling off a screen. What
 * they hold is the contract that makes scrolling possible — the box may shrink,
 * has somewhere to scroll, and is not clamped by `min-height: auto` — plus the
 * fact that the footer rows are rendered inside the drawer at all. Whether the
 * result is right on a handset is a question only a handset answers.
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

const { PharmacyLayout } = await import('../pharmacy-layout')

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/pharmacy/dashboard']}>
      <PharmacyLayout />
    </MemoryRouter>,
  )

/** Open the drawer the way a phone user does. */
const openDrawer = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  renderLayout()
  await user.click(screen.getByRole('button', { name: /open navigation/i }))
  return screen.getByRole('dialog')
}

/** The scrolling nav inside a given drawer or rail. */
const navIn = (root) => root.querySelector('nav[aria-label="Pharmacy portal"]')

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

describe('the drawer reaches every menu item', () => {
  it('renders Partner Support inside the drawer', async () => {
    const drawer = await openDrawer()

    expect(drawer.textContent).toContain('Partner Support')
  })

  it('renders Sign Out inside the drawer', async () => {
    const drawer = await openDrawer()

    expect(drawer.textContent).toContain('Sign Out')
  })

  it('hides no menu item to make room', async () => {
    // The fix was not to shorten the menu. Every route the rail offers is still
    // in the drawer.
    const drawer = await openDrawer()

    for (const label of [
      'Dashboard', 'Inventory', 'Availability',
      'CSV Upload', 'Integration', 'Participation',
      'Reports', 'Notifications',
      'Pharmacy Profile', 'Billing', 'Settings',
      'Partner Support', 'Sign Out',
    ]) {
      expect(drawer.textContent).toContain(label)
    }
  })
})

describe('the nav can actually scroll', () => {
  it('is allowed to shrink below its content', async () => {
    // The regression guard, and the whole bug in one assertion: `shrink-0` here
    // is what put Partner Support off-screen.
    const nav = navIn(await openDrawer())

    expect(nav.className).not.toMatch(/(^|\s)shrink-0(\s|$)/)
    expect(nav.className).not.toMatch(/lg:shrink(\s|$)/)
  })

  it('is not clamped by the default min-height of a flex item', async () => {
    // Without `min-h-0` a column flex child stops at its content height even
    // when its shrink factor would allow less, so removing `shrink-0` alone
    // would not have been enough.
    const nav = navIn(await openDrawer())

    expect(nav.className).toMatch(/(^|\s)min-h-0(\s|$)/)
  })

  it('takes the leftover height and scrolls it', async () => {
    const nav = navIn(await openDrawer())

    expect(nav.className).toMatch(/(^|\s)flex-1(\s|$)/)
    expect(nav.className).toMatch(/overflow-y-auto/)
  })

  it('keeps its scroll to itself', async () => {
    // So reaching the end of the menu does not start scrolling the dashboard
    // behind the drawer.
    const nav = navIn(await openDrawer())

    expect(nav.className).toMatch(/overscroll-contain/)
  })

  it('leaves the footer pinned rather than scrolling with the list', async () => {
    const drawer = await openDrawer()
    const footer = drawer.querySelector('.mt-auto')

    expect(footer).not.toBeNull()
    expect(footer.textContent).toContain('Sign Out')
    // Not inside the scrolling area — it is the sibling below it.
    expect(navIn(drawer).contains(footer)).toBe(false)
  })
})

describe('the drawer is as tall as the visible viewport', () => {
  it('is sized in dvh, not vh or a percentage of the containing block', async () => {
    // `h-full` on a fixed element resolves against the initial containing
    // block, which on a mobile browser is the viewport with the URL bar
    // assumed hidden — so the last rows sat behind the browser chrome.
    const drawer = await openDrawer()

    expect(drawer.className).toMatch(/h-\[100dvh\]/)
    expect(drawer.className).not.toMatch(/(^|\s)h-full(\s|$)/)
  })

  it('keeps the bottom row clear of the system inset', async () => {
    const drawer = await openDrawer()
    const footer = drawer.querySelector('.mt-auto')

    expect(footer.className).toContain('pb-[env(safe-area-inset-bottom)]')
  })
})

describe('the desktop rail is untouched', () => {
  it('still reserves its own column, and only from lg up', async () => {
    const { container } = renderLayout()
    const rail = container.querySelector('aside')

    expect(rail.className).toContain('hidden')
    expect(rail.className).toContain('lg:block')
    expect(rail.className).toContain('w-64')
    expect(rail.className).toContain('fixed')
  })

  it('shares the one nav markup with the drawer, so neither can drift', async () => {
    const { container } = renderLayout()

    expect(navIn(container.querySelector('aside'))).not.toBeNull()
  })

  it('offsets the content for the rail only at lg, never on a phone', async () => {
    // The offset a drawer layout must not keep: a mobile viewport reserving
    // 16rem for a sidebar that is display:none is 16rem of blank space.
    const { container } = renderLayout()
    const main = container.querySelector('main').parentElement

    expect(main.className).toContain('lg:pl-64')
    expect(main.className).not.toMatch(/(^|\s)pl-64(\s|$)/)
    expect(main.className).not.toMatch(/(^|\s)ml-64(\s|$)/)
  })

  it('measures its own height in dvh as well', async () => {
    const { container } = renderLayout()
    const main = container.querySelector('main').parentElement

    expect(main.className).toMatch(/min-h-dvh/)
    expect(main.className).not.toMatch(/min-h-screen/)
  })
})

describe('the content column cannot force a horizontal scrollbar', () => {
  it('is bounded by the viewport rather than by a fixed width', async () => {
    // `max-w` caps and `w-full` fills; neither can push the document wider than
    // the screen. A `w-[…]` or a `min-w-` here could, which is what this holds.
    const { container } = renderLayout()
    const column = container.querySelector('main > * > *') ?? container.querySelector('main > *')

    expect(column.className).toContain('w-full')
    expect(column.className).toMatch(/max-w-\[1400px\]/)
    expect(column.className).not.toMatch(/(^|\s)min-w-/)
    // Anchored: an unanchored /w-\[\d+px\]/ matches the tail of `max-w-[1400px]`,
    // which is the cap doing its job rather than a fixed width.
    expect(column.className).not.toMatch(/(^|\s)w-\[\d+px\]/)
    expect(column.className).not.toMatch(/100vw/)
  })
})
