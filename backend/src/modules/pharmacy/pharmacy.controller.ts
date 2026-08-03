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
import { UserRole } from '@prisma/client';
import { PharmacyService } from './pharmacy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { ImportInventoryDto } from './dto/import-inventory.dto';

@ApiTags('pharmacy')
@Controller('pharmacies')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  // --- Authenticated inventory & dashboard routes (MUST be declared before :id) ---------
  //
  // Every route below is scoped to the caller's own pharmacy. Access is limited
  // to pharmacy staff/managers (SUPER_ADMIN bypasses via RolesGuard), and the
  // target pharmacy is always the one linked to the JWT — never a guessed
  // fallback — so one pharmacy can never read or mutate another's inventory.

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile details for the logged-in pharmacy' })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.getProfile(resolvedId, user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update profile details for the logged-in pharmacy' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body() body: any,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.updateProfile(resolvedId, body, user, ipAddress);
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get notifications for the logged-in pharmacy user' })
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pharmacy.getUserNotifications(user.id);
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get dashboard summary for the logged-in pharmacy' })
  async getDashboard(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.getDashboard(resolvedId);
  }

  @Get('reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reports and analytics for the logged-in pharmacy' })
  async getReports(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.getReports(resolvedId);
  }

  @Get('inventory')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List inventory for the logged-in pharmacy' })
  async getInventory(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.getInventory(resolvedId);
  }

  @Post('inventory/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk import medicines from CSV rows or text into pharmacy inventory' })
  async importCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body() body: ImportInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    let input: string | Record<string, string>[] = '';
    if (body.csvText) {
      input = body.csvText;
    } else if (Array.isArray(body.rows) && body.rows.length > 0) {
      input = body.rows;
    } else {
      throw new BadRequestException('Please provide valid CSV rows or text to import.');
    }
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    return this.pharmacy.importCsv(resolvedId, input, mode, user, ipAddress);
  }

  @Post('inventory')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a medicine to the pharmacy inventory' })
  async addInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body() dto: AddInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.addInventoryItem(resolvedId, dto, user, ipAddress);
  }

  @Patch('inventory/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update availability of an inventory item' })
  async updateInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.updateInventoryItem(resolvedId, id, dto, user, ipAddress);
  }

  @Delete('inventory/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an inventory item' })
  async deleteInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Param('id') id: string,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
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
