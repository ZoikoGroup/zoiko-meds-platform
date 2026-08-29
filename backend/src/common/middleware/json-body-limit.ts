import { json } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * A JSON body parser for one route, with its own size limit.
 *
 * Nest registers a single global body parser during `app.init()`, at Express's
 * default 100 kb. That is the right ceiling for the rest of this API — a login
 * or a profile save has no business being larger — but prescription page images
 * arrive as base64 data URLs and are megabytes each, so the one endpoint that
 * takes them was refusing every realistic request.
 *
 * Mounting this on a path in `main.ts` (before `listen()`, and therefore before
 * Nest registers its own) parses that route here first; body-parser marks the
 * request as read, so Nest's parser skips it and every other route keeps the
 * default limit untouched.
 *
 * An oversized body is answered directly with 413 and a message the client can
 * show. Left to bubble it would reach Express's default error handler as HTML,
 * or Nest's filter as a bare 500 — which is what the endpoint used to return,
 * with nothing to say the request was simply too big.
 */
export function jsonBodyLimit(limit: string, hint: string): RequestHandler {
  const parse = json({ limit });

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (err?: unknown) => {
      if (!err) return next();
      if (isPayloadTooLarge(err)) {
        res.status(413).json({
          statusCode: 413,
          error: 'Payload Too Large',
          message: hint,
          path: req.originalUrl,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    });
  };
}

/**
 * body-parser's own signal for an oversized body.
 *
 * `type` is the reliable one — it is set on the error body-parser constructs,
 * whereas `status`/`statusCode` are also set by unrelated parse failures.
 */
export function isPayloadTooLarge(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  return (
    candidate.type === 'entity.too.large' ||
    candidate.status === 413 ||
    candidate.statusCode === 413
  );
}
