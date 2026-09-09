// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * The Super Admin shell on a phone.
 *
 * Three things were reported from a real device, and they turned out to be
 * three separate faults that happened to look like one:
 *
 *  1. The navigation drawer stopped partway down. `SheetContent` was
 *     `fixed inset-y-0 h-full`, and `height: 100%` on a fixed element resolves
 *     against the initial containing block — which on a mobile browser is the
 *     viewport with the URL bar assumed hidden. So the drawer was taller than
 *     the screen, and API Integrations, System Settings and the Help Center
 *     footer sat below the visible area with nothing able to scroll to them:
 *     the drawer is fixed, so the page scroll does not move it.
 *
 *  2. The account menu appeared to be missing. It was not — the header's
 *     search trigger was a flat `w-60`, so at 360px it took 240 of the 288
 *     available pixels and pushed the theme toggle, the bell, the avatar and
 *     the activity button off the right edge.
 *
 *  3. The activity panel's button did nothing. The panel is `hidden xl:flex`,
 *     so below 1280px the tap toggled a boolean that changed nothing anybody
 *     could see.
 *
 * WHAT THESE TESTS CAN AND CANNOT SHOW
 *
 * jsdom has no layout engine and applies no CSS: every element reports zero
 * size, media queries never match on their own, and nothing here can observe
 * an overflow, a scroll offset, or a control pushed off a screen. What they
 * hold is the contract that makes the behaviour possible — the classes that
 * decide it, and which elements exist in which mode. Whether the result is
 * right on a handset is a question only a handset answers.
 */

vi.mock('@/services/admin-api', () => ({
  getZoikoAvailTelemetry: vi.fn().mockResolvedValue({ health: null }),
  listVerifications: vi.fn().mockResolvedValue([]),
  listAuditLogs: vi.fn().mockResolvedValue({ items: [] }),
}))

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { name: 'Root Admin', email: 'root@zoikomeds.test', initials: 'RA', roleLabel: 'Super Admin' },
    logout: vi.fn(),
  }),
  useOptionalAuth: () => ({
    user: { name: 'Root Admin', email: 'root@zoikomeds.test' },
  }),
}))

vi.mock('@/layouts/command-palette', () => ({ CommandPalette: () => null }))

const { AppLayout } = await import('../app-layout')

/**
 * Pin the viewport, because jsdom has none.
 *
 * `wide` is what the layout reads as xl and above — where the activity panel
 * docks into a column of its own. Anything else is a phone.
 */
const viewport = (kind) =>
  vi.stubGlobal('matchMedia', (query) => ({
    matches: kind === 'wide' && query.includes('80rem'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))

const renderShell = () =>
  render(
    // main.jsx wraps the app in TooltipProvider, and the header names several
    // of its icon-only controls through tooltips.
    <MemoryRouter initialEntries={['/admin/dashboard']}>
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
    </MemoryRouter>,
  )

/** Open the navigation drawer the way a phone user does. */
const openNav = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  renderShell()
  await user.click(screen.getByRole('button', { name: /open navigation/i }))
  const drawer = await screen.findByRole('dialog')
  return { user, drawer }
}

beforeEach(() => {
  viewport('narrow')
  localStorage.clear()
})

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the navigation drawer reaches the bottom of the menu', () => {
  it('renders the last nav items, the ones the report could not reach', async () => {
    const { drawer } = await openNav()

    expect(drawer.textContent).toContain('System Settings')
    expect(drawer.textContent).toContain('API Integrations')
  })

  it('renders the Help Center footer', async () => {
    const { drawer } = await openNav()

    expect(drawer.textContent).toContain('Help Center')
  })

  it('hides no navigation item to make room', async () => {
    const { drawer } = await openNav()

    for (const label of [
      'Dashboard',
      'Leadership & Oversight', 'Pharmacy Management', 'Users & Roles', 'Verification Center',
      'MediBase', 'ZoikoAvail', 'ZoikoSignal',
      'Commercial', 'Reports & Analytics', 'Notifications', 'Audit Logs',
      'API Integrations', 'System Settings',
    ]) {
      expect(drawer.textContent).toContain(label)
    }
  })

  it('is as tall as the visible viewport, not the containing block', async () => {
    const { drawer } = await openNav()

    expect(drawer.className).toMatch(/h-\[100dvh\]/)
    expect(drawer.className).not.toMatch(/(^|\s)h-full(\s|$)/)
  })
})

describe('the drawer scrolls its navigation and keeps its footer', () => {
  const scrollAreaIn = (drawer) => drawer.querySelector('[data-slot="scroll-area"]')

  it('lets the scrolling area shrink below its content', async () => {
    const { drawer } = await openNav()
    const area = scrollAreaIn(drawer)

    expect(area.className).toMatch(/(^|\s)flex-1(\s|$)/)
    expect(area.className).toMatch(/(^|\s)min-h-0(\s|$)/)
    expect(area.className).not.toMatch(/(^|\s)shrink-0(\s|$)/)
  })

  it('keeps that scroll to itself', async () => {
    const { drawer } = await openNav()
    const viewportEl = drawer.querySelector('[data-slot="scroll-area-viewport"]')

    expect(viewportEl.className).toMatch(/overscroll-contain/)
  })

  it('pins the footer outside the scrolling area', async () => {
    // So Help Center cannot be scrolled away from, and needs no bottom padding
    // on the list to stay clear of it.
    const { drawer } = await openNav()
    const footer = [...drawer.querySelectorAll('div')].find(
      (el) => el.className.includes('shrink-0') && el.textContent.includes('Help Center'),
    )

    expect(footer).toBeDefined()
    expect(scrollAreaIn(drawer).contains(footer)).toBe(false)
  })

  it('keeps the footer clear of a system inset', async () => {
    const { drawer } = await openNav()
    const footer = [...drawer.querySelectorAll('div')].find(
      (el) => el.className.includes('shrink-0') && el.textContent.includes('Help Center'),
    )

    expect(footer.className).toContain('env(safe-area-inset-bottom)')
  })
})

describe('the mobile header keeps every essential control', () => {
  it('offers the menu, theme, notifications, account and activity', async () => {
    renderShell()

    for (const name of [
      /open navigation/i,
      /switch to (light|dark) mode/i,
      /notifications/i,
      /account menu/i,
      /toggle activity sidebar/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeDefined()
    }
  })

  it('does not spend the whole row on the search box', async () => {
    // The header's actual bug: a flat `w-60` at 360px left nothing for the
    // four controls to its right.
    renderShell()
    const search = screen.getByRole('button', { name: /^search$/i })

    expect(search.className).toMatch(/(^|\s)w-9(\s|$)/)
    expect(search.className).toMatch(/md:w-60/)
    expect(search.className).not.toMatch(/(^|\s)w-60(\s|$)/)
  })

  it('keeps search reachable, as an icon with a name', async () => {
    // Narrowed, not removed: the same control opening the same palette.
    renderShell()

    expect(screen.getByRole('button', { name: /^search$/i })).toBeDefined()
  })
})

describe('the account menu opens on a phone', () => {
  it('shows the signed-in identity and Sign Out', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderShell()

    await user.click(screen.getByRole('button', { name: /account menu/i }))

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain('root@zoikomeds.test')
    expect(menu.textContent).toContain('Super Admin')
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeDefined()
  })

  it('is the same menu the desktop uses, not a second implementation', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    viewport('wide')
    renderShell()

    await user.click(screen.getByRole('button', { name: /account menu/i }))

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain('root@zoikomeds.test')
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeDefined()
  })
})

describe('the activity panel is usable below xl', () => {
  it('does not open over the page uninvited', async () => {
    // An overlay must not greet somebody on a phone by covering the dashboard
    // they just loaded — even though the docked panel remembers being open.
    localStorage.setItem('zoiko-right-sidebar-open', '1')
    renderShell()

    expect(screen.queryByRole('dialog', { name: /activity panel/i })).toBeNull()
  })

  it('opens as a sheet when the header button is tapped', async () => {
    // This is the tap that used to do nothing at all.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderShell()

    await user.click(screen.getByRole('button', { name: /toggle activity sidebar/i }))

    const sheet = await screen.findByRole('dialog', { name: /activity panel/i })
    expect(sheet.textContent).toContain('Live Telemetry')
  })

  it('fits the narrowest phone and scrolls its own body', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderShell()
    await user.click(screen.getByRole('button', { name: /toggle activity sidebar/i }))
    const sheet = await screen.findByRole('dialog', { name: /activity panel/i })

    expect(sheet.className).toMatch(/max-w-sm/)
    expect(sheet.className).toMatch(/h-\[100dvh\]/)
    expect(sheet.querySelector('.overflow-y-auto')).not.toBeNull()
  })

  it('offers a way out of it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderShell()
    await user.click(screen.getByRole('button', { name: /toggle activity sidebar/i }))
    await screen.findByRole('dialog', { name: /activity panel/i })

    const close = screen.getAllByRole('button', { name: /^close$/i })
    expect(close.length).toBeGreaterThan(0)

    await user.click(close[close.length - 1])
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /activity panel/i })).toBeNull(),
    )
  })

  it('mounts no sheet at all on a desktop, so no overlay can appear there', async () => {
    viewport('wide')
    renderShell()

    expect(screen.queryByRole('dialog', { name: /activity panel/i })).toBeNull()
    // The docked panel is what shows there, and it is in the page already.
    expect(document.body.textContent).toContain('Live Telemetry')
  })
})

describe('the content shell reserves nothing for a hidden sidebar', () => {
  it('offsets for the rail only from lg, and for the panel only from xl', async () => {
    renderShell()
    const column = document.querySelector('main').parentElement

    expect(column.className).toMatch(/lg:pl-\[/)
    expect(column.className).not.toMatch(/(^|\s)pl-\[/)
    expect(column.className).not.toMatch(/(^|\s)ml-\[/)
    expect(column.className).toMatch(/xl:pr-/)
    expect(column.className).not.toMatch(/(^|\s)pr-\[/)
  })

  it('measures its height in dvh', async () => {
    renderShell()
    const column = document.querySelector('main').parentElement

    expect(column.className).toMatch(/min-h-dvh/)
    expect(column.className).not.toMatch(/min-h-screen/)
  })

  it('bounds the content column by the viewport rather than a fixed width', async () => {
    renderShell()
    const inner = document.querySelector('main > *')

    expect(inner.className).toContain('w-full')
    expect(inner.className).toMatch(/max-w-\[1600px\]/)
    expect(inner.className).not.toMatch(/(^|\s)min-w-/)
    // Anchored: unanchored, this matches the tail of `max-w-[1600px]`.
    expect(inner.className).not.toMatch(/(^|\s)w-\[\d+px\]/)
    expect(inner.className).not.toMatch(/100vw/)
  })
})
