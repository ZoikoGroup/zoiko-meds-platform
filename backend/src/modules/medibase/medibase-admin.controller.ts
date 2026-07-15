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
import { UserRole } from '@prisma/client';
import { MedibaseService } from './medibase.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { ListMedicinesQuery } from './dto/list-medicines.query';
import { TransitionStateDto } from './dto/transition-state.dto';
import { AddIdentifierDto } from './dto/add-identifier.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * MediBase™ data-curation surface. Requires a valid JWT and the ADMIN role
 * (SUPER_ADMIN always satisfies). Every mutation is recorded in the medicine
 * change-log and the platform audit trail.
 */
@ApiTags('medibase-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('medibase/admin/medicines')
export class MedibaseAdminController {
  constructor(private readonly medibase: MedibaseService) {}

  @Get()
  @ApiOperation({ summary: 'List / search medicine identities (incl. suppressed)' })
  list(@Query() query: ListMedicinesQuery) {
    return this.medibase.listForAdmin(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a medicine identity' })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreateMedicineDto) {
    return this.medibase.create(actorId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a medicine identity with identifiers' })
  get(@Param('id') id: string) {
    return this.medibase.getForAdmin(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update descriptive fields of a medicine identity' })
  update(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineDto,
  ) {
    return this.medibase.update(actorId, id, dto);
  }

  @Post(':id/transition')
  @ApiOperation({ summary: 'Apply a governed quality-state transition' })
  transition(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: TransitionStateDto,
  ) {
    return this.medibase.transitionState(actorId, id, dto);
  }

  @Post(':id/identifiers')
  @ApiOperation({ summary: 'Attach an external identifier mapping' })
  addIdentifier(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: AddIdentifierDto,
  ) {
    return this.medibase.addIdentifier(actorId, id, dto);
  }

  @Delete(':id/identifiers/:identifierId')
  @ApiOperation({ summary: 'Remove an external identifier mapping' })
  removeIdentifier(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Param('identifierId') identifierId: string,
  ) {
    return this.medibase.removeIdentifier(actorId, id, identifierId);
  }

  @Get(':id/changelog')
  @ApiOperation({ summary: 'Change-log / data-lineage trail for a medicine' })
  changeLog(@Param('id') id: string) {
    return this.medibase.listChangeLog(id);
  }
}
