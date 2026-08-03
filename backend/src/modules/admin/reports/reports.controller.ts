import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

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
  ) {
    return this.reports.create(user.id, user.email, dto);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate an existing report' })
  duplicate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.duplicate(user.id, user.email, id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a report as a governed export payload' })
  download(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.reports.download(actorId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single report' })
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a report' })
  remove(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.reports.remove(actorId, id);
  }
}
