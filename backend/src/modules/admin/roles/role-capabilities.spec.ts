import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RoleCapabilitiesService } from './role-capabilities.service';

/**
 * MSA-41 follow-up — the roles matrix was a hand-written table in a frontend
 * fixture. A matrix is what an operator reads to answer "can a pharmacist see
 * this?", and a hand-written one answers from whenever it was last edited.
 *
 * These use throwaway controllers rather than the real ones, so the test says
 * what the derivation does rather than restating today's route table.
 */

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
class AdminOnlyController {
  @Get('overview') overview() {}
  @Get('users') users() {}
  /** Not a route: no HTTP verb metadata. */
  helper() {}
}

@Controller('pharmacies')
@UseGuards(JwtAuthGuard, RolesGuard)
class PharmacyController {
  @Get('me')
  @Roles(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF)
  profile() {}

  @Post('integration/key')
  @Roles(UserRole.PHARMACY_ADMIN)
  issueKey() {}
}

/** No guards at all: reachable without an account. */
@Controller('medibase')
class PublicController {
  @Get('search') search() {}
}

/** Guarded, but with no role requirement: anyone signed in. */
@Controller('me')
@UseGuards(JwtAuthGuard)
class AnySignedInController {
  @Get('saved') saved() {}
}

@Controller('health')
class HealthController {
  @Get() check() {}
}

/**
 * Two controllers sharing the "admin" namespace but not its guard — the
 * MSA-47 scenario. Grouping by the first path segment alone merged these,
 * so a broadcast list any signed-in role can reach made the matrix claim
 * every role could reach AdminOnlyController's SUPER_ADMIN-only routes too.
 */
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
class BroadcastNotificationsController {
  @Get() list() {}
}

@Controller('medibase/admin/medicines')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
class MedibaseAdminMedicinesController {
  @Get() list() {}
}

@Controller('medibase/admin/catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
class MedibaseAdminCatalogController {
  @Get('overview') overview() {}
}

function serviceFor(controllers: Function[]) {
  const discovery = {
    getControllers: () =>
      controllers.map((metatype) => ({
        metatype,
        instance: Object.create(metatype.prototype),
      })),
  } as unknown as DiscoveryService;
  return new RoleCapabilitiesService(discovery, new MetadataScanner(), new Reflector());
}

describe('RoleCapabilitiesService', () => {
  const find = (matrix: ReturnType<RoleCapabilitiesService['matrix']>, id: string) =>
    matrix.capabilities.find((c) => c.id === id);

  it('lists every role, in privilege order', () => {
    const { roles } = serviceFor([AdminOnlyController]).matrix();

    expect(roles.map((r) => r.id)).toEqual([
      'PUBLIC',
      'PHARMACY_STAFF',
      'PHARMACY_ADMIN',
      'ENTERPRISE',
      'GOVERNMENT',
      'ADMIN',
      'SUPER_ADMIN',
    ]);
    expect(roles.find((r) => r.id === 'PUBLIC')?.label).toBe('Patient');
  });

  it('reads a class-level requirement', () => {
    const admin = find(serviceFor([AdminOnlyController]).matrix(), 'admin');

    // SUPER_ADMIN only — and notably not ADMIN, which is a real distinction in
    // this platform that a hand-written matrix would be easy to get wrong.
    expect(admin?.roles).toEqual(['SUPER_ADMIN']);
    expect(admin?.routes).toBe(2);
  });

  it('lets a handler-level requirement win over the class', () => {
    const pharmacies = find(serviceFor([PharmacyController]).matrix(), 'pharmacies');

    // SUPER_ADMIN is included because roleSatisfies grants it everything.
    expect(pharmacies?.roles).toEqual(['PHARMACY_STAFF', 'PHARMACY_ADMIN', 'SUPER_ADMIN']);
  });

  it('treats a guarded route with no role requirement as any signed-in role', () => {
    const me = find(serviceFor([AnySignedInController]).matrix(), 'me');

    expect(me?.roles).toHaveLength(7);
    expect(me?.hasPublicRoutes).toBe(false);
  });

  // "Every role can reach this" and "this needs no account at all" look
  // identical in a matrix of ticks.
  it('distinguishes a route that needs no account', () => {
    const medibase = find(serviceFor([PublicController]).matrix(), 'medibase');

    expect(medibase?.hasPublicRoutes).toBe(true);
    expect(medibase?.roles).toHaveLength(7);
  });

  it('ignores methods that are not routes', () => {
    // helper() has no HTTP verb metadata and must not be counted.
    expect(find(serviceFor([AdminOnlyController]).matrix(), 'admin')?.routes).toBe(2);
  });

  it('leaves out plumbing nobody grants access to', () => {
    const matrix = serviceFor([HealthController, AdminOnlyController]).matrix();

    expect(find(matrix, 'health')).toBeUndefined();
    expect(find(matrix, 'admin')).toBeDefined();
  });

  it('gives each capability a readable label', () => {
    const matrix = serviceFor([AdminOnlyController, PublicController]).matrix();

    expect(find(matrix, 'admin')?.label).toBe('Platform administration');
    expect(find(matrix, 'medibase')?.label).toBe('MediBase catalogue');
  });

  it('sorts capabilities so the matrix does not reorder between reads', () => {
    const matrix = serviceFor([PharmacyController, AdminOnlyController, PublicController]).matrix();

    const labels = matrix.capabilities.map((c) => c.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  // MSA-47: two controllers sharing a namespace but not a guard were merged
  // into one row, so a broadcast list any signed-in role can reach made the
  // matrix claim every role could reach a SUPER_ADMIN-only controller too.
  it('keeps controllers under a shared namespace as separate rows when their guards differ', () => {
    const matrix = serviceFor([AdminOnlyController, BroadcastNotificationsController]).matrix();

    const admin = find(matrix, 'admin');
    const notifications = find(matrix, 'admin/notifications');

    expect(admin?.roles).toEqual(['SUPER_ADMIN']);
    expect(admin?.routes).toBe(2);
    // Any signed-in role — but not PUBLIC's unauthenticated cousin: the route
    // still requires a JWT, just no specific role.
    expect(notifications?.roles).toHaveLength(7);
    expect(notifications?.hasPublicRoutes).toBe(false);
  });

  it('merges an aliased prefix into the capability it is the same as', () => {
    const matrix = serviceFor([
      MedibaseAdminMedicinesController,
      MedibaseAdminCatalogController,
    ]).matrix();

    const admin = find(matrix, 'medibase/admin/medicines');

    expect(find(matrix, 'medibase/admin/catalog')).toBeUndefined();
    expect(admin?.routes).toBe(2);
    expect(admin?.roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(admin?.label).toBe('MediBase administration');
  });
});
