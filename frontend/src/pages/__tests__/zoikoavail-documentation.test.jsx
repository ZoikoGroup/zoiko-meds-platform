// @vitest-environment jsdom
//
// Documentation on Super Admin → ZoikoAvail™, and the page behind it.
//
// The button opened the backend's Swagger UI, which does not work anywhere it
// matters. Production withholds /api/docs deliberately, so the button sat
// disabled there; and locally the URL the server reports is relative, so
// window.open resolved it against the Vite origin and landed on
// localhost:5173/api/docs — this app's own 404 page.
//
// It now routes to a page inside the console, which behaves the same in local,
// staging and production and stays behind the Super Admin guard. The contract
// on that page is a filtered view of the same OpenAPI document Swagger renders,
// so the two cannot drift.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// framer-motion's viewport animations need one and jsdom has none, so the page
// throws before it renders. Nothing here depends on it observing anything.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

const telemetryMock = vi.fn()
const contractMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getZoikoAvailTelemetry: () => telemetryMock(),
  getZoikoAvailContract: () => contractMock(),
}))

const { default: ZoikoAvail } = await import('../ZoikoAvail')
const { default: ZoikoAvailDocumentation } = await import('../ZoikoAvailDocumentation')

const TELEMETRY = {
  health: {
    status: 'operational',
    uptime: 100,
    p50: 9,
    p99: 161,
    requests24h: 83,
    errorRate: 0,
    rateCeiling: '100 req/min',
  },
  responseTime: [],
  throughput: [],
  endpoints: [],
  security: [],
}

/** The contract as the backend serves it, shaped like the real response. */
const CONTRACT = {
  title: 'ZoikoAvail™ API',
  version: '0.1.0',
  description: 'Governed medicine availability infrastructure API.',
  // Ordered and labelled by the backend: production first, local second.
  servers: [
    { url: 'https://get.zoikomeds.com/api', description: 'Production API', kind: 'production' },
    { url: 'http://localhost:8000/api', description: 'Local development', kind: 'local' },
  ],
  sections: [
    {
      name: 'Availability',
      endpoints: [
        {
          method: 'GET',
          path: '/availability',
          summary: 'Governed availability confidence for a medicine',
          description: 'Returns a confidence band, never an exact stock count.',
          scope: 'availability',
          auth: { required: false, header: null, roles: [] },
          parameters: [
            {
              name: 'medicineId',
              in: 'query',
              required: true,
              description: 'MediBase medicine identity id.',
              type: 'string',
              example: 'cmf1a2b3',
            },
          ],
          hasRequestBody: false,
          responses: [
            { status: '200', description: 'Availability per visible pharmacy.', example: null },
            { status: '404', description: 'No such medicine identity.', example: null },
          ],
        },
      ],
    },
    {
      name: 'Signal',
      endpoints: [
        {
          method: 'GET',
          path: '/signal/intelligence',
          summary: 'Query time-bucketed, anonymized intelligence cells',
          description: 'Requires a bearer token whose role is ENTERPRISE, GOVERNMENT or ADMIN.',
          scope: 'signal',
          auth: {
            required: true,
            header: 'Authorization: Bearer <token>',
            roles: ['ADMIN', 'ENTERPRISE', 'GOVERNMENT'],
          },
          parameters: [],
          hasRequestBody: false,
          responses: [{ status: '403', description: 'Wrong role.', example: null }],
        },
      ],
    },
    {
      name: 'Health',
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          summary: 'Service health',
          description: null,
          scope: null,
          auth: { required: false, header: null, roles: [] },
          parameters: [],
          hasRequestBody: false,
          responses: [
            {
              status: '200',
              description: 'The process is serving.',
              example: { status: 'ok', service: 'zoikomeds-api' },
            },
          ],
        },
      ],
    },
  ],
}

const openDashboard = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<ZoikoAvail />)
  const button = await screen.findByRole('button', { name: /Documentation/i })
  return { user, button }
}

const openDocs = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<ZoikoAvailDocumentation />)
  await screen.findByText(/API base URL/i)
  return { user }
}

/** The card an endpoint is rendered in. */
const cardFor = (path) => screen.getByText(path).closest('div[data-slot="card"]')

beforeEach(() => {
  vi.clearAllMocks()
  telemetryMock.mockResolvedValue(TELEMETRY)
  contractMock.mockResolvedValue(CONTRACT)
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)
  vi.stubGlobal('open', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('1-4. the Documentation button', () => {
  it('is always usable — never disabled', async () => {
    // It was disabled in production, because there was no Swagger to open. A
    // visible action that cannot be used teaches operators to ignore it.
    const { button } = await openDashboard()

    expect(button.disabled).toBe(false)
  })

  it('navigates to the in-platform documentation page', async () => {
    const { user, button } = await openDashboard()

    await user.click(button)

    expect(navigateMock).toHaveBeenCalledWith('/admin/zoikoavail/documentation')
  })

  it('opens no window at all', async () => {
    // Not localhost:5173/api/docs, not get.zoikomeds.com/api/docs, nothing.
    const { user, button } = await openDashboard()

    await user.click(button)

    expect(window.open).not.toHaveBeenCalled()
  })

  it('behaves the same however the deployment is configured', async () => {
    // No env, no server lookup, no conditional: one navigation.
    const { user, button } = await openDashboard()
    await user.click(button)
    await user.click(button)

    expect(navigateMock).toHaveBeenCalledTimes(2)
    expect(new Set(navigateMock.mock.calls.map((c) => c[0])).size).toBe(1)
  })

  it('needs no help-resources lookup any more', async () => {
    // The old implementation needed one to find a URL. The route is fixed now,
    // so the dashboard makes one request, for its telemetry.
    await openDashboard()

    expect(telemetryMock).toHaveBeenCalledTimes(1)
  })
})

describe('5. the page lists the real endpoints', () => {
  it('renders each section from the served contract', async () => {
    await openDocs()

    for (const name of ['Availability', 'Signal', 'Health']) {
      expect(screen.getByRole('heading', { name })).toBeDefined()
    }
  })

  it('renders each endpoint with its method and route', async () => {
    await openDocs()

    for (const path of ['/availability', '/signal/intelligence', '/health']) {
      expect(screen.getByText(path)).toBeDefined()
    }
    expect(screen.getAllByText('GET')).toHaveLength(3)
  })

  it('leads with the production API, labelled as such', async () => {
    // The page used to open with "http://localhost:8000/api" and "/api" — a
    // developer's machine and a path naming no host. Neither is what a Super
    // Admin integrates against.
    await openDocs()
    const card = screen.getByText(/API base URL/i).closest('div[data-slot="card"]')

    expect(within(card).getByText('Production API')).toBeDefined()
    expect(within(card).getByText('https://get.zoikomeds.com/api')).toBeDefined()
  })

  it('puts the production URL before the local one in the document order', async () => {
    await openDocs()
    const card = screen.getByText(/API base URL/i).closest('div[data-slot="card"]')
    const shown = [...card.querySelectorAll('code')].map((c) => c.textContent)

    expect(shown[0]).toBe('https://get.zoikomeds.com/api')
    expect(shown.indexOf('https://get.zoikomeds.com/api')).toBeLessThan(
      shown.indexOf('http://localhost:8000/api'),
    )
  })

  it('keeps local development visible as a secondary reference', async () => {
    // A developer testing against a local backend still needs it — just not as
    // the thing the page leads with.
    await openDocs()
    const card = screen.getByText(/API base URL/i).closest('div[data-slot="card"]')

    expect(within(card).getByText('Local development')).toBeDefined()
    expect(within(card).getByText('http://localhost:8000/api')).toBeDefined()
  })

  it('never presents a bare /api as the base URL', async () => {
    // The service drops relative entries, and the page would show one as its
    // headline if it did not.
    await openDocs()
    const card = screen.getByText(/API base URL/i).closest('div[data-slot="card"]')
    const shown = [...card.querySelectorAll('code')].map((c) => c.textContent)

    expect(shown).not.toContain('/api')
    for (const url of shown) expect(url).toMatch(/^https?:\/\//)
  })

  it('shows production alone when the contract declares nothing else', async () => {
    contractMock.mockResolvedValue({
      ...CONTRACT,
      servers: [CONTRACT.servers[0]],
    })
    await openDocs()
    const card = screen.getByText(/API base URL/i).closest('div[data-slot="card"]')

    expect(within(card).getByText('https://get.zoikomeds.com/api')).toBeDefined()
    expect(within(card).queryByText('Local development')).toBeNull()
  })

  it('invents nothing when the contract is short', async () => {
    contractMock.mockResolvedValue({ ...CONTRACT, sections: [CONTRACT.sections[2]] })
    await openDocs()

    expect(screen.queryByText('/availability')).toBeNull()
    expect(screen.getByText('/health')).toBeDefined()
  })
})

describe('6. public and protected are labelled correctly', () => {
  it('marks a public endpoint public', async () => {
    await openDocs()

    expect(within(cardFor('/availability')).getByText(/Public — no token required/i)).toBeDefined()
  })

  it('marks a protected endpoint as needing a bearer token', async () => {
    await openDocs()
    const card = cardFor('/signal/intelligence')

    expect(within(card).getByText(/Bearer token required/i)).toBeDefined()
    expect(within(card).getByText('Authorization: Bearer <token>')).toBeDefined()
  })

  it('names the real allowed roles', async () => {
    await openDocs()

    expect(
      within(cardFor('/signal/intelligence')).getByText(/ADMIN · ENTERPRISE · GOVERNMENT/),
    ).toBeDefined()
  })

  it('shows no token header on a public endpoint', async () => {
    await openDocs()

    expect(within(cardFor('/health')).queryByText(/Bearer/)).toBeNull()
  })

  it('exposes no token value anywhere', async () => {
    await openDocs()

    // The placeholder, never a credential.
    expect(document.body.textContent).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })
})

describe('7. parameters come from the contract', () => {
  it('shows a query parameter with its type, requiredness and example', async () => {
    await openDocs()
    const card = cardFor('/availability')

    expect(within(card).getByText('Query parameters')).toBeDefined()
    expect(within(card).getByText('medicineId')).toBeDefined()
    expect(within(card).getByText('required')).toBeDefined()
    expect(within(card).getByText(/e\.g\. cmf1a2b3/)).toBeDefined()
  })

  it('shows responses, including the error cases', async () => {
    await openDocs()
    const card = cardFor('/availability')

    expect(within(card).getByText('404')).toBeDefined()
    expect(within(card).getByText('No such medicine identity.')).toBeDefined()
  })

  it('shows a response example where the contract carries one', async () => {
    await openDocs()

    expect(within(cardFor('/health')).getByText(/zoikomeds-api/)).toBeDefined()
  })

  it('renders no parameter section for an endpoint that takes none', async () => {
    await openDocs()

    expect(within(cardFor('/signal/intelligence')).queryByText('Query parameters')).toBeNull()
  })
})

describe('8. nothing internal is shown', () => {
  it('lists no /admin route even if one somehow arrived', async () => {
    // The server filters them out; this documents the expectation at the
    // boundary the operator actually sees.
    await openDocs()

    expect(document.body.textContent).not.toMatch(/\/admin\/[a-z]/)
  })

  it('shows no environment variable or credential name', async () => {
    await openDocs()

    expect(document.body.textContent).not.toMatch(
      /DATABASE_URL|JWT_SECRET|ANTHROPIC_API_KEY|postgres:\/\//i,
    )
  })
})

describe('9. navigation', () => {
  it('offers Back to ZoikoAvail', async () => {
    const { user } = await openDocs()

    await user.click(screen.getByRole('button', { name: /Back to ZoikoAvail/i }))

    expect(navigateMock).toHaveBeenCalledWith('/admin/zoikoavail')
  })

  it('shows the breadcrumb trail down to this page', async () => {
    await openDocs()

    // Twice on purpose: the page title and the trail's last crumb.
    expect(screen.getAllByText('API Documentation')).toHaveLength(2)
    // And the crumb above it names the dashboard it came from.
    expect(screen.getAllByText('ZoikoAvail™').length).toBeGreaterThan(0)
  })
})

describe('10. the dashboard is otherwise unchanged', () => {
  it('still renders its telemetry', async () => {
    render(<ZoikoAvail />)

    expect(await screen.findByText(/Uptime/i)).toBeDefined()
    expect(screen.getByText('100 req/min')).toBeDefined()
  })

  it('offers Documentation as its only header action', async () => {
    // MSA-51 removed the sandbox — page, route and button. Asserting it still
    // exists would hold a teammate's deliberate removal open.
    await openDashboard()

    expect(screen.queryByRole('button', { name: /Open sandbox/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Documentation/i })).toBeDefined()
  })
})

describe('11-12. the optional Swagger link', () => {
  it('points at the backend, never at the origin serving this page', async () => {
    // The whole bug in one assertion: 8000, not 5173. The URL comes from the
    // servers block the backend declares, not from this app's own location.
    await openDocs()
    const link = screen.queryByRole('button', { name: /Open Swagger UI/i })

    if (!link) {
      // Not offered outside dev, which is also correct.
      expect(link).toBeNull()
      return
    }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(link)

    expect(window.open).toHaveBeenCalledWith(
      'http://localhost:8000/api/docs',
      '_blank',
      expect.stringContaining('noopener'),
    )
  })

  it('is absent when the contract declares no local server', async () => {
    // Which is what a production contract looks like: no localhost entry, so no
    // link is offered and the page does not depend on one.
    contractMock.mockResolvedValue({
      ...CONTRACT,
      servers: [{ url: 'https://get.zoikomeds.com/api', description: 'This deployment' }],
    })
    await openDocs()

    expect(screen.queryByRole('button', { name: /Open Swagger UI/i })).toBeNull()
  })

  it('renders the whole contract with or without it', async () => {
    contractMock.mockResolvedValue({
      ...CONTRACT,
      servers: [{ url: 'https://get.zoikomeds.com/api', description: 'This deployment' }],
    })
    await openDocs()

    expect(screen.getByText('/availability')).toBeDefined()
    expect(screen.getByText('/signal/intelligence')).toBeDefined()
  })
})

describe('when the contract cannot be read', () => {
  it('says so and offers a retry rather than an empty page', async () => {
    contractMock.mockRejectedValue(new Error('503'))
    render(<ZoikoAvailDocumentation />)

    expect(await screen.findByText(/Couldn't load the API contract/i)).toBeDefined()
  })
})
