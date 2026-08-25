import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { MigrationStatusService } from './migration-status.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // Probes must never be rate-limited by orchestrators/LBs.
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrations: MigrationStatusService,
  ) {}

  /** Liveness: the process is up and serving. Does not touch the DB. */
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'zoikomeds-api',
      timestamp: new Date().toISOString(),
    };
  }

  /** Liveness probe (orchestrator-friendly alias). */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: the service can serve traffic, i.e. its dependencies (DB) are
   * reachable. Returns 503 when the DB is down so load balancers stop routing
   * to this instance instead of serving errors to users.
   */
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'zoikomeds-api',
        db: 'down',
      });
    }
    // Deliberately says nothing about the schema. A database behind the code
    // breaks the features whose migrations are missing, not the service, so a
    // 503 here would pull a mostly-working instance out of the load balancer
    // and turn a partial outage into a total one. Readiness is also the most
    // frequently polled route on the API; the ledger comparison belongs on
    // /health/schema below, which is asked only when someone wants the answer.
    return {
      status: 'ok',
      service: 'zoikomeds-api',
      db: 'up',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * The migration ledger, compared with the migrations this build ships with.
   *
   * Unauthenticated on purpose. It reports only migration directory names —
   * which are public in the repository — plus the database name and host, never
   * credentials. The alternative is what this deployment had before: the only
   * view of the production schema was a shell on the VM, so a pending migration
   * looked identical to a bug in correct code for eleven days.
   */
  @Get('schema')
  // Not a probe: nothing polls this on an interval, so it takes the normal rate
  // limit rather than the controller's blanket exemption. It is unauthenticated
  // and touches the database, and an unthrottled query is an invitation.
  @SkipThrottle({ default: false })
  async schema() {
    return {
      service: 'zoikomeds-api',
      ...(await this.migrations.status()),
      timestamp: new Date().toISOString(),
    };
  }
}
