import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

/**
 * ZoikoSignal™ intelligence surface. Contract-scoped: requires a valid JWT and
 * an ENTERPRISE, GOVERNMENT, or ADMIN role (SUPER_ADMIN always satisfies).
 *
 * Everything returned here is aggregate-only and k-anonymity-safe — no
 * user/patient-level data, no exact stock, and MediBase-suppressed identities
 * are never named. Low-count cells are withheld.
 */
@ApiTags('signal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ENTERPRISE, UserRole.GOVERNMENT, UserRole.ADMIN)
@Controller('signal')
export class SignalController {
  constructor(private readonly signal: SignalService) {}

  @Get('intelligence')
  @ApiOperation({ summary: 'Query time-bucketed, anonymized intelligence cells' })
  intelligence(@Query() query: QueryIntelligenceQuery) {
    return this.signal.getIntelligence(query);
  }

  @Get('intelligence/summary')
  @ApiOperation({ summary: 'Aggregate demand / shortage summary over a window' })
  summary(@Query() query: QueryIntelligenceQuery) {
    return this.signal.getSummary({
      jurisdictionId: query.jurisdictionId,
      from: query.from,
      to: query.to,
      bucket: query.bucket,
    });
  }

  @Get('intelligence/export')
  @ApiOperation({ summary: 'Export anonymized intelligence (JSON or CSV)' })
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
