import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { VerificationService } from './verification.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/verification-requests')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @ApiOperation({ summary: 'List pharmacy verification requests' })
  list() {
    return this.verification.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a verification request' })
  create(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateVerificationDto,
  ) {
    return this.verification.create(actorId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Review a request (status / reviewer / note)' })
  update(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVerificationDto,
  ) {
    return this.verification.update(actorId, id, dto);
  }
}
