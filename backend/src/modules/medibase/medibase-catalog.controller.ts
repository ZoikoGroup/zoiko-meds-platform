import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MedibaseService } from './medibase.service';
import { ListIdentitiesQuery } from './dto/list-identities.query';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * MediBase™ catalog governance read surface — the aggregate view behind the
 * admin MediBase dashboard.
 *
 * Separate from MedibaseAdminController (which pages over individual medicine
 * records under /medibase/admin/medicines) because these are catalog-level
 * rollups, and because a sibling path keeps them clear of that controller's
 * `:id` route. Same guards: ADMIN only, JWT required.
 */
@ApiTags('medibase-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('medibase/admin/catalog')
export class MedibaseCatalogController {
  constructor(private readonly medibase: MedibaseService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Catalog-wide normalization, quality and governance statistics' })
  overview() {
    return this.medibase.catalogOverview();
  }

  @Get('identities')
  @ApiOperation({ summary: 'Generic identities with brand/strength/form/market fan-out' })
  identities(@Query() query: ListIdentitiesQuery) {
    return this.medibase.listIdentities(query);
  }

  @Get('jurisdictions')
  @ApiOperation({ summary: 'Jurisdictions available for curation (medicine/pharmacy assignment)' })
  jurisdictions() {
    return this.medibase.listJurisdictions();
  }
}
