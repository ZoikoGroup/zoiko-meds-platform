import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { jsonBodyLimit } from './common/middleware/json-body-limit';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppLogger } from './common/logger/app-logger.service';
import { StripeConfig } from './modules/commercial/stripe/stripe.config';
import { appBaseUrl, appBaseUrlWarning } from './config/app-urls';
import { MigrationStatusService } from './modules/health/migration-status.service';
import { trustedProxyHops } from './common/client-ip';
import { ZoikoAvailDocsService } from './modules/admin/telemetry/zoikoavail-docs.service';

/**
 * Ceiling for the prescription-scan vision endpoint.
 *
 * Sized from what the client actually sends: up to 4 page images, each capped
 * by VisionExtractDto at ~2.8 M base64 characters. Generous enough for a
 * four-page scan, still a hard stop — an unbounded parser here would let one
 * request exhaust the instance's memory.
 */
const SCAN_VISION_BODY_LIMIT = '12mb';

/**
 * Ceiling for a pharmacy profile save.
 *
 * The profile itself is a few hundred bytes; the allowance is for the licence
 * document that accompanies a verification submission, which the service caps
 * at 5 MB of actual file. Base64 inflates that by a third.
 */
const PHARMACY_PROFILE_BODY_LIMIT = '8mb';

async function bootstrap() {
  // rawBody keeps the exact bytes of each request available. Stripe signs the raw
  // payload, so a re-serialized body would fail verification.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const logger = new AppLogger();
  logger.setContext('Bootstrap');
  app.useLogger(logger);
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // Behind a proxy chain — Vercel's /internal rewrite, then Cloudflare, then the
  // load balancer — so X-Forwarded-* is trusted to the configured depth and no
  // further. One setting rather than two: req.ip, the rate limiter's key and
  // resolveClientIp() all have to agree about where the trusted boundary is, or
  // a request gets throttled under one address and audited under another.
  //
  // Hard-coded 1 is what recorded the Cloudflare edge node against every login.
  // The default is still 1 so deploying this changes nothing on its own; set
  // TRUSTED_PROXY_HOPS from what GET /api/admin/diagnostics/client-ip reports.
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxyHops());

  const apiPrefix = config.get<string>('API_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);

  app.use(helmet());
  // CORS_ORIGIN may be a comma-separated list of allowed origins.
  const corsOrigins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    // Expose the request id so browser clients (e.g. the ZoikoAvail sandbox)
    // can read it and surface a trace id for each request.
    exposedHeaders: ['X-Request-Id'],
  });

  // Prescription page images are base64 data URLs of a few MB each, so the one
  // endpoint that receives them needs a bigger ceiling than the rest of the API.
  // Scoped to that path deliberately: mounted here it runs before Nest's own
  // parser (registered during listen()), so every other route — /auth/login
  // included — keeps Express's 100 kb default. The DTO still caps each image
  // and the array length; this only decides what may reach the validator.
  app.use(
    `/${apiPrefix}/scan/vision-extract`,
    jsonBodyLimit(
      SCAN_VISION_BODY_LIMIT,
      'The prescription images are too large to send. Try fewer pages, or a lower-resolution photo.',
    ),
  );

  // The pharmacy profile save carries the licence document with it, so this
  // route needs the same treatment for the same reason. Capped well below the
  // scan endpoint: one document of a few MB, not four page images.
  app.use(
    `/${apiPrefix}/pharmacies/me`,
    jsonBodyLimit(
      PHARMACY_PROFILE_BODY_LIMIT,
      'That licence document is too large to send. Use a file under 5 MB.',
    ),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Standardized error envelope (no stack/DB leakage) + structured access logs.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // The OpenAPI document is generated on every deployment; only the public
  // Swagger UI below is withheld in production.
  //
  // Generating it exposes nothing — createDocument only introspects the running
  // app — and the admin console's ZoikoAvail documentation page reads a
  // filtered view of it through an authenticated route. That is what lets the
  // page work on the live deployment without publishing raw Swagger.
  {
    const publicUrl = (config.get<string>('API_PUBLIC_URL') || '').replace(/\/$/, '');
    const port = config.get<string>('PORT', '8000');

    const swaggerConfig = new DocumentBuilder()
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
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // The console's source of truth, so its page and this UI cannot drift.
    app.get(ZoikoAvailDocsService).register(document);

    // The public UI, and only outside production: the full API surface is not
    // published to the internet on the live deployment.
    if (!isProd) {
      SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
      logger.log(`Swagger UI: ${publicUrl || `http://localhost:${port}`}/${apiPrefix}/docs`);
    }
  }

  // Surface a dangerous billing configuration at boot rather than at first
  // charge: a live payment key outside production, or a missing webhook secret.
  app.get(StripeConfig).warnOnSuspiciousConfig(config.get<string>('NODE_ENV', 'development'));

  // And an unusable APP_BASE_URL at boot rather than at the first link somebody
  // clicks. Every browser-facing link is built from it, so pointed at the wrong
  // host it is not one broken page but every password reset, invite and payment
  // return at once.
  const appUrlWarning = appBaseUrlWarning(config);
  if (appUrlWarning) {
    logger.warn(appUrlWarning);
  } else {
    logger.log(`Browser links resolve to ${appBaseUrl(config)}`);
  }

  // And a database behind the code at boot rather than at the first request
  // that touches a missing column. Not fatal — the features whose migrations
  // are applied still work, and refusing to start would turn a partial outage
  // into a total one — but it must never again be invisible: this line is what
  // separates "correct code, unapplied migration" from "bug in the feature".
  const schema = await app.get(MigrationStatusService).status();
  if (schema.status === 'ok') {
    logger.log(`Schema up to date on ${schema.datasource} (${schema.applied} migrations applied).`);
  } else {
    logger.error(
      `SCHEMA ${schema.status.toUpperCase()} on ${schema.datasource}: ${schema.detail}` +
        (schema.pending.length ? ` Pending: ${schema.pending.join(', ')}.` : '') +
        (schema.failed.length ? ` Failed: ${schema.failed.join(', ')}.` : ''),
    );
  }

  const port = config.get<number>('PORT', 8000);
  try {
    await app.listen(port);
    logger.log(`🚀 Server running at: http://localhost:${port}/${apiPrefix}`);
    if (!isProd) {
      logger.log(`📚 Swagger Docs: http://localhost:${port}/${apiPrefix}/docs`);
    }
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use. If the 'zoikomeds-api' container is running, the API is already active on that port; stop it with 'docker stop zoikomeds-api' to run locally.`,
      );
    } else {
      logger.error('Failed to start application', (err as Error)?.stack);
    }
    process.exit(1);
  }
}

bootstrap();
