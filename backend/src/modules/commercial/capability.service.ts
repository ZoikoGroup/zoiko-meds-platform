import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCapability, CapabilityGrant, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import {
  defaultCapabilitiesFor,
  hasCapability,
  isSuperAdmin,
  violatesSeparationOfDuties,
} from './commercial.doctrine';

/** Scope value standing in for "not scoped to one organization". */
export const PLATFORM_SCOPE = 'PLATFORM';

/**
 * Billing capability grants (ZM-COM-BILL-001 S-22).
 *
 * SUPER_ADMIN is the platform owner: it holds every capability implicitly and is
 * the only role that can grant capabilities to others. Everyone else starts from
 * their role's least-privilege defaults and receives authority explicitly, with
 * the issuer and reason recorded, so financial authority is always traceable to a
 * person rather than inherited from a role someone happened to hold.
 */
@Injectable()
export class CapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /** Active grants for a user. Revoked grants are kept for audit, not returned. */
  async activeGrants(userId: string): Promise<CapabilityGrant[]> {
    return this.prisma.capabilityGrant.findMany({
      where: { userId, revokedAt: null },
    });
  }

  /**
   * Effective capabilities: role defaults plus active grants. For SUPER_ADMIN this
   * is every capability, without needing a single grant row.
   */
  async effectiveCapabilities(userId: string): Promise<BillingCapability[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (isSuperAdmin(user.role)) return Object.values(BillingCapability);

    const grants = await this.activeGrants(userId);
    const set = new Set<BillingCapability>(defaultCapabilitiesFor(user.role));
    for (const g of grants) set.add(g.capability);
    return [...set];
  }

  /** Whether a user holds a capability, optionally scoped to one organization. */
  async can(
    userId: string,
    capability: BillingCapability,
    scope?: { billingProfileId?: string | null },
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return false;
    if (isSuperAdmin(user.role)) return true;

    const grants = await this.activeGrants(userId);
    return hasCapability({ role: user.role }, capability, grants, scope);
  }

  /** Throw unless the user holds the capability. */
  async require(
    userId: string,
    capability: BillingCapability,
    scope?: { billingProfileId?: string | null },
  ): Promise<void> {
    if (!(await this.can(userId, capability, scope))) {
      throw new ForbiddenException(
        `This action requires the ${capability} billing capability.`,
      );
    }
  }

  /**
   * Grant a capability. Only an actor holding GRANT_CAPABILITIES may do this,
   * which in practice means SUPER_ADMIN or someone a SUPER_ADMIN delegated it to.
   *
   * A grant that would put financial authority in the hands of an operational role
   * is flagged as a separation-of-duties conflict and requires an explicit
   * acknowledgement — the platform owner can still do it, but not by accident.
   */
  async grant(
    actorId: string,
    input: {
      userId: string;
      capability: BillingCapability;
      billingProfileId?: string | null;
      reason?: string;
      acknowledgeSeparationOfDutiesConflict?: boolean;
    },
  ): Promise<CapabilityGrant> {
    await this.require(actorId, BillingCapability.GRANT_CAPABILITIES);

    const target = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true, email: true },
    });
    if (!target) throw new NotFoundException('Target user not found');

    // A patient account must never acquire billing authority: billing identity is
    // organizational, and patients have no billing profile at all (S-A5).
    if (target.role === UserRole.PUBLIC) {
      throw new ForbiddenException(
        'Patient accounts cannot hold billing capabilities. Billing identity is the legal organization.',
      );
    }

    if (
      violatesSeparationOfDuties(target.role, [input.capability]) &&
      !input.acknowledgeSeparationOfDutiesConflict
    ) {
      throw new ForbiddenException(
        `Granting ${input.capability} to ${target.role} breaks separation of duties: whoever can approve a ` +
          'pharmacy or edit availability should not also hold financial authority. Re-submit with ' +
          'acknowledgeSeparationOfDutiesConflict to override deliberately.',
      );
    }

    // "PLATFORM" stands in for an unscoped grant so the unique index actually
    // holds — a NULL here would not collide in Postgres.
    const scopeKey = input.billingProfileId ?? PLATFORM_SCOPE;

    const grant = await this.prisma.capabilityGrant.upsert({
      where: {
        userId_capability_scopeKey: {
          userId: input.userId,
          capability: input.capability,
          scopeKey,
        },
      },
      create: {
        userId: input.userId,
        capability: input.capability,
        billingProfileId: input.billingProfileId ?? null,
        scopeKey,
        grantedById: actorId,
        reason: input.reason ?? null,
      },
      // Re-granting a previously revoked capability clears the revocation.
      update: { revokedAt: null, grantedById: actorId, reason: input.reason ?? null },
    });

    await this.audit.write(actorId, 'commercial.capability.grant', 'CapabilityGrant', grant.id, {
      targetUserId: input.userId,
      targetRole: target.role,
      capability: input.capability,
      billingProfileId: input.billingProfileId ?? null,
      separationOfDutiesOverridden: !!input.acknowledgeSeparationOfDutiesConflict,
      reason: input.reason ?? null,
    });

    return grant;
  }

  /** Revoke a grant. Kept as a row with revokedAt so the history survives. */
  async revoke(actorId: string, grantId: string, reason?: string): Promise<CapabilityGrant> {
    await this.require(actorId, BillingCapability.GRANT_CAPABILITIES);

    const existing = await this.prisma.capabilityGrant.findUnique({ where: { id: grantId } });
    if (!existing) throw new NotFoundException('Capability grant not found');

    const revoked = await this.prisma.capabilityGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), reason: reason ?? existing.reason },
    });

    await this.audit.write(actorId, 'commercial.capability.revoke', 'CapabilityGrant', grantId, {
      targetUserId: existing.userId,
      capability: existing.capability,
      reason: reason ?? null,
    });

    return revoked;
  }
}
