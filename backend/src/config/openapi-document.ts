import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * The OpenAPI document, built in one place.
 *
 * Three things read this document — the public Swagger UI outside production,
 * the admin console's documentation page, and its Swagger explorer — and all
 * three are only as correct as the options it was generated with. Those options
 * used to live inline in main.ts, with the reference test building a second
 * document of its own from a differently-configured app. The test then passed
 * against a document production never served.
 *
 * What that hid: main.ts calls `setGlobalPrefix('api')` before generating, so
 * every path arrived keyed as `/api/availability`, while `zoikoavail-docs.
 * service.ts` looks routes up by their `gateway-route-registry.ts` path
 * (`/availability`) and health probes by `/health`. Nothing matched. The
 * contract came back with no sections at all, so the documentation page and the
 * explorer both rendered an API with zero endpoints on the live deployment
 * while the routes themselves were up and correctly guarded. The test could not
 * have seen it — its app had no prefix to begin with.
 *
 * So there is one function, and the test calls this one. A change to how the
 * document is generated cannot now apply to production without also applying to
 * what is asserted about it.
 */

/** What the document needs to know about the deployment serving it. */
export interface OpenApiOptions {
  /** The global prefix, which the declared servers carry rather than the paths. */
  apiPrefix: string;
  /** This instance's public origin, if it has one. Empty for a laptop. */
  publicUrl?: string;
  /** Local port, for the development server entry. */
  port?: string;
}

export function buildOpenApiDocument(app: INestApplication, options: OpenApiOptions) {
  const apiPrefix = options.apiPrefix;
  const publicUrl = (options.publicUrl || '').replace(/\/$/, '');
  const port = options.port || '8000';

  const config = new DocumentBuilder()
    .setTitle('ZoikoMeds API')
    .setDescription(
      [
        'Governed medicine availability infrastructure API.',
        '',
        'ZoikoAvail™ is the governed API surface: availability confidence, the',
        'MediBase medicine catalog, and anonymized ZoikoSignal™ intelligence.',
        'Those three scopes are the same ones a platform API key is issued for,',
        'so a key scoped to `medibase` opens exactly the endpoints tagged',
        '`medibase` here.',
        '',
        'Aggregate-only by construction: no endpoint returns patient data, and',
        'availability is a confidence band rather than an exact stock count.',
        '',
        'This reference is served only outside production. The live deployment',
        'does not publish its full API surface, so there is no /docs there.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    // Declared rather than inferred from whichever origin served the page, so
    // the reference reads the same whether it is opened locally or from a
    // staging host.
    .addServer(`http://localhost:${port}/${apiPrefix}`, 'Local development')
    .addServer(
      publicUrl ? `${publicUrl}/${apiPrefix}` : `/${apiPrefix}`,
      publicUrl ? 'This deployment' : 'Same origin',
    )
    // Tag descriptions carry the grouping. The controllers keep their existing
    // lowercase scope tags — they map one-to-one onto API-key scopes, which is
    // information worth keeping — and these say which of them are ZoikoAvail.
    .addTag(
      'availability',
      'ZoikoAvail™ · Availability — governed confidence that a medicine can be obtained nearby. API key scope: `availability`.',
    )
    .addTag(
      'medibase',
      'ZoikoAvail™ · MediBase — the governed medicine catalog: identity matching, external-identifier lookup and the schema contract. API key scope: `medibase`.',
    )
    .addTag(
      'signal',
      'ZoikoAvail™ · Signal — anonymized demand and shortage intelligence. API key scope: `signal`. Requires a bearer token with the ENTERPRISE, GOVERNMENT or ADMIN role.',
    )
    .addTag('health', 'Service health and readiness probes. Unauthenticated.')
    .build();

  // ignoreGlobalPrefix, because the servers above already end in
  // `/${apiPrefix}`. Left at its default the scanner writes the prefix into each
  // path as well, and the two compose into `/api/api/availability` — a reference
  // whose "Try it out" cannot reach the API it documents — while the console's
  // registry lookups miss every route. Both symptoms, one option.
  return SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true });
}
