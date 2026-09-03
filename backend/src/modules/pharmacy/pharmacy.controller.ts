import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { PharmacyService } from './pharmacy.service';
import {
  MAX_LOGO_BYTES,
  PharmacyLogoService,
  UploadedLogo,
  logoUrlFor,
} from './logo/pharmacy-logo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { ImportInventoryDto } from './dto/import-inventory.dto';
import { UpdatePharmacyProfileDto } from './dto/update-profile.dto';
import { ResolveMapLinkDto } from './dto/resolve-map-link.dto';
import { SaveIntegrationDto } from './dto/save-integration.dto';
import { PushInventoryDto } from './dto/push-inventory.dto';
import { PharmacyIntegrationService } from './integration/pharmacy-integration.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { ClientIp } from '../../common/decorators/client-ip.decorator';

@ApiTags('pharmacy')
@Controller('pharmacies')
export class PharmacyController {
  constructor(
    private readonly pharmacy: PharmacyService,
    private readonly logos: PharmacyLogoService,
    private readonly integrations: PharmacyIntegrationService,
    private readonly notificationPreferences: NotificationPreferencesService,
  ) {}

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
  @ApiOperation({
    summary: 'Get profile details for the logged-in pharmacy',
    description:
      'Returns the pharmacy record managed in Pharmacy Management. An account ' +
      'with no pharmacy linked yet gets an empty draft (isDraft: true) to fill in.',
  })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pharmacy.getMyProfile(user);
  }

  @Post('me/resolve-map-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Read coordinates out of a Google Maps share link',
    description:
      'For maps.app.goo.gl short links, which carry no coordinates until the ' +
      'redirect is followed — something a browser cannot do cross-origin. ' +
      'Reads only; saving the pair is still PATCH /pharmacies/me.',
  })
  resolveMapLink(@Body() dto: ResolveMapLinkDto) {
    return this.pharmacy.resolveMapLink(dto.url);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Save the logged-in pharmacy profile and submit it for verification',
    description:
      'Creates the pharmacy record on first submit, links it to the caller, and ' +
      'files a verification request for the admin Verification Center.',
  })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
    @Body() dto: UpdatePharmacyProfileDto,
  ) {
    return this.pharmacy.saveMyProfile(user, dto, ipAddress);
  }

  @Get('me/billing')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Billing and plan view for the logged-in pharmacy',
    description:
      'Financial detail is scoped by role: amounts and invoices are omitted entirely for roles that may not see them, rather than returned and hidden client-side.',
  })
  async getMyBilling(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.getMyBilling(user);
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

  @Get('notification-preferences')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Notification switches for the logged-in pharmacy account',
    description:
      'Scoped to the caller. An account that has never changed them gets the defaults (everything on) rather than an empty body, so the settings page has a real value to render.',
  })
  async getNotificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationPreferences.get(user.id);
  }

  @Patch('notification-preferences')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change notification switches for the logged-in pharmacy account',
    description:
      'A patch: only the switches sent are changed. Returns the full saved set, so the client renders what was stored rather than what it hoped was stored.',
  })
  async updateNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationPreferences.update(user.id, dto);
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

  @Get('participation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Participation and data-quality metrics for the logged-in pharmacy',
    description:
      "Measured from this pharmacy's own signals. Percentages are null when it lists no medicines, " +
      'because a share of nothing is not zero.',
  })
  async getParticipation(@CurrentUser() user: AuthenticatedUser) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.pharmacy.getParticipation(pharmacyId);
  }

  // --- POS / ERP integration (MP-31) ---------------------------------------
  //
  // Declared above the ':id' routes, like everything else scoped to the caller's
  // own pharmacy: Nest matches in declaration order, and 'integration' would
  // otherwise be read as a pharmacy id.

  @Get('integration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Feed configuration and sync history for the logged-in pharmacy',
    description:
      'A pharmacy with no feed set up gets connected: false and an empty history. ' +
      'The feed auth credential is never included — only whether one is stored.',
  })
  async getIntegration(@CurrentUser() user: AuthenticatedUser) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.integrations.getIntegration(pharmacyId);
  }

  @Put('integration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Connect or reconfigure the pharmacy POS / ERP feed',
    description:
      'PUT rather than POST: there is one feed per pharmacy, and saving the form ' +
      'twice must produce one configuration, not two.',
  })
  async saveIntegration(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
    @Body() dto: SaveIntegrationDto,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.integrations.saveIntegration(pharmacyId, dto, user, ipAddress);
  }

  @Delete('integration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disconnect the feed',
    description:
      'Removes the configuration and its sync history. Stock already imported is ' +
      'left in place — it is the pharmacy\'s own inventory, not the feed\'s.',
  })
  async disconnectIntegration(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.integrations.disconnect(pharmacyId, user, ipAddress);
  }

  @Post('integration/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fetch the feed now, without waiting for the schedule',
    description:
      'Runs inline and answers with the refreshed integration, so the page shows ' +
      'the attempt it just triggered — including a failure and its reason.',
  })
  async syncIntegration(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.integrations.syncNow(pharmacyId, user, ipAddress);
  }

  @Post('integration/key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Issue or rotate the push API key',
    description:
      'The key is returned in full exactly once; only its hash is stored. Rotating ' +
      'invalidates the previous key immediately. Manager-only — a key is a credential ' +
      'that writes this pharmacy\'s inventory without a user session.',
  })
  async issueIntegrationKey(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    return this.integrations.issueApiKey(pharmacyId, user, ipAddress);
  }

  /**
   * Stock pushed by a pharmacy's own system. No JWT: the caller is a POS
   * server, not a person, and the API key in the header both authenticates it
   * and decides which pharmacy is being written — there is no id in the body
   * for a stolen key to aim somewhere else.
   */
  @Post('integration/push')
  @ApiOperation({
    summary: 'Push stock from a pharmacy POS / ERP',
    description:
      'Authenticated with the X-Zoiko-Api-Key header issued from the portal. Body is ' +
      '{ rows } or { csvText }, optionally with mode: merge | replace.',
  })
  async pushInventory(
    @Headers('x-zoiko-api-key') apiKey: string | undefined,
    @ClientIp() ipAddress: string,
    @Body() dto: PushInventoryDto,
  ) {
    return this.integrations.ingestPush(
      apiKey,
      dto.rows,
      dto.csvText,
      dto.mode,
      ipAddress,
    );
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
    @ClientIp() ipAddress: string,
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
    @ClientIp() ipAddress: string,
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
    @ClientIp() ipAddress: string,
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
    @ClientIp() ipAddress: string,
    @Param('id') id: string,
  ) {
    const resolvedId = await this.pharmacy.resolvePharmacyId(user?.pharmacyId ?? null, user?.id);
    return this.pharmacy.deleteInventoryItem(resolvedId, id, user, ipAddress);
  }

  // --- Logo (MP-22) --------------------------------------------------------

  @Post('me/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Upload or replace this pharmacy's logo",
    description:
      'PNG, JPEG or WebP up to 256 KB. The image type is taken from the file itself, ' +
      'not from the declared content type, and anything else is rejected.',
  })
  @UseInterceptors(
    // Held in memory, never written to disk: the file goes straight to the
    // database, and a temp file would only be one more thing to clean up. The
    // limit here is what stops an oversized upload being read at all - the
    // service checks again, because it is what guarantees what gets stored.
    FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }),
  )
  async uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedLogo | undefined,
    @ClientIp() ipAddress: string,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    const stored = await this.logos.save(pharmacyId, file, user?.id, ipAddress);
    return {
      logoUrl: logoUrlFor(pharmacyId, stored.updatedAt),
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      updatedAt: stored.updatedAt.toISOString(),
    };
  }

  @Delete('me/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove this pharmacy's logo" })
  async removeLogo(
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ipAddress: string,
  ) {
    const pharmacyId = await this.pharmacy.resolvePharmacyId(
      user?.pharmacyId ?? null,
      user?.id,
    );
    await this.logos.remove(pharmacyId, user?.id, ipAddress);
    return { logoUrl: null };
  }

  // --- Public routes (no auth required) ------------------------------------

  /**
   * Serve a logo. Public and unauthenticated by design: it is a brand mark meant
   * to be displayed beside the pharmacy, and an <img> tag cannot send a bearer
   * token. Which pharmacies patients are shown is decided by the listings, which
   * only ever include verified ones.
   */
  @Get(':id/logo')
  @ApiOperation({ summary: "Download a pharmacy's logo image" })
  async getLogo(
    @Param('id') id: string,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const logo = await this.logos.find(id);
    if (!logo) throw new NotFoundException('This pharmacy has no logo');

    // The timestamp is the whole identity of the image: replacing the logo moves
    // it, and nothing else can change the bytes.
    const etag = `W/"${logo.updatedAt.getTime()}"`;
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }

    // Set here rather than with @Header: taking @Res() puts this handler in manual
    // mode, where Nest applies none of the response decorators.
    //
    // Cached for five minutes, and usable while revalidating for a day. The URL
    // carries the logo's timestamp, so a replacement is a different URL and appears
    // at once - the cache only ever holds an image that is still current.
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.setHeader('Content-Type', logo.mimeType);
    res.setHeader('Content-Length', logo.data.length);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', logo.updatedAt.toUTCString());
    // An image is not a document; refuse to let it be interpreted as one.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(logo.data);
  }

  @Get()
  list() {
    return this.pharmacy.listVerified();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pharmacy.findById(id);
  }
}
