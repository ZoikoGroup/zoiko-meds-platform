import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole, VerificationStatus } from '@prisma/client';
import { PharmacyAdminService } from './pharmacy-admin.service';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { ListPharmaciesQuery } from './dto/list-pharmacies.query';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/pharmacies')
export class PharmacyAdminController {
  constructor(private readonly pharmacies: PharmacyAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List / search / filter pharmacies' })
  list(@Query() query: ListPharmaciesQuery) {
    return this.pharmacies.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Register a pharmacy (starts PENDING)' })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreatePharmacyDto) {
    return this.pharmacies.create(actorId, dto);
  }

  @Post('bulk-status')
  @ApiOperation({ summary: 'Set verification status on many pharmacies' })
  bulk(@CurrentUser('id') actorId: string, @Body() dto: BulkStatusDto) {
    return this.pharmacies.bulkSetStatus(actorId, dto.ids, dto.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.pharmacies.get(id);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePharmacyDto,
  ) {
    return this.pharmacies.update(actorId, id, dto);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Mark a pharmacy VERIFIED' })
  verify(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.pharmacies.setStatus(actorId, id, VerificationStatus.VERIFIED);
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Mark a pharmacy SUSPENDED' })
  suspend(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.pharmacies.setStatus(actorId, id, VerificationStatus.SUSPENDED);
  }

  @Delete(':id')
  remove(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.pharmacies.remove(actorId, id);
  }
}
