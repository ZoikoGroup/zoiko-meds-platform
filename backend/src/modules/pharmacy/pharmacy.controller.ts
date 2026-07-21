import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PharmacyService } from './pharmacy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@ApiTags('pharmacy')
@Controller('pharmacies')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  // --- Authenticated inventory & dashboard routes (MUST be declared before :id) ---------

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get dashboard summary for the logged-in pharmacy' })
  async getDashboard(
    @CurrentUser('pharmacyId') pharmacyId: string | null,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    return this.pharmacy.getDashboard(resolvedId);
  }

  @Get('inventory')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List inventory for the logged-in pharmacy' })
  async getInventory(
    @CurrentUser('pharmacyId') pharmacyId: string | null,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    return this.pharmacy.getInventory(resolvedId);
  }

  @Post('inventory/import')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk import medicines from CSV rows or text into pharmacy inventory' })
  async importCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body() body: { rows?: any[]; csvText?: string; mode?: 'merge' | 'replace' },
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null);
    let input: string | any[] = '';
    if (body && body.csvText) {
      input = body.csvText;
    } else if (body && Array.isArray(body.rows)) {
      input = body.rows;
    } else {
      throw new BadRequestException('Please provide valid CSV rows or text to import.');
    }
    const mode = body?.mode === 'replace' ? 'replace' : 'merge';
    return this.pharmacy.importCsv(resolvedId, input, mode, user, ipAddress);
  }

  @Post('inventory')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a medicine to the pharmacy inventory' })
  async addInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body() dto: AddInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null);
    return this.pharmacy.addInventoryItem(resolvedId, dto, user, ipAddress);
  }

  @Patch('inventory/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update availability of an inventory item' })
  async updateInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null);
    return this.pharmacy.updateInventoryItem(resolvedId, id, dto, user, ipAddress);
  }

  @Delete('inventory/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an inventory item' })
  async deleteInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Param('id') id: string,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null);
    return this.pharmacy.deleteInventoryItem(resolvedId, id, user, ipAddress);
  }

  // --- Public routes (no auth required) ------------------------------------

  @Get()
  list() {
    return this.pharmacy.listVerified();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pharmacy.findById(id);
  }
}
