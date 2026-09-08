import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isPayloadTooLarge } from '../middleware/json-body-limit';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';

/**
 * Prisma error codes that mean the database does not have the shape this build
 * expects — a table or column the generated client selects is not there.
 *
 * P2021 missing table, P2022 missing column.
 */
const SCHEMA_DRIFT_CODES = new Set(['P2021', 'P2022']);

/**
 * Said to the caller when the schema is behind the code.
 *
 * Deliberately names the cause without naming the table or column: the operators
 * who need this cannot always reach the server logs, and a generic "Internal
 * server error" sends them looking for a bug in code that is correct. The
 * identifier itself stays in the log, where schema detail belongs.
 */
const SCHEMA_DRIFT_MESSAGE =
  'This feature is temporarily unavailable: the database schema is behind the deployed ' +
  'application, so a pending migration has not been applied. This is a deployment state, ' +
  'not a fault in the request.';

/**
 * The name of a status code, as the envelope's `error` field.
 *
 * Derived rather than defaulted: the field used to fall back to "Internal Server
 * Error" whenever the thrown exception carried no `error` of its own, which is the
 * case for everything Passport raises. A rejected token was therefore reported as
 * `{"statusCode":401,"error":"Internal Server Error","message":"Unauthorized"}` —
 * an expired session dressed as a crash (MP-18).
 */
function reasonPhrase(status: number): string {
  const name = (HttpStatus as unknown as Record<number, string | undefined>)[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The six fields this envelope owns.
 *
 * Named so they can be stripped out of an exception's payload before the rest
 * of it is carried through: whatever a thrower puts in a `statusCode` or a
 * `path`, the values below are the ones this filter computed, and a payload
 * must not be able to restate — or forge — any of them.
 */
const RESERVED_ENVELOPE_KEYS = new Set([
  'statusCode',
  'error',
  'message',
  'path',
  'requestId',
  'timestamp',
]);

/**
 * The part of an exception's payload that is not the envelope's own.
 *
 * Nest's built-in exceptions carry `{ statusCode, error, message }` and nothing
 * else, so for almost everything this is empty. It exists for the throws that
 * carry a fact the client has to act on rather than only display.
 */
function payloadExtras(body: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => !RESERVED_ENVELOPE_KEYS.has(key),
    ),
  );
}

/**
 * Catch-all exception filter producing a single, sanitized error envelope for
 * every failure. Client (4xx) messages are passed through; server (5xx) errors
 * are logged with their stack but return a generic message so internal details
 * (DB errors, stack traces, query fragments) never leak to callers.
 *
 * A client error's payload is carried through whole, not reduced to its
 * sentence. The envelope used to be rebuilt from `message` and `error` alone,
 * which discarded every other field a thrower had attached — and some failures
 * are not just something to show a person. `AuthService.login` refuses an
 * enrolled administrator with `{ message, mfaRequired: true }`, because a
 * sign-in that needs a second factor is not a wrong password and the login form
 * has to ask for a code; the flag was dropped here, so the form printed the
 * sentence "Enter the code from your authenticator app" and offered nowhere to
 * type one. Two correct halves, and a contract broken in the middle by a file
 * that knows nothing about authentication (MSA-42).
 *
 * Client errors only, deliberately. A 5xx payload is the one place internal
 * detail collects, and the whole point of the paragraph above it is that
 * nothing from a server fault reaches the caller.
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
    const isSchemaDrift =
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      SCHEMA_DRIFT_CODES.has(exception.code);
    // body-parser rejects an oversized body before any controller runs, and it
    // throws a plain Error rather than an HttpException — so this filter used to
    // report "500 Internal server error" for a request that was simply too big,
    // telling the client nothing it could act on.
    const tooLarge = !isHttp && isPayloadTooLarge(exception);

    let status: number;
    if (isHttp) {
      status = exception.getStatus();
    } else if (isSchemaDrift) {
      // Unavailable rather than a server fault: the request is well formed and
      // will succeed once the migration is applied, so it is worth retrying.
      status = HttpStatus.SERVICE_UNAVAILABLE;
    } else if (tooLarge) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    // Extract a client-safe message for HttpExceptions; hide everything else.
    // `error` comes from the status itself, so 413 reads "Payload Too Large"
    // without a second place naming it.
    let message: string | string[] = 'Internal server error';
    let error = reasonPhrase(status);
    // What the exception carried beyond its sentence. Empty for everything that
    // throws a string or a plain Nest exception; see payloadExtras.
    let extras: Record<string, unknown> = {};
    if (isSchemaDrift) {
      message = SCHEMA_DRIFT_MESSAGE;
    } else if (tooLarge) {
      message = 'Request body is too large.';
    }
    if (isHttp) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        // Only when the exception names one; otherwise keep the status's own name.
        error = b.error ?? error;
        if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
          extras = payloadExtras(body);
        }
      }
    }

    const requestId = req.id;
    const envelope = {
      // First, so every field below overwrites it: the six are this filter's
      // own answers, and a payload cannot displace them however it is shaped.
      ...extras,
      statusCode: status,
      error,
      message,
      path: req.originalUrl,
      requestId,
      timestamp: new Date().toISOString(),
    };

    if (isSchemaDrift) {
      // An operational condition, not a fault: the log names the identifier that
      // is missing and what to run. A stack trace would only point at whichever
      // query happened to touch the table first. Kept out of the response above.
      const prismaError = exception as Prisma.PrismaClientKnownRequestError;
      const missing =
        prismaError.meta?.column ?? prismaError.meta?.table ?? 'unknown identifier';
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} SCHEMA DRIFT (${prismaError.code}): ` +
          `${JSON.stringify(missing)} is missing from the database. ` +
          'Run `npx prisma migrate deploy`, or `npx prisma migrate status` if it refuses.',
        undefined,
        'Exception',
      );
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Log 5xx with full detail; 4xx at warn without stack noise.
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
