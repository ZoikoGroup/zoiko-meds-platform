import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List broadcast notifications' })
  list() {
    return this.notifications.list();
  }

  @Get('inbox')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Verification submissions awaiting Super Admin review',
    description:
      'The console bell used to read only the broadcast outbox, so a pharmacy submitting its licence told nobody. Derived from the review queue rather than written on submission, which is why it cannot duplicate. Names pharmacies under review, so it is role-guarded.',
  })
  inbox() {
    return this.notifications.inbox();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Compose & dispatch a broadcast' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateNotificationDto,
    @Ip() ipAddress: string,
  ) {
    return this.notifications.create(user.id, user.email, dto, ipAddress);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  remove(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Ip() ipAddress: string,
  ) {
    return this.notifications.remove(actorId, id, ipAddress);
  }
}
