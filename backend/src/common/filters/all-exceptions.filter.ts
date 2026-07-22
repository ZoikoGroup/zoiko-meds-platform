import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';

/**
 * Catch-all exception filter producing a single, sanitized error envelope for
 * every failure. Client (4xx) messages are passed through; server (5xx) errors
 * are logged with their stack but return a generic message so internal details
 * (DB errors, stack traces, query fragments) never leak to callers.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new AppLogger();

  constructor() {
    this.logger.setContext?.('Exception');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extract a client-safe message for HttpExceptions; hide everything else.
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    if (isHttp) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? error;
      }
    }

    const requestId = req.id;
    const envelope = {
      statusCode: status,
      error,
      message,
      path: req.originalUrl,
      requestId,
      timestamp: new Date().toISOString(),
    };

    // Log 5xx with full detail; 4xx at warn without stack noise.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}`,
        stack,
        'Exception',
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl} -> ${status} ${JSON.stringify(message)}`,
        'Exception',
      );
    }

    res.status(status).json(envelope);
  }
}
