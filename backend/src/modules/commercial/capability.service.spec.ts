import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BillingCapability, UserRole } from '@prisma/client';

import { AuditWriter } from '../admin/audit.writer';
import { CapabilityService, PLATFORM_SCOPE } from './capability.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Capability grants (S-22) — the authority behind the Billing capabilities
 * dialog in Users & Roles.
 *
 * This is the whole delegation surface for financial authority, so it is worth
 * asserting directly rather than only through the routes that call it: who may
 * delegate, who may never receive, and which grants demand an explicit
 * separation-of-duties override.
 */

interface FakeGrant {
  id: string;
  userId: string;
  capability: BillingCapability;
  billingProfileId: string | null;
  scopeKey: string;
  grantedById: string | null;
  reason: string | null;
  revokedAt: Date | null;
}

function makeHarness(users: Record<string, UserRole>) {
  const grants: FakeGrant[] = [];
  let seq = 0;

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const role = users[where.id];
        return role ? { id: where.id, role, email: `${where.id}@example.test` } : null;
      }),
    },
    capabilityGrant: {
      findMany: jest.fn(
        async ({ where }: { where: { userId: string; revokedAt: null } }) =>
          grants.filter((g) => g.userId === where.userId && g.revokedAt === null),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          grants.find((g) => g.id === where.id) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_capability_scopeKey: Record<string, string> };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = where.userId_capability_scopeKey;
          const existing = grants.find(
            (g) =>
              g.userId === key.userId &&
              g.capability === key.capability &&
              g.scopeKey === key.scopeKey,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created: FakeGrant = {
            id: `grant_${++seq}`,
            revokedAt: null,
            ...(create as unknown as Omit<FakeGrant, 'id' | 'revokedAt'>),
          };
          grants.push(created);
          return created;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const existing = grants.find((g) => g.id === where.id)!;
          Object.assign(existing, data);
          return existing;
        },
      ),
    },
  };

  const audit = { write: jest.fn() };
  const service = new CapabilityService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
  );

  return { service, prisma, audit, grants };
}

const OWNER = 'usr_owner';
const MANAGER = 'usr_manager';

const baseUsers = {
  [OWNER]: UserRole.SUPER_ADMIN,
  [MANAGER]: UserRole.PHARMACY_ADMIN,
};

describe('CapabilityService.effectiveCapabilities', () => {
  it('gives the platform owner every capability without a single grant row', async () => {
    const h = makeHarness(baseUsers);

    const caps = await h.service.effectiveCapabilities(OWNER);

    expect(caps).toEqual(expect.arrayContaining(Object.values(BillingCapability)));
    expect(h.prisma.capabilityGrant.findMany).not.toHaveBeenCalled();
  });

  it('reports a pharmacy manager holding only its role default', async () => {
    // What the dialog renders as "From role" against View plan & usage, with
    // everything else "Not held".
    const h = makeHarness(baseUsers);

    expect(await h.service.effectiveCapabilities(MANAGER)).toEqual([
      BillingCapability.VIEW_PLAN_AND_USAGE,
    ]);
  });

  it('unions role defaults with active grants, without duplicating either', async () => {
    const h = makeHarness(baseUsers);
    await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
    });
    // Re-granting what the role already carries must not produce a duplicate.
    await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_PLAN_AND_USAGE,
    });

    const caps = await h.service.effectiveCapabilities(MANAGER);

    expect(caps.sort()).toEqual(
      [BillingCapability.VIEW_INVOICES, BillingCapability.VIEW_PLAN_AND_USAGE].sort(),
    );
  });

  it('refuses to answer for a user that does not exist', async () => {
    const h = makeHarness(baseUsers);
    await expect(h.service.effectiveCapabilities('usr_ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CapabilityService.grant', () => {
  it('records the grant, its issuer and its reason', async () => {
    const h = makeHarness(baseUsers);

    const grant = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
      reason: 'Finance lead for the India launch',
    });

    expect(grant).toMatchObject({
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
      grantedById: OWNER,
      reason: 'Finance lead for the India launch',
      // Unscoped grants key off the literal, not NULL, so the unique index holds.
      scopeKey: PLATFORM_SCOPE,
      billingProfileId: null,
    });
    expect(h.audit.write).toHaveBeenCalledWith(
      OWNER,
      'commercial.capability.grant',
      'CapabilityGrant',
      grant.id,
      expect.objectContaining({
        targetUserId: MANAGER,
        targetRole: UserRole.PHARMACY_ADMIN,
        capability: BillingCapability.VIEW_INVOICES,
      }),
    );
  });

  it('refuses an actor who does not hold GRANT_CAPABILITIES', async () => {
    // A pharmacy manager cannot hand out billing authority, whatever the route
    // guard allowed through.
    const h = makeHarness(baseUsers);

    await expect(
      h.service.grant(MANAGER, {
        userId: MANAGER,
        capability: BillingCapability.VIEW_INVOICES,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.grants).toHaveLength(0);
  });

  it('lets a delegate grant on, once given GRANT_CAPABILITIES', async () => {
    // The point of delegation: SUPER_ADMIN is not the only account that can
    // ever issue a capability.
    const h = makeHarness(baseUsers);
    await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.GRANT_CAPABILITIES,
    });

    await expect(
      h.service.grant(MANAGER, {
        userId: MANAGER,
        capability: BillingCapability.VIEW_INVOICES,
      }),
    ).resolves.toMatchObject({ capability: BillingCapability.VIEW_INVOICES });
  });

  it('never lets a patient account hold billing authority', async () => {
    const h = makeHarness({ ...baseUsers, usr_patient: UserRole.PUBLIC });

    await expect(
      h.service.grant(OWNER, {
        userId: 'usr_patient',
        capability: BillingCapability.VIEW_INVOICES,
      }),
    ).rejects.toThrow(/Patient accounts cannot hold billing capabilities/);
  });

  it('refuses financial authority to an operational role without acknowledgement', async () => {
    const h = makeHarness(baseUsers);

    await expect(
      h.service.grant(OWNER, {
        userId: MANAGER,
        capability: BillingCapability.APPROVE_REFUND_OR_CREDIT,
      }),
    ).rejects.toThrow(/breaks separation of duties/);
    expect(h.grants).toHaveLength(0);
  });

  it('allows it when the conflict is acknowledged, and records the override', async () => {
    // What the dialog sends for the three capabilities it marks as financial.
    const h = makeHarness(baseUsers);

    const grant = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.APPROVE_REFUND_OR_CREDIT,
      acknowledgeSeparationOfDutiesConflict: true,
    });

    expect(grant.capability).toBe(BillingCapability.APPROVE_REFUND_OR_CREDIT);
    expect(h.audit.write).toHaveBeenCalledWith(
      OWNER,
      'commercial.capability.grant',
      'CapabilityGrant',
      grant.id,
      expect.objectContaining({ separationOfDutiesOverridden: true }),
    );
  });

  it('reinstates a previously revoked capability rather than stacking a second row', async () => {
    const h = makeHarness(baseUsers);
    const first = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
    });
    await h.service.revoke(OWNER, first.id, 'left the finance team');

    const again = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
    });

    expect(again.id).toBe(first.id);
    expect(again.revokedAt).toBeNull();
    expect(h.grants).toHaveLength(1);
    expect(await h.service.can(MANAGER, BillingCapability.VIEW_INVOICES)).toBe(true);
  });
});

describe('CapabilityService.revoke', () => {
  it('withdraws the capability but keeps the row for audit', async () => {
    const h = makeHarness(baseUsers);
    const grant = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
    });

    const revoked = await h.service.revoke(OWNER, grant.id, 'no longer required');

    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(h.grants).toHaveLength(1);
    expect(await h.service.can(MANAGER, BillingCapability.VIEW_INVOICES)).toBe(false);
    // The role default survives a revocation of something else entirely.
    expect(await h.service.can(MANAGER, BillingCapability.VIEW_PLAN_AND_USAGE)).toBe(true);
    expect(h.audit.write).toHaveBeenCalledWith(
      OWNER,
      'commercial.capability.revoke',
      'CapabilityGrant',
      grant.id,
      expect.objectContaining({ targetUserId: MANAGER }),
    );
  });

  it('refuses an actor who does not hold GRANT_CAPABILITIES', async () => {
    const h = makeHarness(baseUsers);
    const grant = await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
    });

    await expect(h.service.revoke(MANAGER, grant.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grant.revokedAt).toBeNull();
  });

  it('reports an unknown grant rather than silently succeeding', async () => {
    const h = makeHarness(baseUsers);
    await expect(h.service.revoke(OWNER, 'grant_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CapabilityService.require', () => {
  it('names the missing capability so the UI can say what is needed', async () => {
    const h = makeHarness(baseUsers);

    await expect(
      h.service.require(MANAGER, BillingCapability.MANAGE_PRICE_CATALOG),
    ).rejects.toThrow(/requires the MANAGE_PRICE_CATALOG billing capability/);
  });

  it('treats a scoped grant as authority only within its own organization', async () => {
    const h = makeHarness(baseUsers);
    await h.service.grant(OWNER, {
      userId: MANAGER,
      capability: BillingCapability.VIEW_INVOICES,
      billingProfileId: 'bp_1',
    });

    expect(
      await h.service.can(MANAGER, BillingCapability.VIEW_INVOICES, {
        billingProfileId: 'bp_1',
      }),
    ).toBe(true);
    expect(
      await h.service.can(MANAGER, BillingCapability.VIEW_INVOICES, {
        billingProfileId: 'bp_2',
      }),
    ).toBe(false);
  });

  it('answers false for an unknown user instead of throwing', async () => {
    const h = makeHarness(baseUsers);
    expect(await h.service.can('usr_ghost', BillingCapability.VIEW_INVOICES)).toBe(false);
  });
});
