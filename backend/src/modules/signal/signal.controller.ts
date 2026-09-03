import { Controller, Get, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags , ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { SignalService } from './signal.service';
import { QueryIntelligenceQuery } from './dto/query-intelligence.query';
import {
  ExportFormat,
  ExportIntelligenceQuery,
} from './dto/export-intelligence.query';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GatewayTelemetryInterceptor } from '../admin/telemetry/gateway-telemetry.interceptor';

/**
 * ZoikoSignal™ intelligence surface. Contract-scoped: requires a valid JWT and
 * an ENTERPRISE, GOVERNMENT, or ADMIN role (SUPER_ADMIN always satisfies).
 *
 * Everything returned here is aggregate-only and k-anonymity-safe — no
 * user/patient-level data, no exact stock, and MediBase-suppressed identities
 * are never named. Low-count cells are withheld.
 */
/** Stated once so the three operation descriptions cannot drift apart. */
const ROLES_DOC =
  'Requires a bearer token whose role is ENTERPRISE, GOVERNMENT or ADMIN. API key scope: `signal`.';

@ApiTags('signal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ENTERPRISE, UserRole.GOVERNMENT, UserRole.ADMIN)
@UseInterceptors(GatewayTelemetryInterceptor)
@Controller('signal')
export class SignalController {
  constructor(private readonly signal: SignalService) {}

  @Get('intelligence')
  @ApiOperation({
    summary: 'Query time-bucketed, anonymized intelligence cells',
    description:
      'ZoikoSignal™ demand and shortage intelligence, bucketed by time and jurisdiction. Aggregate by construction: a cell records what happened and which governed identity it concerned, never who caused it, so there is no patient to re-identify. ' + ROLES_DOC,
  })
  @ApiResponse({ status: 200, description: 'Intelligence cells for the requested window.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  @ApiResponse({ status: 403, description: 'Token does not carry an eligible role.' })
  intelligence(@Query() query: QueryIntelligenceQuery) {
    return this.signal.getIntelligence(query);
  }

  @Get('intelligence/summary')
  @ApiOperation({
    summary: 'Aggregate demand / shortage summary over a window',
    description:
      'The same intelligence rolled up to totals for a period — searches, unmet demand, restocks and confirmations. ' + ROLES_DOC,
  })
  @ApiResponse({ status: 200, description: 'Totals for the window.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  @ApiResponse({ status: 403, description: 'Token does not carry an eligible role.' })
  summary(@Query() query: QueryIntelligenceQuery) {
    return this.signal.getSummary({
      jurisdictionId: query.jurisdictionId,
      from: query.from,
      to: query.to,
      bucket: query.bucket,
    });
  }

  @Get('intelligence/export')
  @ApiOperation({
    summary: 'Export anonymized intelligence (JSON or CSV)',
    description:
      'The same cells as a downloadable artifact. Aggregate-only, like everything on this scope: no patient data and no exact stock counts are present to export. ' + ROLES_DOC,
  })
  @ApiResponse({ status: 200, description: 'The export, in the requested format.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  @ApiResponse({ status: 403, description: 'Token does not carry an eligible role.' })
  async export(
    @Query() query: ExportIntelligenceQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, contentType, body } = await this.signal.exportIntelligence(
      query,
      query.format ?? ExportFormat.JSON,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  @Get('aggregates')
  @ApiOperation({ summary: 'Anonymized aggregate cells (legacy alias)' })
  async aggregates(@Query() query: QueryIntelligenceQuery) {
    const result = await this.signal.getIntelligence(query);
    return result.items;
  }
}
