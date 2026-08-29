import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole, VerificationRequestStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { roleLabel } from '../auth/roles';
import { AuditWriter } from './audit.writer';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';

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

  /**
   * Cross-entity quick search for the console's command palette (MSA-31). The
   * palette advertised "pages, actions, and intelligence" but only ever
   * matched the static nav labels — a real pharmacy, user, or medicine name
   * always came back "No results found," regardless of how correctly it was
   * typed. This is the "intelligence" half: a few of each match, each with
   * enough on it for the palette to link straight to the record.
   */
  async globalSearch(q: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) return { users: [], pharmacies: [], medicines: [] };

    const [users, pharmacies, medicines] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, fullName: true, email: true, role: true },
        take: 5,
      }),
      this.prisma.pharmacy.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { licenseNumber: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, city: true, country: true },
        take: 5,
      }),
      this.prisma.medicineEntity.findMany({
        where: {
          isSuppressed: false,
          OR: [
            { canonicalName: { contains: query, mode: 'insensitive' } },
            { genericName: { contains: query, mode: 'insensitive' } },
            { brandNames: { has: query } },
          ],
        },
        select: { id: true, canonicalName: true, genericName: true, strength: true },
        take: 5,
      }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        label: u.fullName,
        sublabel: u.email,
        role: u.role,
      })),
      pharmacies: pharmacies.map((p) => ({
        id: p.id,
        label: p.name,
        sublabel: [p.city, p.country].filter(Boolean).join(', '),
      })),
      medicines: medicines.map((m) => ({
        id: m.id,
        label: m.canonicalName,
        sublabel: [m.genericName, m.strength].filter(Boolean).join(' · '),
      })),
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

    if (
      (user.role === UserRole.PHARMACY_ADMIN || user.role === UserRole.PHARMACY_STAFF) &&
      !user.pharmacyId
    ) {
      await this.ensurePharmacyVerificationRequest(user.id, actorId);
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
    if (
      (user.role === UserRole.PHARMACY_ADMIN || user.role === UserRole.PHARMACY_STAFF) &&
      !user.pharmacyId
    ) {
      await this.ensurePharmacyVerificationRequest(user.id, actorId);
    }
    await this.audit(actorId, 'admin.user.update', id, {
      changed: Object.keys(data),
    });
    return this.toPublicUser(user);
  }

  async setRole(actorId: string, id: string, role: UserRole) {
    const target = await this.requireUser(id);
    if (target.role === role) {
      if (
        (role === UserRole.PHARMACY_ADMIN || role === UserRole.PHARMACY_STAFF) &&
        !target.pharmacyId
      ) {
        await this.ensurePharmacyVerificationRequest(target.id, actorId);
      }
      return this.toPublicUser(target);
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(target);
    }

    const data: Prisma.UserUpdateInput = { role };
    if (role !== UserRole.PHARMACY_ADMIN && role !== UserRole.PHARMACY_STAFF) {
      data.pharmacy = { disconnect: true };
    }

    const user = await this.prisma.user.update({ where: { id }, data });

    if (
      (user.role === UserRole.PHARMACY_ADMIN || user.role === UserRole.PHARMACY_STAFF) &&
      !user.pharmacyId
    ) {
      await this.ensurePharmacyVerificationRequest(user.id, actorId);
    }

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

  async listAuditLogs(query: ListAuditLogsQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const size = Math.min(Math.max(pageSize, 1), 200);

    const conditions: Prisma.AuditLogWhereInput[] = [];

    if (query.module && query.module !== 'All') {
      conditions.push({
        OR: [
          { entityType: { equals: query.module, mode: 'insensitive' } },
          { metadata: { path: ['module'], equals: query.module } },
        ],
      });
    }

    if (query.severity) {
      conditions.push({ severity: query.severity });
    }

    if (query.action && query.action !== 'All') {
      conditions.push({ action: { contains: query.action, mode: 'insensitive' } });
    }

    if (query.user) {
      conditions.push({
        OR: [
          { actorEmail: { contains: query.user, mode: 'insensitive' } },
          { actorId: { contains: query.user, mode: 'insensitive' } },
          { metadata: { path: ['userName'], string_contains: query.user } },
          { metadata: { path: ['userEmail'], string_contains: query.user } },
        ],
      });
    }

    if (query.pharmacy) {
      conditions.push({
        OR: [
          { metadata: { path: ['pharmacyName'], string_contains: query.pharmacy } },
          { metadata: { path: ['pharmacyId'], string_contains: query.pharmacy } },
        ],
      });
    }

    if (query.search) {
      const term = query.search.trim();
      if (term) {
        conditions.push({
          OR: [
            { action: { contains: term, mode: 'insensitive' } },
            { actorEmail: { contains: term, mode: 'insensitive' } },
            { entityType: { contains: term, mode: 'insensitive' } },
            { metadata: { path: ['medicineName'], string_contains: term } },
            { metadata: { path: ['pharmacyName'], string_contains: term } },
            { metadata: { path: ['userName'], string_contains: term } },
          ],
        });
      }
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      conditions.push({ createdAt: dateFilter });
    }

    const where: Prisma.AuditLogWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Shape for the admin console: timestamp / action / actor / module / severity / ip / details / summary.
    const items = rows.map((r) => {
      const meta = r.metadata as Record<string, any> | null;
      return {
        id: r.id,
        timestamp: r.createdAt,
        action: r.action,
        actor: r.actorEmail || r.actorId || 'system',
        module: r.entityType || meta?.module || 'System',
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

    if (action === 'auth.login') {
      const email = meta.userEmail || meta.attemptedEmail || 'user';
      const role = meta.userRole ? ` (${meta.userRole})` : '';
      return `User ${email}${role} logged in successfully`;
    }
    if (action === 'auth.login_failed') {
      const email = meta.userEmail || meta.attemptedEmail || 'unknown';
      const reason = meta.reason ? ` (${meta.reason})` : '';
      return `Failed login attempt for ${email}${reason}`;
    }
    if (action === 'auth.logout') {
      const email = meta.userEmail || 'user';
      return `User ${email} logged out`;
    }
    if (action === 'auth.register') {
      const email = meta.userEmail || 'user';
      return `New user account registered for ${email}`;
    }
    if (action === 'auth.change_password') {
      const email = meta.userEmail || 'user';
      return `User ${email} changed account password`;
    }
    if (action === 'auth.forgot_password') {
      const email = meta.userEmail || meta.email || 'user';
      return `Password reset link requested for ${email}`;
    }
    if (action === 'auth.reset_password') {
      const email = meta.userEmail || meta.email || 'user';
      return `Password reset completed for ${email}`;
    }

    if (action === 'pharmacy.inventory.create') {
      return `Added medicine '${meta.medicineName || 'item'}' to inventory (${meta.pharmacyName || 'Pharmacy'})`;
    }
    if (action === 'pharmacy.inventory.update') {
      const prevStr = meta.previousValues?.status ? ` [was: ${meta.previousValues.status}]` : '';
      const newStr = meta.newValues?.status || meta.status || '';
      return `Updated '${meta.medicineName || 'inventory item'}' status to ${newStr}${prevStr}`;
    }
    if (action === 'pharmacy.inventory.delete') {
      return `Deleted medicine '${meta.medicineName || 'item'}' from inventory (${meta.pharmacyName || 'Pharmacy'})`;
    }
    if (action === 'pharmacy.inventory.import') {
      return `Imported inventory CSV (${meta.imported ?? 0} added, ${meta.updated ?? 0} updated)`;
    }

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
        .replace(/^(admin|pharmacy)\./, '')
        .replace(/\./g, ' ')
        .replace(/_/g, ' ');
      return `${formattedAction.charAt(0).toUpperCase() + formattedAction.slice(1)} (${entityType || 'System'})`;
    }

    return keys
      .map((k) => {
        const val = meta[k];
        if (Array.isArray(val)) return `${k}: ${val.length} items`;
        if (typeof val === 'object' && val !== null) return `${k}: ${JSON.stringify(val)}`;
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

  private async ensurePharmacyVerificationRequest(userId: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.pharmacyId) return;

    const userEmail = user.email.toLowerCase();

    const existing = await this.prisma.verificationRequest.findFirst({
      where: { submittedBy: { contains: userEmail, mode: 'insensitive' } },
    });

    if (existing) {
      if (existing.status !== VerificationRequestStatus.PENDING) {
        await this.prisma.verificationRequest.update({
          where: { id: existing.id },
          data: {
            status: VerificationRequestStatus.PENDING,
            notes: existing.notes
              ? `${existing.notes}\n[${new Date().toISOString()}]: Role set to ${roleLabel(user.role)}. Status reset to PENDING.`
              : `Role set to ${roleLabel(user.role)}. Status reset to PENDING.`,
          },
        });
      }
    } else {
      // Placeholder row so reviewers can see the account is waiting to onboard.
      // The licence is left blank rather than synthesised as "LIC-<user id>": a
      // made-up value renders in the Verification Center exactly like a licence
      // the pharmacy supplied, and it can never match the real one, which used
      // to leave a second row behind once the operator submitted for real.
      // PharmacyService.saveMyProfile adopts this row by submitter and fills in
      // the true name and licence.
      const pharmacyName = `${user.fullName} Pharmacy (awaiting details)`;
      const req = await this.prisma.verificationRequest.create({
        data: {
          pharmacyName,
          licenseNumber: '',
          submittedBy: `${user.fullName} (${user.email})`,
          status: VerificationRequestStatus.PENDING,
          notes: `Account given the ${roleLabel(user.role)} role. Awaiting the pharmacy's own details from the pharmacy portal profile.`,
        },
      });

      if (actorId) {
        await this.auditWriter.write(
          actorId,
          'admin.verification.auto_create',
          'VerificationRequest',
          req.id,
          { pharmacy: pharmacyName, userEmail: user.email },
        );
      }
    }
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
