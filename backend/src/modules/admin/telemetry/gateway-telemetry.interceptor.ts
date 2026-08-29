import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { GatewayRequestRecorder } from './gateway-telemetry.recorder';
import { GATEWAY_ROUTES } from './gateway-route-registry';

/**
 * Records one row per request into GatewayRequestLog, for the three
 * controllers that make up the ZoikoAvail™ governed API (Availability,
 * MediBase, Signal's public surface). Applied at the controller level via
 * @UseInterceptors so it never touches unrelated routes (auth, admin, scan…).
 *
 * Structured like the app-wide LoggingInterceptor (same tap/duration
 * pattern) but persists to the database instead of a log line, since this
 * feeds the admin ZoikoAvail console rather than ops logs.
 */
@Injectable()
export class GatewayTelemetryInterceptor implements NestInterceptor {
  constructor(private readonly recorder: GatewayRequestRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const meta = GATEWAY_ROUTES[context.getClass().name]?.[context.getHandler().name];
    if (!meta) return next.handle();

    const res = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();

    const write = (statusCode: number) =>
      this.recorder.record({
        scope: meta.scope,
        route: meta.path,
        method: meta.method,
        statusCode,
        durationMs: Date.now() - startedAt,
      });

    return next.handle().pipe(
      tap({
        next: () => write(res.statusCode),
        error: () => write(res.statusCode || 500),
      }),
    );
  }
}
