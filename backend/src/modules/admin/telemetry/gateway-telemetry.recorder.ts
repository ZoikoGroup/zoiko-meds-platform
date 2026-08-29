import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface GatewayRequestRecord {
  scope: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
}

/**
 * Persists one row per request served by the ZoikoAvail™ governed API surface
 * (see GatewayTelemetryInterceptor). Never awaited by a caller: a failed
 * bookkeeping write must not fail the real response it is describing — the
 * same reasoning as PlatformApiKeyService.resolve's lastUsedAt update.
 */
@Injectable()
export class GatewayRequestRecorder {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: GatewayRequestRecord): void {
    void this.prisma.gatewayRequestLog.create({ data: entry }).catch(() => undefined);
  }
}
