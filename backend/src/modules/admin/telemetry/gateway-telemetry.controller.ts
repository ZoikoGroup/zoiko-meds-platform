import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { GatewayTelemetryService } from './gateway-telemetry.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/** Backs the admin ZoikoAvail™ console (MSA-36) — real numbers, not fixtures. */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/zoikoavail')
export class GatewayTelemetryController {
  constructor(private readonly telemetry: GatewayTelemetryService) {}

  @Get('telemetry')
  @ApiOperation({ summary: 'ZoikoAvail governed API health, latency, throughput and endpoint status' })
  telemetrySummary() {
    return this.telemetry.summary();
  }
}
