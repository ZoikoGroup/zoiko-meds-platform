// @vitest-environment jsdom
//
// MSA-43 — the Help Center dialog's three tiles (Documentation, Keyboard
// shortcuts, Contact support) were plain buttons with no onClick at all. The
// dialog opened and nothing inside it did anything.
//
// Documentation is the one the client cannot answer alone: whether a deployment
// publishes an API reference depends on whether Swagger is mounted, which is off
// in production. So the tile appears only when the server says there is
// something to open.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const getHelpResourcesMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getHelpResources: () => getHelpResourcesMock(),
}))

vi.mock('@/providers/auth-provider', () => ({
  useOptionalAuth: () => ({ user: { email: 'root@zoikomeds.test', role: 'SUPER_ADMIN' } }),
}))

vi.mock('@/routes/navigation', () => ({
  navSections: [],
  allNavLinks: [],
}))

const { Sidebar } = await import('../sidebar')

async function openHelp() {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/admin/dashboard']}>
      <Sidebar />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: /help center/i }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  getHelpResourcesMock.mockResolvedValue({
    supportEmail: 'support@zoikomeds.com',
    apiReferenceUrl: '/api/docs',
    documentationUrl: null,
  })
})

afterEach(cleanup)

describe('MSA-43 · Help Center', () => {
  it('opens the API reference the server says it publishes', async () => {
    await openHelp()

    const docs = await screen.findByRole('link', { name: /documentation/i })
    expect(docs.getAttribute('href')).toBe('/api/docs')
    // A new tab, so an operator does not lose the page they were on.
    expect(docs.getAttribute('target')).toBe('_blank')
  })

  it('prefers a configured documentation site over the API reference', async () => {
    getHelpResourcesMock.mockResolvedValue({
      supportEmail: 'support@zoikomeds.com',
      apiReferenceUrl: '/api/docs',
      documentationUrl: 'https://docs.example.test',
    })
    await openHelp()

    const docs = await screen.findByRole('link', { name: /documentation/i })
    expect(docs.getAttribute('href')).toBe('https://docs.example.test')
  })

  // Production mounts no Swagger, so there is genuinely nothing behind this tile
  // and a link would open a 404 — no better than the button that opened nothing.
  it('shows no Documentation tile when the deployment publishes neither', async () => {
    getHelpResourcesMock.mockResolvedValue({
      supportEmail: 'support@zoikomeds.com',
      apiReferenceUrl: null,
      documentationUrl: null,
    })
    await openHelp()

    await waitFor(() => expect(screen.getByText('Contact support')).toBeDefined())
    expect(screen.queryByRole('link', { name: /documentation/i })).toBeNull()
  })

  it('shows the real shortcuts, and only those', async () => {
    const user = await openHelp()

    await user.click(await screen.findByRole('button', { name: /keyboard shortcuts/i }))

    // Both are registered in app-layout.jsx; nothing else is.
    expect(await screen.findByText(/open the command palette/i)).toBeDefined()
    expect(screen.getByText(/switch between light and dark/i)).toBeDefined()
    expect(screen.getAllByText(/Ctrl/).length).toBe(2)
  })

  it('returns to the tiles from the shortcuts panel', async () => {
    const user = await openHelp()

    await user.click(await screen.findByRole('button', { name: /keyboard shortcuts/i }))
    await user.click(await screen.findByRole('button', { name: /^back$/i }))

    expect(await screen.findByText('Contact support')).toBeDefined()
  })

  it('mails support at the address the server reports, saying who and where', async () => {
    getHelpResourcesMock.mockResolvedValue({
      supportEmail: 'help@example.test',
      apiReferenceUrl: null,
      documentationUrl: null,
    })
    await openHelp()

    const support = await screen.findByRole('link', { name: /contact support/i })
    const href = support.getAttribute('href')
    expect(href.startsWith('mailto:help@example.test')).toBe(true)
    // Prefilled so the first reply does not have to ask.
    expect(decodeURIComponent(href)).toContain('root@zoikomeds.test')
    expect(decodeURIComponent(href)).toContain('/admin/dashboard')
  })

  it('still offers support when the resources call fails', async () => {
    getHelpResourcesMock.mockRejectedValue(new Error('Forbidden'))
    await openHelp()

    const support = await screen.findByRole('link', { name: /contact support/i })
    expect(support.getAttribute('href').startsWith('mailto:support@zoikomeds.com')).toBe(true)
  })

  it('no longer promises a support SLA nothing backs', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /help center/i })[0])

    await waitFor(() => expect(screen.getAllByText('Contact support').length).toBeGreaterThan(0))
    expect(container.textContent).not.toMatch(/1h SLA/i)
  })
})
