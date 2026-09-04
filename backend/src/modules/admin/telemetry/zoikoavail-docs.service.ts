import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GATEWAY_ROUTE_LIST } from './gateway-route-registry';

/**
 * The ZoikoAvail™ API contract, served to the admin console.
 *
 * One source of truth, not two. The console needs to show operators what the
 * governed API accepts and returns, and the obvious way to do that — write the
 * contract into a React page — produces a second description that drifts from
 * the first the next time a controller changes. This serves a filtered view of
 * the very document Swagger builds, from the same decorators, so the page and
 * the Swagger UI cannot disagree.
 *
 * Building that document exposes nothing: `SwaggerModule.createDocument` only
 * introspects the running app, and it is `SwaggerModule.setup` that mounts a
 * public route. So main.ts now builds it unconditionally and registers it here,
 * while the public UI stays mounted outside production only. The console page
 * therefore works on the live deployment without publishing raw Swagger to the
 * internet.
 *
 * What reaches a caller is narrowed twice over. Paths are kept only if they
 * appear in `gateway-route-registry.ts` — the same registry that defines the
 * three API-key scopes — or are health probes. Everything else, `/admin/*`
 * included, is dropped by construction rather than by remembering to omit it.
 */

/**
 * The production API a Super Admin is being told to integrate against.
 *
 * Deliberately not `API_PUBLIC_URL`, which answers a different question — which
 * host serves *this* instance. On a laptop that is localhost, and localhost is
 * not the API anyone integrates with. This is a product fact, so it has a real
 * default rather than degrading to the relative `/api` the document falls back
 * to, which named no host at all and was the thing that made the page confusing.
 */
const DEFAULT_PRODUCTION_API = 'https://get.zoikomeds.com/api';

/** Health probes: public, and useful to an integrator checking connectivity. */
const HEALTH_PATHS = ['/health', '/health/live', '/health/ready', '/health/schema'];

/** Which console section an endpoint belongs under. */
const SECTION_FOR_SCOPE: Record<string, string> = {
  availability: 'Availability',
  medibase: 'MediBase',
  signal: 'Signal',
};

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  security?: unknown[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: { type?: string; example?: unknown };
    example?: unknown;
  }>;
  requestBody?: unknown;
  responses?: Record<string, { description?: string; content?: unknown }>;
}

type OpenApiDocument = {
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
};

@Injectable()
export class ZoikoAvailDocsService {
  private document: OpenApiDocument | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Called once at bootstrap with the document Swagger generated. */
  register(document: unknown): void {
    this.document = document as OpenApiDocument;
  }

  /**
   * The governed surface, grouped for the console.
   *
   * Throws rather than returning an empty contract when the document is
   * missing: a page that renders "no endpoints" would read as a platform with
   * no API, which is a worse answer than saying the contract could not be
   * loaded.
   */
  contract() {
    if (!this.document) {
      throw new ServiceUnavailableException(
        'The API contract has not been generated on this instance.',
      );
    }

    const doc = this.document;
    const sections = new Map<string, ReturnType<typeof this.describe>[]>();

    // Governed routes, in the registry's own order so the console lists them
    // the same way the Endpoints table does.
    for (const route of GATEWAY_ROUTE_LIST) {
      // Swagger writes a path parameter as {id}; the registry writes :id.
      const swaggerPath = route.path.replace(/:(\w+)/g, '{$1}');
      const operation = doc.paths?.[swaggerPath]?.[route.method.toLowerCase()];
      if (!operation) continue;

      const section = SECTION_FOR_SCOPE[route.scope] ?? 'Other';
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section)!.push(this.describe(route.method, swaggerPath, operation, route.scope));
    }

    for (const path of HEALTH_PATHS) {
      const operation = doc.paths?.[path]?.get;
      if (!operation) continue;
      if (!sections.has('Health')) sections.set('Health', []);
      sections.get('Health')!.push(this.describe('GET', path, operation, null));
    }

    return {
      title: 'ZoikoAvail™ API',
      version: doc.info?.version ?? null,
      description: doc.info?.description ?? null,
      servers: this.servers(doc),
      sections: [...sections.entries()].map(([name, endpoints]) => ({ name, endpoints })),
    };
  }

  /**
   * The same filtered surface, as a real OpenAPI document.
   *
   * `contract()` above shapes it for the console's own reading view; Swagger UI
   * needs the specification itself. Both are built from the same two sources —
   * `GATEWAY_ROUTE_LIST` and `HEALTH_PATHS` — so they describe exactly the same
   * endpoints. This is one contract in two renderings, not a second contract,
   * and a test asserts the two path sets are identical so they cannot diverge.
   *
   * The full document is never returned. Paths are rebuilt from the allowlist,
   * so /admin, /auth and every other application route is absent from the
   * object the browser receives rather than merely hidden by the UI.
   */
  specification() {
    if (!this.document) {
      throw new ServiceUnavailableException(
        'The API contract has not been generated on this instance.',
      );
    }

    const doc = this.document as OpenApiDocument & Record<string, unknown>;
    const paths: OpenApiDocument['paths'] = {};

    for (const [path, method] of this.allowedPaths()) {
      const operation = doc.paths?.[path]?.[method];
      if (!operation) continue;
      paths[path] = { ...(paths[path] ?? {}), [method]: operation };
    }

    return {
      openapi: (doc as { openapi?: string }).openapi ?? '3.0.0',
      info: {
        title: 'ZoikoAvail™ API',
        version: doc.info?.version ?? '0.1.0',
        description: doc.info?.description ?? undefined,
      },
      // Production first, so the explorer does not default anyone to a laptop.
      servers: this.servers(doc).map((s) => ({ url: s.url, description: s.description ?? undefined })),
      paths,
      // Only the security schemes, so the Authorize control works. Schemas are
      // carried through because the operations reference them.
      components: (doc as { components?: Record<string, unknown> }).components ?? {},
    };
  }

  /**
   * Every (path, method) the governed surface covers.
   *
   * The single allowlist both renderings read, so neither can widen without the
   * other. Anything not named here is absent from both by construction.
   */
  private allowedPaths(): Array<[string, string]> {
    const rows: Array<[string, string]> = GATEWAY_ROUTE_LIST.map((route) => [
      route.path.replace(/:(\w+)/g, '{$1}'),
      route.method.toLowerCase(),
    ]);
    for (const path of HEALTH_PATHS) rows.push([path, 'get']);
    return rows;
  }

  /**
   * The bases to show, production first.
   *
   * Ordering lives here rather than in the DocumentBuilder on purpose: Swagger
   * UI treats its first server as the target for "Try it out", so promoting
   * production there would let a developer execute against live data from a
   * local tab. The Swagger document keeps local first; this page, which is a
   * reference rather than a console, leads with production.
   *
   * A relative entry is dropped. `/api` named no host, so as the headline
   * "API base URL" it told the reader nothing.
   */
  private servers(doc: OpenApiDocument) {
    const production = String(
      this.config.get<string>('PRODUCTION_API_URL') || DEFAULT_PRODUCTION_API,
    ).replace(/\/$/, '');

    const declared = (doc.servers ?? [])
      // Absolute only: a relative base is ambiguous in documentation.
      .filter((s) => /^https?:\/\//i.test(s.url))
      .map((s) => ({ url: s.url.replace(/\/$/, ''), description: s.description ?? null }));

    const rows = [
      { url: production, description: 'Production API', kind: 'production' as const },
      ...declared
        // Production is already first; do not list the same host twice.
        .filter((s) => s.url !== production)
        .map((s) => ({
          url: s.url,
          description: s.description,
          kind: /localhost|127\.0\.0\.1/i.test(s.url)
            ? ('local' as const)
            : ('deployment' as const),
        })),
    ];

    // Local development is the useful secondary, so it follows production.
    return [
      ...rows.filter((r) => r.kind === 'production'),
      ...rows.filter((r) => r.kind === 'local'),
      ...rows.filter((r) => r.kind === 'deployment'),
    ];
  }

  /**
   * One endpoint, reduced to what an integrator needs.
   *
   * `security` on the operation is what decides whether a bearer token is
   * required — read off the generated document rather than restated here, so a
   * guard added to a controller changes this page without anyone editing it.
   */
  private describe(
    method: string,
    path: string,
    operation: OpenApiOperation,
    scope: string | null,
  ) {
    const requiresAuth = Array.isArray(operation.security) && operation.security.length > 0;

    return {
      method,
      path,
      summary: operation.summary ?? null,
      description: operation.description ?? null,
      scope,
      auth: {
        required: requiresAuth,
        header: requiresAuth ? 'Authorization: Bearer <token>' : null,
        // Stated only where a guard actually restricts them. The roles live in
        // the operation description, which is generated from the controller.
        roles: requiresAuth ? this.rolesFrom(operation.description) : [],
      },
      parameters: (operation.parameters ?? []).map((p) => ({
        name: p.name,
        in: p.in,
        required: Boolean(p.required),
        description: p.description ?? null,
        type: p.schema?.type ?? null,
        example: p.example ?? p.schema?.example ?? null,
      })),
      hasRequestBody: Boolean(operation.requestBody),
      responses: Object.entries(operation.responses ?? {}).map(([status, response]) => ({
        status,
        description: response?.description ?? null,
        example: this.exampleFrom(response?.content),
      })),
    };
  }

  /** The roles named in a generated description, e.g. "ENTERPRISE, GOVERNMENT or ADMIN". */
  private rolesFrom(description?: string): string[] {
    if (!description) return [];
    const known = ['SUPER_ADMIN', 'ADMIN', 'ENTERPRISE', 'GOVERNMENT', 'PHARMACY_ADMIN'];
    return known.filter((role) => new RegExp(`\\b${role}\\b`).test(description));
  }

  /** The response example Swagger holds, when the decorator supplied one. */
  private exampleFrom(content: unknown): unknown {
    const json = (content as Record<string, { schema?: { example?: unknown } }> | undefined)?.[
      'application/json'
    ];
    return json?.schema?.example ?? null;
  }
}
