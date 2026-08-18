// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from '../sidebar'

/**
 * The collapse control used to be rendered twice: in the header when expanded
 * and in the footer when collapsed. Collapsing therefore sent it to the bottom
 * of a full-height fixed rail, where reaching it meant scrolling past the whole
 * navigation. These tests hold it in the header in both states.
 */

const renderSidebar = (props = {}) =>
  render(
    // main.jsx wraps the app in TooltipProvider; the collapsed rail names its
    // icon-only controls through tooltips, so the test needs the same provider.
    <MemoryRouter>
      <TooltipProvider>
        <Sidebar showCollapseButton onToggleCollapse={() => {}} {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  )

/** The sidebar's header band — the first child of the root column. */
const header = (container) => container.querySelector('.h-16')

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

describe('sidebar collapse control', () => {
  it('sits in the header when expanded', () => {
    const { container } = renderSidebar({ collapsed: false })
    const button = screen.getByRole('button', { name: /collapse sidebar/i })
    expect(header(container).contains(button)).toBe(true)
  })

  it('stays in the header when collapsed — not pushed to the footer', () => {
    const { container } = renderSidebar({ collapsed: true })
    const button = screen.getByRole('button', { name: /expand sidebar/i })
    expect(header(container).contains(button)).toBe(true)
  })

  it.each([[false], [true]])(
    'keeps the control in a fixed-height band (collapsed=%s), so it cannot drift vertically',
    (collapsed) => {
      const { container } = renderSidebar({ collapsed })
      expect(header(container).className).toContain('h-16')
    },
  )

  it('renders exactly one toggle, never two', () => {
    renderSidebar({ collapsed: true })
    expect(screen.getAllByRole('button', { name: /expand sidebar|collapse sidebar/i })).toHaveLength(1)
  })

  it('does not put a toggle in the footer alongside Help Center', () => {
    const { container } = renderSidebar({ collapsed: true })
    const footer = container.querySelector('.border-t')
    expect(within(footer).queryByRole('button', { name: /expand sidebar/i })).toBeNull()
  })

  it('fires the toggle handler on click', async () => {
    const onToggleCollapse = vi.fn()
    renderSidebar({ collapsed: true, onToggleCollapse })
    await userEvent.click(screen.getByRole('button', { name: /expand sidebar/i }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('reports its state to assistive technology', () => {
    renderSidebar({ collapsed: true })
    expect(
      screen.getByRole('button', { name: /expand sidebar/i }).getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('keeps the full brand and every nav label when expanded', () => {
    renderSidebar({ collapsed: false })
    expect(screen.getByLabelText(/zoikomeds home/i)).toBeTruthy()
    expect(screen.getByText('Dashboard')).toBeTruthy()
    expect(screen.getByText('Pharmacy Management')).toBeTruthy()
  })

  it('keeps the navigation icons but drops labels when collapsed', () => {
    renderSidebar({ collapsed: true })
    expect(screen.queryByText('Pharmacy Management')).toBeNull()
    // The links themselves remain, so the rail is still navigable.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(5)
  })

  it('still shows the brand in the mobile sheet, which has no toggle', () => {
    // Rendered without showCollapseButton, as app-layout does for the Sheet.
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Sidebar collapsed={false} />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/zoikomeds home/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull()
  })
})
