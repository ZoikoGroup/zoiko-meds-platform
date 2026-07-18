import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SignalService } from './signal.service';
import { SignalIngestService } from './signal-ingest.service';
import { SignalAggregationService } from './signal-aggregation.service';
import { IngestEventDto } from './dto/ingest-event.dto';
import { RunAggregationDto } from './dto/run-aggregation.dto';
import { QueryIntelligenceQuery } from './dto/query-intelligence.query';
import { AuditWriter } from '../admin/audit.writer';
import {
  kAnonymityThreshold,
  rawEventRetentionDays,
} from './signal.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * ZoikoSignal™ operations surface. ADMIN only (SUPER_ADMIN always satisfies).
 * Covers the aggregation job trigger, event backfill/replay, and pipeline
 * status. Unlike the contract surface, admins may inspect masked (suppressed)
 * cells for governance review. Every action is audit-logged.
 */
@ApiTags('signal-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('signal/admin')
export class SignalAdminController {
  constructor(
    private readonly signal: SignalService,
    private readonly ingest: SignalIngestService,
    private readonly aggregation: SignalAggregationService,
    private readonly audit: AuditWriter,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Aggregation pipeline status & governance settings' })
  async status() {
    return {
      pendingEvents: await this.aggregation.pendingCount(),
      kAnonymity: kAnonymityThreshold(),
      rawEventRetentionDays: rawEventRetentionDays(),
    };
  }

  @Get('intelligence')
  @ApiOperation({ summary: 'Intelligence cells including masked (suppressed) cells' })
  intelligence(@Query() query: QueryIntelligenceQuery) {
    return this.signal.getIntelligence(query, { includeSuppressed: true });
  }

  @Post('events')
  @ApiOperation({ summary: 'Backfill / replay a single intelligence event' })
  async ingestEvent(
    @CurrentUser('id') actorId: string,
    @Body() dto: IngestEventDto,
  ) {
    await this.ingest.emit(dto.type, {
      medicineId: dto.medicineId ?? null,
      jurisdictionId: dto.jurisdictionId ?? null,
      pharmacyId: dto.pharmacyId ?? null,
      searchTerm: dto.searchTerm ?? null,
    });
    await this.audit.write(actorId, 'signal.event.ingest', 'ZoikoSignal', null, {
      type: dto.type,
      medicineId: dto.medicineId ?? null,
    });
    return { accepted: true, type: dto.type };
  }

  @Post('aggregate')
  @ApiOperation({ summary: 'Run the aggregation job over pending events' })
  async aggregate(
    @CurrentUser('id') actorId: string,
    @Body() dto: RunAggregationDto,
  ) {
    const result = await this.aggregation.runAggregation({
      bucket: dto.bucket,
      batchSize: dto.batchSize,
      prune: dto.prune,
    });
    await this.audit.write(
      actorId,
      'signal.aggregate.run',
      'ZoikoSignal',
      null,
      { ...result },
    );
    return result;
  }
}
