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
import { UpdateAlertsDto } from './dto/update-alerts.dto';

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
  pharmacies(@Query('maxDistance') maxDistance?: string) {
    return this.me.pharmacies(maxDistance ? Number(maxDistance) : 5);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Patient dashboard summary' })
  overview(@CurrentUser('id') userId: string) {
    return this.me.overview(userId);
  }

  @Get('saved')
  @ApiOperation({ summary: 'List saved medicines' })
  listSaved(@CurrentUser('id') userId: string) {
    return this.me.listSaved(userId);
  }

  @Post('saved')
  @ApiOperation({ summary: 'Save a medicine' })
  save(@CurrentUser('id') userId: string, @Body() dto: SaveMedicineDto) {
    return this.me.save(userId, dto.medicineId);
  }

  @Delete('saved/:medicineId')
  @ApiOperation({ summary: 'Remove a saved medicine' })
  unsave(
    @CurrentUser('id') userId: string,
    @Param('medicineId') medicineId: string,
  ) {
    return this.me.unsave(userId, medicineId);
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
