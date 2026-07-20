import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PharmacyService } from './pharmacy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
    @CurrentUser('pharmacyId') pharmacyId: string | null,
    @Body() body: { rows?: any[]; csvText?: string; mode?: 'merge' | 'replace' },
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    let input: string | any[] = '';
    if (body && body.csvText) {
      input = body.csvText;
    } else if (body && Array.isArray(body.rows)) {
      input = body.rows;
    } else {
      throw new BadRequestException('Please provide valid CSV rows or text to import.');
    }
    const mode = body?.mode === 'replace' ? 'replace' : 'merge';
    return this.pharmacy.importCsv(resolvedId, input, mode);
  }

  @Post('inventory')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a medicine to the pharmacy inventory' })
  async addInventory(
    @CurrentUser('pharmacyId') pharmacyId: string | null,
    @Body() dto: AddInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    return this.pharmacy.addInventoryItem(resolvedId, dto);
  }

  @Patch('inventory/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update availability of an inventory item' })
  async updateInventory(
    @CurrentUser('pharmacyId') pharmacyId: string | null,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    return this.pharmacy.updateInventoryItem(resolvedId, id, dto);
  }

  @Delete('inventory/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an inventory item' })
  async deleteInventory(
    @CurrentUser('pharmacyId') pharmacyId: string | null,
    @Param('id') id: string,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(pharmacyId);
    return this.pharmacy.deleteInventoryItem(resolvedId, id);
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
