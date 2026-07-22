import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Attaches a stable request id to every request and echoes it in the
 * `X-Request-Id` response header. Honours an inbound id from a trusted proxy so
 * a single request can be traced across services/log lines.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const id =
      (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : undefined) ?? randomUUID();
    (req as Request & { id?: string }).id = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
