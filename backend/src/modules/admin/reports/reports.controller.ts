import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ClientIp } from '../../../common/decorators/client-ip.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'List saved & scheduled reports' })
  list() {
    return this.reports.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create / generate a report' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.reports.create(user.id, user.email, dto, ipAddress);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate an existing report' })
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @ClientIp() ipAddress: string,
  ) {
    return this.reports.duplicate(user.id, user.email, id, ipAddress);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a report as its stated format',
    description:
      'Answers with the artifact itself, not a description of one: a PDF report returns application/pdf, a CSV report text/csv. The format column and the downloaded file are decided together (MSA-53).',
  })
  @ApiProduces('application/pdf', 'text/csv', 'application/json')
  async download(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @ClientIp() ipAddress: string,
    @Res() res: Response,
  ) {
    const artifact = await this.reports.download(actorId, id, ipAddress);
    res
      .status(200)
      .set({
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="${artifact.filename}"`,
        'Content-Length': String(artifact.body.length),
        // An export is a point-in-time document; a cached copy would be a
        // different report wearing the same URL.
        'Cache-Control': 'no-store',
      })
      .send(artifact.body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single report' })
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a report' })
  remove(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @ClientIp() ipAddress: string,
  ) {
    return this.reports.remove(actorId, id, ipAddress);
  }
}
