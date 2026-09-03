import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { IpBearingRequest, resolveClientIp } from '../client-ip';

/**
 * The client address, resolved the same way everywhere.
 *
 * Replaces Nest's `@Ip()` on every handler that records one. `@Ip()` returns
 * Express's `req.ip`, which under `trust proxy = 1` was the rightmost
 * X-Forwarded-For entry — the Cloudflare edge node, not the person. Forty-seven
 * handlers read it, so fixing the login route alone would have left the rest of
 * the audit log recording infrastructure.
 *
 * See `client-ip.ts` for how the address is chosen and why the header is
 * discarded rather than clamped when the chain is too short.
 */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    resolveClientIp(ctx.switchToHttp().getRequest<IpBearingRequest>()),
);
