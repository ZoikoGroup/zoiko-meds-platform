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
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ListUsersQuery } from './dto/list-users.query';
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
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide counts & health for the admin console' })
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  @ApiOperation({ summary: 'List / search / filter users (paginated)' })
  listUsers(@Query() query: ListUsersQuery) {
    return this.admin.listUsers(query);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a user with any role' })
  createUser(@CurrentUser('id') actorId: string, @Body() dto: CreateUserDto) {
    return this.admin.createUser(actorId, dto);
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
  ) {
    return this.admin.updateUser(actorId, id, dto);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Change a user’s role' })
  setRole(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.admin.setRole(actorId, id, dto.role);
  }

  @Post('users/:id/password')
  @ApiOperation({ summary: 'Reset a user’s password' })
  resetPassword(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.admin.resetPassword(actorId, id, dto.password);
  }

  @Post('users/:id/activate')
  @ApiOperation({ summary: 'Reactivate a user' })
  activate(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.admin.setActive(actorId, id, true);
  }

  @Post('users/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate (suspend) a user' })
  deactivate(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.admin.setActive(actorId, id, false);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Permanently delete a user' })
  deleteUser(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.admin.deleteUser(actorId, id);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Read the platform audit trail (paginated)' })
  auditLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.admin.listAuditLogs(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 50,
    );
  }
}
