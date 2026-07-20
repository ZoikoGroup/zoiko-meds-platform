import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

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
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API docs — gate/noindex in non-dev environments per the API spec.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ZoikoMeds API')
    .setDescription('Governed medicine availability infrastructure API')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const port = config.get<number>('PORT', 8000);
  try {
    await app.listen(port);
    // eslint-disable-next-line no-console
    console.log(`ZoikoMeds API listening on http://localhost:${port}/${apiPrefix}`);
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(
        `\n❌ [Port Conflict] Port ${port} is already in use.\n` +
          `• If Docker container 'zoikomeds-api' is running, your API is ALREADY ACTIVE at http://localhost:${port}/${apiPrefix}\n` +
          `• To run locally outside Docker, stop the container first: docker stop zoikomeds-api\n`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.error('Failed to start application:', err);
    }
    process.exit(1);
  }
}

bootstrap();
