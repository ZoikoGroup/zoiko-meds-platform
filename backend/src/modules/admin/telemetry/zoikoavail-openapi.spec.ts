import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { buildOpenApiDocument } from '../../../config/openapi-document';
import { ZoikoAvailDocsService } from './zoikoavail-docs.service';
import { AvailabilityController } from '../../availability/availability.controller';
import { AvailabilityService } from '../../availability/availability.service';
import { HealthController } from '../../health/health.controller';
import { MigrationStatusService } from '../../health/migration-status.service';
import { MedibaseController } from '../../medibase/medibase.controller';
import { MedibaseService } from '../../medibase/medibase.service';
import { SignalController } from '../../signal/signal.controller';
import { SignalService } from '../../signal/signal.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GATEWAY_ROUTE_LIST } from './gateway-route-registry';

/**
 * The API reference describes the API that exists.
 *
 * The ZoikoAvail dashboard offers a Documentation button and the reference
 * behind it was thin: the availability endpoint — the one the product is named
 * for — carried no description at all, its only parameter was an undeclared
 * bare @Query, and the health endpoints had no Swagger decorators of any kind.
 *
 * Generated from the real controllers rather than asserted against a hand-kept
 * list, and checked against `gateway-route-registry.ts`, which is what the
 * dashboard's own Endpoints table renders. If a governed route is added there
 * and not documented, this fails.
 */

const stub = () => ({}) as never;

/** The prefix main.ts sets. Named so the assertion below can look for it. */
const API_PREFIX = 'api';

async function buildDocument() {
  const moduleRef = await Test.createTestingModule({
    controllers: [AvailabilityController, MedibaseController, SignalController, HealthController],
  })
    .useMocker((token) => {
      if (token === AvailabilityService) return { getAvailability: jest.fn() };
      if (token === MedibaseService) return { matchMedicines: jest.fn() };
      if (token === SignalService) return { intelligence: jest.fn() };
      if (token === PrismaService) return { $queryRaw: jest.fn() };
      if (token === MigrationStatusService) return { status: jest.fn() };
      return stub();
    })
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  // The prefix is not incidental: main.ts sets one, and the app under test has
  // to be the app that ships. Without it this described a prefix-free API that
  // exists only here, and every assertion below passed while the real document
  // keyed each route under /api and the console found none of them.
  app.setGlobalPrefix(API_PREFIX);
  await app.init();

  // buildOpenApiDocument rather than a second DocumentBuilder, so the options
  // production generates with are the options asserted about. A local copy is
  // what let the prefix mismatch through in the first place.
  const document = buildOpenApiDocument(app, { apiPrefix: API_PREFIX, port: '8000' });
  await app.close();
  return document;
}

let doc: Awaited<ReturnType<typeof buildDocument>>;

beforeAll(async () => {
  doc = await buildDocument();
}, 60_000);

/** The operation object for a method and path, or undefined. */
const op = (method: string, path: string) =>
  (doc.paths as never as Record<string, Record<string, { summary?: string; description?: string }>>)[
    path
  ]?.[method.toLowerCase()];

describe('every governed ZoikoAvail route is documented', () => {
  // The registry is the surface the dashboard renders and the surface an API
  // key is scoped against. Documenting anything less leaves an integrator
  // reading source.
  it.each(GATEWAY_ROUTE_LIST.map((r) => [r.method, r.path, r.description] as const))(
    '%s %s — %s',
    (method, path) => {
      // Swagger writes a path parameter as {id}, the registry as :id.
      const swaggerPath = path.replace(/:(\w+)/g, '{$1}');
      expect(op(method, swaggerPath)).toBeDefined();
    },
  );

  it.each(GATEWAY_ROUTE_LIST.map((r) => [r.method, r.path] as const))(
    '%s %s explains what it does',
    (method, path) => {
      const operation = op(method, path.replace(/:(\w+)/g, '{$1}'));
      expect(operation?.summary?.length ?? 0).toBeGreaterThan(10);
      expect(operation?.description?.length ?? 0).toBeGreaterThan(40);
    },
  );

  it('documents all eight of them and no invented extras', () => {
    const documented = Object.keys(doc.paths).filter(
      (p) => !p.startsWith('/health') && p !== '/signal/aggregates',
    );

    expect(documented.length).toBe(GATEWAY_ROUTE_LIST.length);
  });
});

describe('the availability endpoint, which had nothing', () => {
  const availability = () => op('GET', '/availability');

  it('says what a confidence band is, and is not', () => {
    expect(availability()?.description).toMatch(/confidence band/i);
    expect(availability()?.description).toMatch(/never an exact stock count/i);
  });

  it('declares its query parameter instead of leaving it bare', () => {
    const parameters = (availability() as never as { parameters?: Array<{ name: string; required?: boolean }> })
      .parameters;

    expect(parameters?.find((p) => p.name === 'medicineId')?.required).toBe(true);
  });

  it('documents the error cases an integrator will hit', () => {
    const responses = (availability() as never as { responses: Record<string, unknown> }).responses;

    expect(Object.keys(responses).sort()).toEqual(['200', '404', '429']);
  });
});

describe('health', () => {
  it('documents GET /health', () => {
    expect(op('GET', '/health')?.summary).toBe('Service health');
  });

  it('shows the real response shape, not an invented one', () => {
    // status / service / timestamp is exactly what the handler returns; there is
    // no uptime or telemetry field on it to document.
    const example = (
      op('GET', '/health') as never as {
        responses: Record<string, { content: Record<string, { schema: { example: unknown } }> }>;
      }
    ).responses['200'].content['application/json'].schema.example as Record<string, unknown>;

    expect(Object.keys(example).sort()).toEqual(['service', 'status', 'timestamp']);
    expect(example.status).toBe('ok');
    expect(example.service).toBe('zoikomeds-api');
  });

  it('documents readiness answering 503 when the database is unreachable', () => {
    const responses = (op('GET', '/health/ready') as never as { responses: Record<string, unknown> })
      .responses;

    expect(Object.keys(responses).sort()).toEqual(['200', '503']);
  });
});

describe('authentication is described accurately', () => {
  const security = (method: string, path: string) =>
    (op(method, path) as never as { security?: unknown[] })?.security;

  it.each(['/signal/intelligence', '/signal/intelligence/summary', '/signal/intelligence/export'])(
    '%s requires a bearer token',
    (path) => {
      expect(security('GET', path)).toBeDefined();
    },
  );

  it.each(['/signal/intelligence', '/signal/intelligence/summary', '/signal/intelligence/export'])(
    '%s names the roles that may call it',
    (path) => {
      expect(op('GET', path)?.description).toMatch(/ENTERPRISE, GOVERNMENT or ADMIN/);
    },
  );

  it.each(['/availability', '/medibase/match', '/medibase/lookup', '/health'])(
    '%s is not marked as requiring auth, because it does not',
    (path) => {
      // Documenting a public endpoint as authenticated would be as wrong as the
      // reverse: an integrator would send a token it does not need, and stop
      // when they had none.
      expect(security('GET', path)).toBeUndefined();
    },
  );

  it('documents 401 and 403 on the role-gated scope', () => {
    const responses = (
      op('GET', '/signal/intelligence') as never as { responses: Record<string, unknown> }
    ).responses;

    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['401', '403']));
  });
});

describe('nothing internal leaks into the reference', () => {
  it('documents no admin-only console route', () => {
    // /admin/zoikoavail/telemetry backs the dashboard itself and is SUPER_ADMIN
    // only. It is not part of the governed API and is not described as one.
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/admin'))).toBe(false);
  });

  it('carries no secret, credential or connection string', () => {
    const serialised = JSON.stringify(doc);

    expect(serialised).not.toMatch(/DATABASE_URL|ANTHROPIC_API_KEY|JWT_SECRET|postgres:\/\//i);
  });
});

/**
 * The console reads this document, so the document has to be keyed the way the
 * console looks it up.
 *
 * This is the gap that shipped: main.ts sets a global prefix before generating
 * the document, so every path arrived as `/api/availability`, while the docs
 * service looks routes up by their `gateway-route-registry.ts` path
 * (`/availability`) and health probes by `/health`. Nothing matched, the
 * contract came back with no sections, and the documentation page and Swagger
 * explorer both rendered an API with zero endpoints in production while the
 * routes themselves were live. The old test could not see it: it built its
 * document without a prefix at all.
 */
describe('the document is keyed the way the console reads it', () => {
  it('states each path without the global prefix, because the servers carry it', () => {
    const prefixed = Object.keys(doc.paths).filter((p) => p.startsWith(`/${API_PREFIX}/`));

    // A server of `https://host/api` plus a path of `/api/availability` composes
    // into /api/api/availability — unreachable from the reference that names it.
    expect(prefixed).toEqual([]);
  });

  it('resolves every governed route and health probe through the docs service', () => {
    const service = new ZoikoAvailDocsService({
      get: () => undefined,
    } as never as ConfigService);
    service.register(doc);

    const contract = service.contract();
    const documented = contract.sections.flatMap((s) => s.endpoints);

    // Every governed route, plus the four health probes. An empty or short list
    // here is the production symptom itself.
    expect(documented.length).toBe(GATEWAY_ROUTE_LIST.length + 4);
    expect(contract.sections.map((s) => s.name)).toContain('Health');
  });

  it('serves a specification with paths in it', () => {
    const service = new ZoikoAvailDocsService({
      get: () => undefined,
    } as never as ConfigService);
    service.register(doc);

    expect(Object.keys(service.specification().paths).length).toBeGreaterThan(0);
  });
});
