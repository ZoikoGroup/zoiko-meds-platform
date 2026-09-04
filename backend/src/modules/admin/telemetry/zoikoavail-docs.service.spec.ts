import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GATEWAY_ROUTE_LIST } from './gateway-route-registry';
import { ZoikoAvailDocsService } from './zoikoavail-docs.service';

/**
 * The contract the console shows is the contract the service has.
 *
 * The Documentation button used to open the backend's Swagger UI, which does
 * not work anywhere it matters: production withholds /api/docs deliberately,
 * and locally the relative URL resolved against the Vite origin and landed on
 * the SPA's own 404. The obvious alternative — writing the endpoint list into a
 * React page — produces a second description that drifts from the first the
 * next time a controller changes.
 *
 * So this serves a filtered view of the same generated document, and these
 * tests hold the two properties that makes it worth doing: nothing internal
 * gets through, and nothing is invented.
 */

/** A generated document shaped like the real one, with an admin path to reject. */
const DOCUMENT = {
  info: { title: 'ZoikoMeds API', version: '0.1.0', description: 'Governed …' },
  servers: [
    { url: 'http://localhost:8000/api', description: 'Local development' },
    { url: 'https://get.zoikomeds.com/api', description: 'This deployment' },
  ],
  paths: {
    '/availability': {
      get: {
        summary: 'Governed availability confidence for a medicine',
        description: 'Returns a confidence band … never an exact stock count.',
        parameters: [
          {
            name: 'medicineId',
            in: 'query',
            required: true,
            description: 'MediBase medicine identity id.',
            schema: { type: 'string' },
            example: 'cmf1a2b3',
          },
        ],
        responses: {
          200: { description: 'Availability per visible pharmacy.' },
          404: { description: 'No such medicine identity.' },
        },
      },
    },
    '/medibase/match': { get: { summary: 'Match', description: 'Ranked identities.' } },
    '/medibase/lookup': { get: { summary: 'Lookup', description: 'By identifier.' } },
    '/medibase/meta/dictionary': { get: { summary: 'Dictionary', description: 'Contract.' } },
    '/medibase/{id}': {
      get: {
        summary: 'By id',
        description: 'One identity.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/signal/intelligence': {
      get: {
        summary: 'Intelligence cells',
        description: 'Requires a bearer token whose role is ENTERPRISE, GOVERNMENT or ADMIN.',
        security: [{ bearer: [] }],
        responses: { 200: { description: 'Cells.' }, 403: { description: 'Wrong role.' } },
      },
    },
    '/signal/intelligence/summary': {
      get: {
        summary: 'Summary',
        description: 'Requires ENTERPRISE, GOVERNMENT or ADMIN.',
        security: [{ bearer: [] }],
      },
    },
    '/signal/intelligence/export': {
      get: {
        summary: 'Export',
        description: 'Requires ENTERPRISE, GOVERNMENT or ADMIN.',
        security: [{ bearer: [] }],
      },
    },
    '/health': {
      get: {
        summary: 'Service health',
        responses: {
          200: {
            description: 'Serving.',
            content: {
              'application/json': {
                schema: { example: { status: 'ok', service: 'zoikomeds-api' } },
              },
            },
          },
        },
      },
    },
    '/health/live': { get: { summary: 'Liveness probe' } },
    '/health/ready': { get: { summary: 'Readiness probe' } },
    '/health/schema': { get: { summary: 'Migration status' } },
    // Must never reach the console.
    '/admin/zoikoavail/telemetry': { get: { summary: 'Console telemetry' } },
    '/admin/users': { get: { summary: 'List users' } },
    '/auth/login': { post: { summary: 'Sign in' } },
  },
};

/**
 * The documented production API, which the service defaults to rather than
 * reading `API_PUBLIC_URL`. That variable says which host serves *this*
 * instance — on a laptop, localhost — and localhost is not the API anyone
 * integrates against.
 */
const config = (productionUrl?: string) =>
  ({ get: () => productionUrl }) as unknown as ConfigService;

const build = (doc: unknown = DOCUMENT, productionUrl?: string) => {
  const service = new ZoikoAvailDocsService(config(productionUrl));
  if (doc !== undefined) service.register(doc);
  return service;
};

/** Every endpoint in the contract, flattened. */
const allEndpoints = (service: ZoikoAvailDocsService) =>
  service.contract().sections.flatMap((s) => s.endpoints);

const find = (service: ZoikoAvailDocsService, method: string, path: string) =>
  allEndpoints(service).find((e) => e.method === method && e.path === path);

describe('only the governed surface gets through', () => {
  it('carries every route in the registry', () => {
    const service = build();
    const paths = allEndpoints(service).map((e) => `${e.method} ${e.path}`);

    for (const route of GATEWAY_ROUTE_LIST) {
      expect(paths).toContain(`${route.method} ${route.path.replace(/:(\w+)/g, '{$1}')}`);
    }
  });

  it('carries the four health probes', () => {
    const service = build();
    const health = service.contract().sections.find((s) => s.name === 'Health');

    expect(health?.endpoints.map((e) => e.path)).toEqual([
      '/health',
      '/health/live',
      '/health/ready',
      '/health/schema',
    ]);
  });

  it.each(['/admin/zoikoavail/telemetry', '/admin/users', '/auth/login'])(
    'excludes %s',
    (path) => {
      // Dropped by construction — the filter is an allowlist taken from the
      // registry, not a list of things to remember to omit.
      expect(allEndpoints(build()).some((e) => e.path === path)).toBe(false);
    },
  );

  it('exposes no admin path at all', () => {
    expect(allEndpoints(build()).some((e) => e.path.startsWith('/admin'))).toBe(false);
  });

  it('has exactly the registry routes plus the health probes, and nothing else', () => {
    expect(allEndpoints(build())).toHaveLength(GATEWAY_ROUTE_LIST.length + 4);
  });

  it('groups them the way the console reads them', () => {
    expect(build().contract().sections.map((s) => s.name)).toEqual([
      'Availability',
      'MediBase',
      'Signal',
      'Health',
    ]);
  });
});

describe('authentication is read off the document, not restated', () => {
  it.each([
    '/signal/intelligence',
    '/signal/intelligence/summary',
    '/signal/intelligence/export',
  ])('%s is marked as requiring a bearer token', (path) => {
    const endpoint = find(build(), 'GET', path);

    expect(endpoint?.auth.required).toBe(true);
    expect(endpoint?.auth.header).toBe('Authorization: Bearer <token>');
  });

  it('names the real allowed roles', () => {
    expect(find(build(), 'GET', '/signal/intelligence')?.auth.roles).toEqual([
      'ADMIN',
      'ENTERPRISE',
      'GOVERNMENT',
    ]);
  });

  it.each(['/availability', '/medibase/match', '/health'])('%s is marked public', (path) => {
    const endpoint = find(build(), 'GET', path);

    expect(endpoint?.auth.required).toBe(false);
    expect(endpoint?.auth.header).toBeNull();
    expect(endpoint?.auth.roles).toEqual([]);
  });

  it('follows the document when a guard is added', () => {
    // The property that keeps this honest: a controller gaining a guard changes
    // the generated security block, and this page changes with it.
    const guarded = {
      ...DOCUMENT,
      paths: {
        ...DOCUMENT.paths,
        '/availability': {
          get: { ...DOCUMENT.paths['/availability'].get, security: [{ bearer: [] }] },
        },
      },
    };

    expect(find(build(guarded), 'GET', '/availability')?.auth.required).toBe(true);
  });
});

describe('what an integrator needs is carried through', () => {
  it('keeps query parameters with their type, requiredness and example', () => {
    const endpoint = find(build(), 'GET', '/availability');

    expect(endpoint?.parameters).toEqual([
      {
        name: 'medicineId',
        in: 'query',
        required: true,
        description: 'MediBase medicine identity id.',
        type: 'string',
        example: 'cmf1a2b3',
      },
    ]);
  });

  it('keeps path parameters', () => {
    const endpoint = find(build(), 'GET', '/medibase/{id}');

    expect(endpoint?.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });

  it('keeps responses, including the error cases', () => {
    const endpoint = find(build(), 'GET', '/availability');

    expect(endpoint?.responses.map((r) => r.status)).toEqual(['200', '404']);
  });

  it('keeps a response example where the decorator supplied one', () => {
    expect(find(build(), 'GET', '/health')?.responses[0].example).toEqual({
      status: 'ok',
      service: 'zoikomeds-api',
    });
  });

  it('carries the API-key scope for a governed route', () => {
    expect(find(build(), 'GET', '/medibase/match')?.scope).toBe('medibase');
  });

  it('carries no scope for a health probe, which is not scoped', () => {
    expect(find(build(), 'GET', '/health')?.scope).toBeNull();
  });

  it('leads with the production API, and labels it as such', () => {
    // The page showed "http://localhost:8000/api" and "/api" as its headline
    // API base URLs — one a developer's machine, the other naming no host at
    // all. Neither is what a Super Admin integrates against.
    const [first] = build().contract().servers;

    expect(first).toEqual({
      url: 'https://get.zoikomeds.com/api',
      description: 'Production API',
      kind: 'production',
    });
  });

  it('keeps local development as the secondary reference', () => {
    const servers = build().contract().servers;

    expect(servers[1]).toMatchObject({ url: 'http://localhost:8000/api', kind: 'local' });
  });

  it('drops a relative base rather than presenting it as a host', () => {
    // The document falls back to "/api" when API_PUBLIC_URL is unset, which is
    // right for a same-origin fetch and useless as documentation.
    const relative = {
      ...DOCUMENT,
      servers: [
        { url: 'http://localhost:8000/api', description: 'Local development' },
        { url: '/api', description: 'Same origin' },
      ],
    };

    expect(build(relative).contract().servers.map((s) => s.url)).toEqual([
      'https://get.zoikomeds.com/api',
      'http://localhost:8000/api',
    ]);
  });

  it('does not list production twice when the document already declares it', () => {
    expect(
      build().contract().servers.filter((s) => s.url === 'https://get.zoikomeds.com/api'),
    ).toHaveLength(1);
  });

  it('honours a configured production URL over the default', () => {
    const [first] = build(DOCUMENT, 'https://api.example.test/api/').contract().servers;

    // Trailing slash trimmed, so the page never shows a double slash.
    expect(first.url).toBe('https://api.example.test/api');
  });

  it('still shows production first when nothing else is declared', () => {
    const bare = { ...DOCUMENT, servers: [] };

    expect(build(bare).contract().servers).toEqual([
      {
        url: 'https://get.zoikomeds.com/api',
        description: 'Production API',
        kind: 'production',
      },
    ]);
  });
});

describe('nothing is invented', () => {
  it('omits a registry route the document does not describe', () => {
    // If a controller loses its route the page loses the entry, rather than
    // showing a contract for something that no longer answers.
    const partial = { ...DOCUMENT, paths: { ...DOCUMENT.paths } };
    delete (partial.paths as Record<string, unknown>)['/medibase/lookup'];

    expect(allEndpoints(build(partial)).some((e) => e.path === '/medibase/lookup')).toBe(false);
  });

  it('refuses rather than serving an empty contract', () => {
    // A page reading "no endpoints" would say the platform has no API, which is
    // a worse answer than saying the contract could not be loaded.
    const service = new ZoikoAvailDocsService(config());

    expect(() => service.contract()).toThrow(ServiceUnavailableException);
  });

  it('carries no secret or connection string', () => {
    expect(JSON.stringify(build().contract())).not.toMatch(
      /DATABASE_URL|JWT_SECRET|ANTHROPIC_API_KEY|postgres:\/\//i,
    );
  });
});

// --- The OpenAPI rendering the Swagger explorer consumes ---------------------

describe('the specification is the same surface, in OpenAPI form', () => {
  /** Every "METHOD path" the reading view describes. */
  const contractPaths = (service: ZoikoAvailDocsService) =>
    allEndpoints(service)
      .map((e) => `${e.method.toLowerCase()} ${e.path}`)
      .sort();

  /** Every "METHOD path" the specification describes. */
  const specPaths = (service: ZoikoAvailDocsService) =>
    Object.entries(service.specification().paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((m) => `${m} ${path}`))
      .sort();

  it('covers exactly the endpoints the reading view covers', () => {
    // The property that makes "one contract, two renderings" true rather than
    // aspirational: neither can widen or narrow without the other.
    const service = build();

    expect(specPaths(service)).toEqual(contractPaths(service));
  });

  it('is a valid OpenAPI document', () => {
    const spec = build().specification();

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('ZoikoAvail™ API');
    expect(spec.paths['/availability'].get).toBeDefined();
  });

  it('leads with the production server, so the explorer does not default to a laptop', () => {
    expect(build().specification().servers[0]).toEqual({
      url: 'https://get.zoikomeds.com/api',
      description: 'Production API',
    });
  });

  it.each(['/admin/zoikoavail/telemetry', '/admin/users', '/auth/login'])(
    'omits %s from the document itself, not merely from the view',
    (path) => {
      // Absent from the object the browser receives, so no UI toggle can reveal it.
      expect(build().specification().paths[path]).toBeUndefined();
    },
  );

  it('carries no /admin path at all', () => {
    expect(Object.keys(build().specification().paths).some((p) => p.startsWith('/admin'))).toBe(
      false,
    );
  });

  it('keeps the security schemes so Authorize works', () => {
    const withSchemes = {
      ...DOCUMENT,
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    };

    expect(build(withSchemes).specification().components).toEqual({
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    });
  });

  it('keeps the per-operation security, so protected routes stay marked', () => {
    const spec = build().specification();

    expect(spec.paths['/signal/intelligence'].get.security).toEqual([{ bearer: [] }]);
    expect(spec.paths['/availability'].get.security).toBeUndefined();
  });

  it('refuses rather than serving an empty document', () => {
    const service = new ZoikoAvailDocsService(config());

    expect(() => service.specification()).toThrow(ServiceUnavailableException);
  });
});
