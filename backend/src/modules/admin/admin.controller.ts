import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { DashboardOverviewService } from './dashboard-overview.service';
import { OrganizationService } from './organization/organization.service';
import { UpdateOrganizationDto } from './organization/update-organization.dto';
import { SecurityPostureService } from './security/security-posture.service';
import { UpdateSecurityPolicyDto } from './security/update-security-policy.dto';
import { RoleCapabilitiesService } from './roles/role-capabilities.service';
import { PlatformApiKeyService } from './api-keys/platform-api-key.service';
import { CreateApiKeyDto } from './api-keys/create-api-key.dto';
import { HelpResourcesService } from './help/help-resources.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Platform administration. Every route requires a valid JWT AND the
 * SUPER_ADMIN role (enforced at the class level).
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly dashboard: DashboardOverviewService,
    private readonly organization: OrganizationService,
    private readonly security: SecurityPostureService,
    private readonly roleCapabilities: RoleCapabilitiesService,
    private readonly apiKeys: PlatformApiKeyService,
    private readonly help: HelpResourcesService,
  ) {}

  // --- Workspace settings --------------------------------------------------

  @Get('organization')
  @ApiOperation({
    summary: "This workspace's own profile",
    description:
      'What the settings page shows. Seeded by migration, so a fresh deployment answers with its real defaults rather than an invented organization.',
  })
  getOrganization() {
    return this.organization.get();
  }

  @Patch('organization')
  @ApiOperation({
    summary: 'Save the workspace profile',
    description:
      'Every field is optional so the form can save one without blanking the rest. The slug is not writable: it is the stable external handle, and renaming the workspace must not change what it is.',
  })
  updateOrganization(
    @CurrentUser('id') actorId: string,
    @Ip() ipAddress: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organization.update(actorId, dto, ipAddress);
  }

  @Get('security')
  @ApiOperation({
    summary: 'Authentication controls, as they actually stand',
    description:
      'The stored policy, the controls derived from it, and how ready the workspace is for two-factor enforcement. Controls the console cannot decide report where they are configured instead — a stored flag that nothing enforces is worse than no flag (MSA-42).',
  })
  getSecurityPosture(@CurrentUser('id') actorId: string) {
    return this.security.posture(actorId);
  }

  @Patch('security')
  @ApiOperation({
    summary: 'Set the workspace security policy',
    description:
      'Only the controls this page can actually decide. Requiring two-factor authentication is refused unless the administrator asking for it has enrolled an authenticator of their own — otherwise the policy locks out the only account that could lift it (MSA-42).',
  })
  updateSecurityPosture(
    @CurrentUser('id') actorId: string,
    @Ip() ipAddress: string,
    @Body() dto: UpdateSecurityPolicyDto,
  ) {
    return this.security.update(actorId, dto, ipAddress);
  }

  @Get('help')
  @ApiOperation({
    summary: 'Help resources this deployment actually publishes',
    description:
      'The API reference is mounted only outside production, so on a live deployment there is nothing to link to and the console is told so rather than offering a link to a 404.',
  })
  getHelpResources() {
    return this.help.get();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide counts & health for the admin console' })
  overview() {
    return this.admin.overview();
  }

  @Get('search')
  @ApiOperation({
    summary: 'Cross-entity quick search (users, pharmacies, medicines) for the console search bar',
  })
  search(@Query('q') q: string) {
    return this.admin.globalSearch(q);
  }

  @Get('dashboard/overview')
  @ApiOperation({
    summary: 'Super Admin dashboard rollup (KPIs, confidence, freshness, shortage)',
  })
  dashboardOverview() {
    return this.dashboard.overview();
  }

  @Get('users')
  @ApiOperation({ summary: 'List / search / filter users (paginated)' })
  listUsers(@Query() query: ListUsersQuery) {
    return this.admin.listUsers(query);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a user with any role' })
  createUser(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateUserDto,
    @Ip() ipAddress: string,
  ) {
    return this.admin.createUser(actorId, dto, ipAddress);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user' })
  getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user profile / role / status' })
  updateUser(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Ip() ipAddress: string,
  ) {
    return this.admin.updateUser(actorId, id, dto, ipAddress);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Change a user’s role' })
  setRole(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Ip() ipAddress: string,
  ) {
    return this.admin.setRole(actorId, id, dto.role, ipAddress);
  }

  @Post('users/:id/password')
  @ApiOperation({ summary: 'Reset a user’s password' })
  resetPassword(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @Ip() ipAddress: string,
  ) {
    return this.admin.resetPassword(actorId, id, dto.password, ipAddress);
  }

  @Post('users/:id/activate')
  @ApiOperation({ summary: 'Reactivate a user' })
  activate(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Ip() ipAddress: string,
  ) {
    return this.admin.setActive(actorId, id, true, ipAddress);
  }

  @Post('users/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate (suspend) a user' })
  deactivate(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Ip() ipAddress: string,
  ) {
    return this.admin.setActive(actorId, id, false, ipAddress);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Permanently delete a user' })
  deleteUser(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Ip() ipAddress: string,
  ) {
    return this.admin.deleteUser(actorId, id, ipAddress);
  }

  @Get('roles')
  @ApiOperation({
    summary: 'Which roles can reach which parts of the platform',
    description:
      'Derived from the @Roles metadata RolesGuard enforces, by walking the controllers. A hand-written matrix answers from whenever it was last edited; this cannot disagree with what the routes do.',
  })
  getRoleMatrix() {
    return this.roleCapabilities.matrix();
  }

  // --- ZoikoAvail API keys -------------------------------------------------
  //
  // There is no "reveal" here and there cannot be: only the hash is stored, so a
  // key exists in the open exactly once, in the response to the POST below.

  @Get('api-keys')
  @ApiOperation({ summary: 'List issued keys, live ones first' })
  listApiKeys() {
    return this.apiKeys.list();
  }

  @Post('api-keys')
  @ApiOperation({
    summary: 'Issue a key',
    description: 'The key is returned in full exactly once. Only its hash is stored.',
  })
  createApiKey(
    @CurrentUser('id') actorId: string,
    @Ip() ipAddress: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(actorId, dto.label, dto.scope, ipAddress);
  }

  @Delete('api-keys/:id')
  @ApiOperation({
    summary: 'Revoke a key',
    description:
      'Stops it working immediately. The row stays, because a revoked key still has to be nameable in the audit trail and its hash must stay claimed.',
  })
  revokeApiKey(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Ip() ipAddress: string,
  ) {
    return this.apiKeys.revoke(actorId, id, ipAddress);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Read the platform audit trail (paginated & filtered)' })
  auditLogs(@Query() query: ListAuditLogsQuery) {
    return this.admin.listAuditLogs(query);
  }
}
