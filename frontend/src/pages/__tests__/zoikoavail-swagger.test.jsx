// @vitest-environment jsdom
//
// An interactive API explorer that works in production.
//
// "Open Swagger UI" appeared only in development, because the only explorer was
// the backend's own /api/docs — mounted outside production on purpose, since
// the full API surface (admin and auth routes included) is not something to
// serve publicly. Dropping that guard would publish exactly what it exists to
// withhold.
//
// So the specification is fetched through the console's own authenticated API
// client, from a SUPER_ADMIN-guarded route, and rendered in-app. A direct
// browser navigation to that URL would have carried no Authorization header at
// all — a new tab sends cookies, not the bearer token this app holds — which is
// why the request has to originate inside the application.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

// The real renderer is ~1.3 MB and drives its own DOM; what matters here is
// which document it is handed, and that it is handed one at all.
const swaggerProps = vi.fn()
vi.mock('swagger-ui-react', () => ({
  default: (props) => {
    swaggerProps(props)
    return <div data-testid="swagger-ui">{Object.keys(props.spec?.paths ?? {}).join(',')}</div>
  },
}))
vi.mock('swagger-ui-react/swagger-ui.css', () => ({}))

const specMock = vi.fn()
const contractMock = vi.fn()
const telemetryMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  getZoikoAvailSpec: () => specMock(),
  getZoikoAvailContract: () => contractMock(),
  getZoikoAvailTelemetry: () => telemetryMock(),
}))

const { default: ZoikoAvailSwagger } = await import('../ZoikoAvailSwagger')

/** The filtered document the backend serves — governed routes only. */
const SPEC = {
  openapi: '3.0.0',
  info: { title: 'ZoikoAvail™ API', version: '0.1.0' },
  servers: [
    { url: 'https://get.zoikomeds.com/api', description: 'Production API' },
    { url: 'http://localhost:8000/api', description: 'Local development' },
  ],
  paths: {
    '/availability': { get: { summary: 'Availability confidence' } },
    '/medibase/match': { get: { summary: 'Match' } },
    '/medibase/lookup': { get: { summary: 'Lookup' } },
    '/medibase/meta/dictionary': { get: { summary: 'Dictionary' } },
    '/medibase/{id}': { get: { summary: 'By id' } },
    '/signal/intelligence': { get: { summary: 'Cells', security: [{ bearer: [] }] } },
    '/signal/intelligence/summary': { get: { summary: 'Summary', security: [{ bearer: [] }] } },
    '/signal/intelligence/export': { get: { summary: 'Export', security: [{ bearer: [] }] } },
    '/health': { get: { summary: 'Health' } },
    '/health/live': { get: { summary: 'Live' } },
    '/health/ready': { get: { summary: 'Ready' } },
    '/health/schema': { get: { summary: 'Schema' } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
}

const openExplorer = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<ZoikoAvailSwagger />)
  await screen.findByTestId('swagger-ui')
  return { user }
}

beforeEach(() => {
  vi.clearAllMocks()
  specMock.mockResolvedValue(SPEC)
  vi.stubGlobal('open', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('5. the page uses the authenticated admin client', () => {
  it('requests the specification through it', async () => {
    await openExplorer()

    expect(specMock).toHaveBeenCalledTimes(1)
  })

  it('hands Swagger the document rather than a URL to fetch', async () => {
    // The library fetching the URL itself would be an unauthenticated request,
    // which the SUPER_ADMIN guard refuses. The app already has the document.
    await openExplorer()
    const props = swaggerProps.mock.calls[0][0]

    expect(props.spec).toEqual(SPEC)
    expect(props.url).toBeUndefined()
  })

  it('passes no token into Swagger', async () => {
    // The console's JWT is the operator's session, not an API credential.
    // Seeding it into Authorize would turn a reference page into a way to
    // replay an admin session against the API.
    await openExplorer()
    const props = swaggerProps.mock.calls[0][0]

    for (const key of ['authorizations', 'preauthorizeApiKey', 'requestInterceptor', 'token']) {
      expect(props[key]).toBeUndefined()
    }
  })
})

describe('6 & 7. what the explorer renders', () => {
  it('renders the returned document', async () => {
    await openExplorer()

    expect(screen.getByTestId('swagger-ui').textContent).toContain('/availability')
  })

  it('carries every governed endpoint', async () => {
    await openExplorer()
    const paths = Object.keys(swaggerProps.mock.calls[0][0].spec.paths)

    for (const path of [
      '/availability',
      '/medibase/match',
      '/medibase/lookup',
      '/medibase/meta/dictionary',
      '/medibase/{id}',
      '/signal/intelligence',
      '/signal/intelligence/summary',
      '/signal/intelligence/export',
      '/health',
      '/health/live',
      '/health/ready',
      '/health/schema',
    ]) {
      expect(paths).toContain(path)
    }
  })

  it('carries no internal route', async () => {
    await openExplorer()
    const paths = Object.keys(swaggerProps.mock.calls[0][0].spec.paths)

    // Absent from the document itself, so no UI control can reveal them.
    expect(paths.some((p) => p.startsWith('/admin'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/auth'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/pharmacies'))).toBe(false)
    // '/me/' with the slash: '/medibase' also starts with '/me', and matching
    // that would have condemned the governed catalog routes.
    expect(paths.some((p) => p.startsWith('/me/'))).toBe(false)
  })

  it('keeps the security scheme, so Authorize is available', async () => {
    await openExplorer()

    expect(swaggerProps.mock.calls[0][0].spec.components.securitySchemes.bearer).toBeDefined()
  })
})

describe('8 & 9. servers', () => {
  it('leads with the production API', async () => {
    // Production users must not be defaulted to a laptop.
    await openExplorer()

    expect(swaggerProps.mock.calls[0][0].spec.servers[0].url).toBe(
      'https://get.zoikomeds.com/api',
    )
  })

  it('still offers local development as a second server', async () => {
    await openExplorer()

    expect(swaggerProps.mock.calls[0][0].spec.servers.map((s) => s.url)).toContain(
      'http://localhost:8000/api',
    )
  })
})

describe('4 & 9. the raw backend UI', () => {
  it('is never what this page renders', async () => {
    // The page does not depend on SwaggerModule.setup at all.
    await openExplorer()

    expect(window.open).not.toHaveBeenCalled()
  })

  it('is offered as a secondary action only, and never points at this origin', async () => {
    await openExplorer()
    const raw = screen.queryByRole('button', { name: /Open raw Swagger UI/i })

    if (!raw) {
      // Not offered outside development, which is the production behaviour.
      expect(raw).toBeNull()
      return
    }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(raw)

    // The backend's port, taken from the document's servers — not 5173.
    expect(window.open).toHaveBeenCalledWith(
      'http://localhost:8000/api/docs',
      '_blank',
      expect.stringContaining('noopener'),
    )
  })

  it('offers no raw link when the document declares no local server', async () => {
    // Which is what a production contract looks like.
    specMock.mockResolvedValue({ ...SPEC, servers: [SPEC.servers[0]] })
    await openExplorer()

    expect(screen.queryByRole('button', { name: /Open raw Swagger UI/i })).toBeNull()
  })
})

describe('13. loading and error states', () => {
  it('shows a loading state before the document arrives', async () => {
    let release
    specMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    render(<ZoikoAvailSwagger />)

    expect(screen.queryByTestId('swagger-ui')).toBeNull()
    expect(document.querySelector('.animate-spin')).not.toBeNull()

    release(SPEC)
    expect(await screen.findByTestId('swagger-ui')).toBeDefined()
  })

  it('says so when the specification cannot be read', async () => {
    specMock.mockRejectedValue(new Error('403'))
    render(<ZoikoAvailSwagger />)

    expect(
      await screen.findByText(/Unable to load ZoikoAvail API specification/i),
    ).toBeDefined()
  })

  it('renders no empty explorer on failure', async () => {
    // A Swagger UI with no paths reads as an API with no endpoints.
    specMock.mockRejectedValue(new Error('503'))
    render(<ZoikoAvailSwagger />)
    await screen.findByText(/Unable to load ZoikoAvail API specification/i)

    expect(screen.queryByTestId('swagger-ui')).toBeNull()
  })

  it('offers a retry that asks again', async () => {
    specMock.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(SPEC)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<ZoikoAvailSwagger />)
    await screen.findByText(/Unable to load ZoikoAvail API specification/i)

    await user.click(screen.getByRole('button', { name: /retry|try again/i }))

    expect(await screen.findByTestId('swagger-ui')).toBeDefined()
    expect(specMock).toHaveBeenCalledTimes(2)
  })

  it('keeps Back to API Documentation available while failed', async () => {
    specMock.mockRejectedValue(new Error('503'))
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<ZoikoAvailSwagger />)
    await screen.findByText(/Unable to load ZoikoAvail API specification/i)

    await user.click(screen.getByRole('button', { name: /Back to API Documentation/i }))

    expect(navigateMock).toHaveBeenCalledWith('/admin/zoikoavail/documentation')
  })
})

describe('14. navigation', () => {
  it('goes back to the documentation page', async () => {
    const { user } = await openExplorer()

    await user.click(screen.getByRole('button', { name: /Back to API Documentation/i }))

    expect(navigateMock).toHaveBeenCalledWith('/admin/zoikoavail/documentation')
  })

  it('shows the trail down to the explorer', async () => {
    await openExplorer()

    // Twice on purpose: the page title and the trail's last crumb.
    expect(screen.getAllByText('API Explorer')).toHaveLength(2)
  })
})
