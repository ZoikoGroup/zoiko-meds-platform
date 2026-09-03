import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Service health',
    description:
      'Is the API process up and serving. Unauthenticated, and never rate limited so an orchestrator probe cannot be throttled out. Says nothing about the database — use /health/ready for that.',
  })
  @ApiResponse({
    status: 200,
    description: 'The process is serving.',
    schema: {
      example: {
        status: 'ok',
        service: 'zoikomeds-api',
        timestamp: '2026-09-03T09:57:01.715Z',
      },
    },
  })
  check() {
    return {
      status: 'ok',
      service: 'zoikomeds-api',
      timestamp: new Date().toISOString(),
    };
  }

  /** Liveness probe (orchestrator-friendly alias). */
  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'The smallest possible affirmative, for an orchestrator liveness check.',
  })
  @ApiResponse({ status: 200, description: 'Alive.', schema: { example: { status: 'ok' } } })
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: the service can serve traffic, i.e. its dependencies (DB) are
   * reachable. Returns 503 when the DB is down so load balancers stop routing
   * to this instance instead of serving errors to users.
   */
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Whether this instance can serve traffic, which means its database is reachable. Answers 503 when it is not, so a load balancer stops routing here instead of serving errors. Deliberately silent about schema drift: a database behind the code breaks the features whose migrations are missing, not the service.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dependencies reachable.',
    schema: { example: { status: 'ok', service: 'zoikomeds-api', db: 'up' } },
  })
  @ApiResponse({
    status: 503,
    description: 'The database is unreachable.',
    schema: { example: { status: 'error', service: 'zoikomeds-api', db: 'down' } },
  })
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
  @ApiOperation({
    summary: 'Migration status',
    description:
      'Whether the database schema matches the migrations this build ships. Reports pending and failed migrations by name so "correct code, unapplied migration" can be told apart from a bug in the feature. Names only — no schema contents, no connection details.',
  })
  @ApiResponse({ status: 200, description: 'Schema status, applied count, and any pending or failed migration names.' })
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
