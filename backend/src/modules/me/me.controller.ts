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
import { MeService } from './me.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SearchQueryDto } from './dto/search-query.dto';
import { SaveMedicineDto } from './dto/save-medicine.dto';
import { SavedQueryDto } from './dto/saved-query.dto';
import { UpdateAlertsDto } from './dto/update-alerts.dto';
import { UpdateSavedAlertsDto } from './dto/update-saved-alerts.dto';

/**
 * Patient portal API. Any authenticated user may call these; data is always
 * scoped to the caller (`userId`). Availability is a governed confidence band.
 */
@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search medicines with availability confidence' })
  search(@CurrentUser('id') userId: string, @Query() query: SearchQueryDto) {
    return this.me.search(userId, query);
  }

  @Get('pharmacies')
  @ApiOperation({ summary: 'Nearby verified pharmacies' })
  pharmacies(@Query() query: SavedQueryDto) {
    // "Nearby" is relative to the caller. Without lat/lng there is no point to
    // be near, so the list is unbounded rather than measured from a fixed one.
    const origin =
      query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : null;
    return this.me.pharmacies(query.maxDistance, origin);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Patient dashboard summary' })
  overview(@CurrentUser('id') userId: string) {
    return this.me.overview(userId);
  }

  @Get('saved')
  @ApiOperation({ summary: 'List saved medicines' })
  listSaved(@CurrentUser('id') userId: string, @Query() query: SavedQueryDto) {
    return this.me.listSaved(userId, query);
  }

  @Post('saved')
  @ApiOperation({ summary: 'Save a medicine' })
  save(@CurrentUser('id') userId: string, @Body() dto: SaveMedicineDto) {
    return this.me.save(userId, dto);
  }

  @Delete('saved/:medicineId')
  @ApiOperation({ summary: 'Remove a saved medicine' })
  unsave(
    @CurrentUser('id') userId: string,
    @Param('medicineId') medicineId: string,
  ) {
    return this.me.unsave(userId, medicineId);
  }

  @Patch('saved/:medicineId/alerts')
  @ApiOperation({ summary: 'Toggle alerts for a saved medicine' })
  updateSavedAlerts(
    @CurrentUser('id') userId: string,
    @Param('medicineId') medicineId: string,
    @Body() dto: UpdateSavedAlertsDto,
  ) {
    return this.me.updateSavedMedicineAlerts(
      userId,
      medicineId,
      dto.alertsEnabled,
    );
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get alert preferences' })
  getAlerts(@CurrentUser('id') userId: string) {
    return this.me.getAlerts(userId);
  }

  @Patch('alerts')
  @ApiOperation({ summary: 'Update alert preferences' })
  updateAlerts(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAlertsDto,
  ) {
    return this.me.updateAlerts(userId, dto);
  }
}
