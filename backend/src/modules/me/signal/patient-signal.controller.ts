import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientSignalService } from './patient-signal.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UpdateSignalSettingsDto } from './dto/update-signal-settings.dto';
import { SetPriorityDto } from './dto/set-priority.dto';

/**
 * Patient ZoikoSignal™ — personalized availability notifications for the caller.
 * Any authenticated user may call these; everything is scoped to `userId`.
 */
@ApiTags('me-signal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/signal')
export class PatientSignalController {
  constructor(private readonly signal: PatientSignalService) {}

  @Get('summary')
  @ApiOperation({ summary: 'ZoikoSignal summary counters' })
  summary(@CurrentUser('id') userId: string) {
    return this.signal.summary(userId);
  }

  @Get('digest')
  @ApiOperation({ summary: 'Compact digest for the home widget / nav badge' })
  digest(@CurrentUser('id') userId: string) {
    return this.signal.digest(userId);
  }

  @Get('saved-status')
  @ApiOperation({ summary: 'Saved medicines with current availability status' })
  savedStatus(@CurrentUser('id') userId: string) {
    return this.signal.savedStatus(userId);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Active (non-archived) notifications' })
  notifications(@CurrentUser('id') userId: string) {
    return this.signal.listNotifications(userId);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Prominent, actionable availability alerts' })
  alerts(@CurrentUser('id') userId: string) {
    return this.signal.listActiveAlerts(userId);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Notification preferences' })
  getSettings(@CurrentUser('id') userId: string) {
    return this.signal.getSettings(userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update notification preferences' })
  updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSignalSettingsDto,
  ) {
    return this.signal.updateSettings(userId, dto);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications read' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.signal.markAllRead(userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a notification read' })
  markRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.signal.markRead(userId, id);
  }

  @Post('notifications/:id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a notification' })
  dismiss(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.signal.dismiss(userId, id);
  }

  @Post('notifications/:id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a notification' })
  archive(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.signal.archive(userId, id);
  }

  @Post('saved/:medicineId/priority')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a saved medicine priority' })
  setPriority(
    @CurrentUser('id') userId: string,
    @Param('medicineId') medicineId: string,
    @Body() dto: SetPriorityDto,
  ) {
    return this.signal.setPriority(userId, medicineId, dto.priority);
  }
}
