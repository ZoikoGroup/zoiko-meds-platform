import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { roleLabel } from '../auth/roles';
import { AuditWriter } from './audit.writer';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQuery } from './dto/list-users.query';

const SALT_ROUNDS = 12;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Platform administration for SUPER_ADMIN. Full user lifecycle management plus
 * a platform overview and audit trail. Every mutation writes an AuditLog entry,
 * and guardrails prevent an admin from locking themselves out or removing the
 * last remaining super admin.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriter,
    private readonly auth: AuthService,
    private readonly mail: MailService,
  ) {}

  // --- Overview ------------------------------------------------------------

  async overview() {
    const [
      usersByRole,
      totalUsers,
      activeUsers,
      pharmaciesByStatus,
      totalPharmacies,
      verifiedPharmacies,
      pendingPharmacies,
      medicineCount,
      pendingVerifications,
      inquiriesByStatus,
      notificationCount,
      auditCount,
    ] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.pharmacy.groupBy({
        by: ['verificationStatus'],
        _count: { _all: true },
      }),
      this.prisma.pharmacy.count(),
      this.prisma.pharmacy.count({ where: { verificationStatus: 'VERIFIED' } }),
      this.prisma.pharmacy.count({ where: { verificationStatus: 'PENDING' } }),
      this.prisma.medicineEntity.count(),
      this.prisma.verificationRequest.count({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'ESCALATED'] } },
      }),
      this.prisma.enterpriseInquiry.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.notification.count(),
      this.prisma.auditLog.count(),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        byRole: this.tally(usersByRole, 'role'),
      },
      pharmacies: {
        total: totalPharmacies,
        verified: verifiedPharmacies,
        pending: pendingPharmacies,
        byStatus: this.tally(pharmaciesByStatus, 'verificationStatus'),
      },
      medicines: { total: medicineCount },
      verifications: { pending: pendingVerifications },
      inquiries: {
        total: inquiriesByStatus.reduce((n, r) => n + r._count._all, 0),
        byStatus: this.tally(inquiriesByStatus, 'status'),
      },
      notifications: { total: notificationCount },
      auditLogEntries: auditCount,
    };
  }

  // --- User management -----------------------------------------------------

  async listUsers(query: ListUsersQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.status) where.isActive = query.status === 'active';
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => this.toPublicUser(u)),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.toPublicUser(user);
  }

  async createUser(actorId: string, dto: CreateUserDto) {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    if (dto.pharmacyId) await this.assertPharmacyExists(dto.pharmacyId);

    // Two provisioning modes:
    //  - invite: no password now; user sets one via an emailed link.
    //  - credentials: admin supplies a temporary password, emailed to the user.
    const useInvite = dto.sendInvite === true || !dto.password;
    const passwordHash = useInvite
      ? null
      : await bcrypt.hash(dto.password as string, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: dto.fullName,
        phone: dto.phone || null,
        passwordHash,
        role: dto.role,
        pharmacyId: dto.pharmacyId || null,
        isActive: dto.isActive ?? true,
        mustChangePassword: !useInvite, // temp password must be rotated
      },
    });

    // Best-effort delivery — never fail account creation on a mail hiccup.
    if (useInvite) {
      await this.auth.sendInviteFor(user);
    } else {
      await this.mail.sendAccountCredentials({
        to: user.email,
        fullName: user.fullName,
        temporaryPassword: dto.password as string,
        roleLabel: roleLabel(user.role),
      });
    }

    await this.audit(actorId, 'admin.user.create', user.id, {
      email: user.email,
      role: user.role,
      provisioned: useInvite ? 'invite' : 'credentials',
    });
    return { ...this.toPublicUser(user), invited: useInvite };
  }

  async updateUser(actorId: string, id: string, dto: UpdateUserDto) {
    const target = await this.requireUser(id);
    const data: Prisma.UserUpdateInput = {};

    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone || null;

    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      if (email !== target.email) {
        const clash = await this.prisma.user.findUnique({ where: { email } });
        if (clash) throw new ConflictException('Email already in use');
      }
      data.email = email;
    }

    if (dto.role !== undefined && dto.role !== target.role) {
      // Demoting a super admin must not drop the last one.
      if (target.role === UserRole.SUPER_ADMIN) {
        await this.assertNotLastSuperAdmin(target);
      }
      data.role = dto.role;
    }

    if (dto.isActive !== undefined && dto.isActive !== target.isActive) {
      if (!dto.isActive) this.assertNotSelf(actorId, id, 'deactivate');
      if (!dto.isActive && target.role === UserRole.SUPER_ADMIN) {
        await this.assertNotLastSuperAdmin(target);
      }
      data.isActive = dto.isActive;
    }

    if (dto.pharmacyId !== undefined) {
      if (dto.pharmacyId) await this.assertPharmacyExists(dto.pharmacyId);
      data.pharmacy = dto.pharmacyId
        ? { connect: { id: dto.pharmacyId } }
        : { disconnect: true };
    }

    const user = await this.prisma.user.update({ where: { id }, data });
    await this.audit(actorId, 'admin.user.update', id, {
      changed: Object.keys(data),
    });
    return this.toPublicUser(user);
  }

  async setRole(actorId: string, id: string, role: UserRole) {
    const target = await this.requireUser(id);
    if (target.role === role) return this.toPublicUser(target);
    if (target.role === UserRole.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(target);
    }
    const user = await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit(actorId, 'admin.user.role', id, {
      from: target.role,
      to: role,
    });
    return this.toPublicUser(user);
  }

  async resetPassword(actorId: string, id: string, password: string) {
    await this.requireUser(id);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    // NEVER log the password itself.
    await this.audit(actorId, 'admin.user.password_reset', id);
    return { id, message: 'Password has been reset' };
  }

  async setActive(actorId: string, id: string, isActive: boolean) {
    const target = await this.requireUser(id);
    if (!isActive) {
      this.assertNotSelf(actorId, id, 'deactivate');
      if (target.role === UserRole.SUPER_ADMIN) {
        await this.assertNotLastSuperAdmin(target);
      }
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
    });
    await this.audit(
      actorId,
      isActive ? 'admin.user.activate' : 'admin.user.deactivate',
      id,
      { email: user.email, isActive },
    );
    return this.toPublicUser(user);
  }

  async deleteUser(actorId: string, id: string) {
    const target = await this.requireUser(id);
    this.assertNotSelf(actorId, id, 'delete');
    if (target.role === UserRole.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(target);
    }
    await this.prisma.user.delete({ where: { id } });
    await this.audit(actorId, 'admin.user.delete', id, {
      email: target.email,
      role: target.role,
    });
    return { id, deleted: true };
  }

  // --- Audit trail ---------------------------------------------------------

  async listAuditLogs(page = 1, pageSize = 50) {
    const size = Math.min(Math.max(pageSize, 1), 200);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.auditLog.count(),
    ]);
    // Shape for the admin console: timestamp / action / actor / module / severity / ip / details / summary.
    const items = rows.map((r) => {
      const meta = r.metadata as Record<string, any> | null;
      return {
        id: r.id,
        timestamp: r.createdAt,
        action: r.action,
        actor: r.actorEmail || r.actorId || 'system',
        module: r.entityType || 'System',
        severity: r.severity,
        ip: r.ipAddress || '—',
        details: meta ? JSON.stringify(meta) : '',
        summary: this.formatAuditSummary(r.action, r.entityType, meta),
      };
    });
    return {
      items,
      total,
      page,
      pageSize: size,
      pageCount: Math.max(1, Math.ceil(total / size)),
    };
  }

  private formatAuditSummary(
    action: string,
    entityType: string | null,
    metadata: Record<string, any> | null,
  ): string {
    const meta = metadata || {};

    if (meta.to && meta.from) {
      return `Role changed from ${meta.from} → ${meta.to}`;
    }
    if (meta.to) {
      return `Role updated to ${meta.to}`;
    }
    if (meta.status && Array.isArray(meta.ids)) {
      const count = meta.ids.length;
      return `Bulk action on ${count} ${count === 1 ? 'item' : 'items'} (Status: ${meta.status})`;
    }
    if (meta.pharmacy && meta.status) {
      return `${meta.pharmacy} — Status set to ${meta.status}`;
    }
    if (meta.name && meta.status) {
      return `${meta.name} — Status set to ${meta.status}`;
    }
    if (meta.name) {
      return `${meta.name} (${entityType || 'Entity'})`;
    }
    if (meta.email && meta.role) {
      return `Created user ${meta.email} (${meta.role})`;
    }
    if (meta.email && meta.isActive !== undefined) {
      return `${meta.email} — Account ${meta.isActive ? 'activated' : 'deactivated'}`;
    }
    if (meta.email) {
      return `Target email: ${meta.email}`;
    }

    const actionMap: Record<string, string> = {
      'admin.pharmacy.verified': 'Pharmacy verified',
      'admin.pharmacy.suspended': 'Pharmacy suspended',
      'admin.user.activate': 'User account activated',
      'admin.user.deactivate': 'User account deactivated',
      'admin.seed': 'System data initialized',
      'auth.login': 'User logged in',
    };

    if (actionMap[action]) {
      return actionMap[action];
    }

    const keys = Object.keys(meta);
    if (keys.length === 0) {
      const formattedAction = action
        .replace(/^admin\./, '')
        .replace(/\./g, ' ')
        .replace(/_/g, ' ');
      return `${formattedAction.charAt(0).toUpperCase() + formattedAction.slice(1)} (${entityType || 'System'})`;
    }

    return keys
      .map((k) => {
        const val = meta[k];
        if (Array.isArray(val)) return `${k}: ${val.length} items`;
        return `${k}: ${val}`;
      })
      .join(' · ');
  }

  // --- helpers -------------------------------------------------------------

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private assertNotSelf(actorId: string, targetId: string, action: string) {
    if (actorId === targetId) {
      throw new ForbiddenException(`You cannot ${action} your own account`);
    }
  }

  /** Throws unless at least one OTHER active super admin remains. */
  private async assertNotLastSuperAdmin(target: User) {
    const others = await this.prisma.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        isActive: true,
        id: { not: target.id },
      },
    });
    if (others === 0) {
      throw new BadRequestException(
        'This is the last active super admin — assign another before changing this account',
      );
    }
  }

  private async assertPharmacyExists(pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
    });
    if (!pharmacy) throw new BadRequestException('Pharmacy not found');
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.auditWriter.write(actorId, action, 'User', entityId, metadata);
  }

  private tally<T extends Record<string, unknown>>(
    groups: Array<T & { _count: { _all: number } }>,
    key: keyof T,
  ): Record<string, number> {
    return groups.reduce<Record<string, number>>((acc, g) => {
      acc[String(g[key])] = g._count._all;
      return acc;
    }, {});
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      pharmacyId: user.pharmacyId,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
