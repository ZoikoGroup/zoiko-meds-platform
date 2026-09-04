import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { GatewayTelemetryService } from './gateway-telemetry.service';
import { ZoikoAvailDocsService } from './zoikoavail-docs.service';
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
  constructor(
    private readonly telemetry: GatewayTelemetryService,
    private readonly docs: ZoikoAvailDocsService,
  ) {}

  @Get('telemetry')
  @ApiOperation({ summary: 'ZoikoAvail governed API health, latency, throughput and endpoint status' })
  telemetrySummary() {
    return this.telemetry.summary();
  }

  @Get('openapi')
  @ApiOperation({
    summary: 'The governed ZoikoAvail API contract, for the console documentation page',
    description:
      'A filtered view of the OpenAPI document this build generates — the same one the Swagger UI renders, so the console page cannot drift from it. Narrowed to the routes in the gateway registry plus the health probes, so no internal or admin route is included. Behind the SUPER_ADMIN guard like the rest of this controller, which is what lets the console show the contract on a deployment that does not publish Swagger publicly.',
  })
  contract() {
    return this.docs.contract();
  }

  @Get('openapi/spec')
  @ApiOperation({
    summary: 'The same governed contract, as an OpenAPI document',
    description:
      'What the console’s Swagger explorer renders. Identical surface to /openapi above — both are built from one allowlist — in the specification format Swagger UI consumes. Behind the same SUPER_ADMIN guard, which is what lets an operator explore the API on a deployment that does not publish /api/docs publicly.',
  })
  specification() {
    return this.docs.specification();
  }
}
