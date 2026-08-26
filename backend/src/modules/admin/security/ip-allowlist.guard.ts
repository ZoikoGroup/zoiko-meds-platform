import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { isAllowed } from './ip-allowlist';

/**
 * Routes that must answer whatever the allowlist says.
 *
 * Health probes come from the orchestrator's own network, and a load balancer
 * that starts getting 403s will take the instance out of service — turning a
 * misconfigured allowlist into a total outage instead of a lockout somebody can
 * still be talked through.
 */
const ALWAYS_ALLOWED = [/^\/?api\/health(\/|$)/, /^\/?health(\/|$)/];

/**
 * Restrict the API to a set of networks (MSA-42).
 *
 * The settings page carried an "IP allowlist" switch bound to component state.
 * This is the restriction it claimed to apply.
 *
 * The policy is read per request rather than cached, because the alternative is
 * an operator switching the allowlist off to recover access and the instance
 * ignoring them for however long a cache lives. The read is one indexed
 * primary-key lookup.
 */
@Injectable()
export class IpAllowlistGuard implements CanActivate {
  private readonly logger = new AppLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {
    this.logger.setContext?.('IpAllowlist');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const path = request.originalUrl?.split('?')[0] ?? '';
    if (ALWAYS_ALLOWED.some((pattern) => pattern.test(path))) return true;

    let policy: { ipAllowlistEnabled: boolean; ipAllowlist: string[] } | null;
    try {
      policy = await this.prisma.organization.findUnique({
        where: { id: 'singleton' },
        select: { ipAllowlistEnabled: true, ipAllowlist: true },
      });
    } catch {
      // A database the guard cannot read is not grounds to refuse every request:
      // that would turn a database blip into a total outage, and the rest of the
      // request will fail on its own if the database really is gone.
      return true;
    }

    if (!policy?.ipAllowlistEnabled) return true;

    // Switched on with nothing in it is a half-finished setup, not "deny all".
    // Denying here would lock out the very session that would add the first
    // entry, including on the request that turns the switch back off.
    if (policy.ipAllowlist.length === 0) return true;

    // req.ip already honours the trust-proxy setting configured in main.ts, so
    // behind the load balancer this is the client address, not the proxy's.
    if (isAllowed(request.ip, policy.ipAllowlist)) return true;

    this.logger.warn(
      `Refused ${request.method} ${path} from ${request.ip ?? 'unknown'}: outside the workspace IP allowlist.`,
      'IpAllowlist',
    );
    throw new ForbiddenException(
      'This workspace only accepts requests from approved networks, and yours is not one of them.',
    );
  }
}
