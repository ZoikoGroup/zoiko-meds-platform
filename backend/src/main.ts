import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppLogger } from './common/logger/app-logger.service';

async function bootstrap() {
  // rawBody keeps the exact bytes of each request available. Stripe signs the raw
  // payload, so a re-serialized body would fail verification.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const logger = new AppLogger();
  logger.setContext('Bootstrap');
  app.useLogger(logger);
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // Behind a proxy/load balancer (Cloud Run, nginx), trust X-Forwarded-* so
  // req.ip and rate-limiting key off the real client address.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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

  // API docs — exposed only outside production so the full API surface is not
  // published to the internet on the live deployment.
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ZoikoMeds API')
      .setDescription('Governed medicine availability infrastructure API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
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
