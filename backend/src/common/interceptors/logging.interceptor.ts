import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from '../logger/app-logger.service';
import { resolveClientIp } from '../client-ip';

/**
 * Logs one structured line per HTTP request with method, path, status,
 * duration and the request id. Bodies and headers are intentionally omitted to
 * avoid logging PII or credentials.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new AppLogger();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.write(req, res.statusCode, startedAt),
        error: () => this.write(req, res.statusCode || 500, startedAt),
      }),
    );
  }

  private write(req: Request & { id?: string }, statusCode: number, startedAt: number) {
    this.logger.request({
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      statusCode,
      durationMs: Date.now() - startedAt,
      // The same address the audit log records. Request logs and audit rows
      // naming different IPs for one request is how an incident review loses an
      // hour.
      ip: resolveClientIp(req),
    });
  }
}
