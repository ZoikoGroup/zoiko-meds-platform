import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // Probes must never be rate-limited by orchestrators/LBs.
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
    return {
      status: 'ok',
      service: 'zoikomeds-api',
      db: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}
