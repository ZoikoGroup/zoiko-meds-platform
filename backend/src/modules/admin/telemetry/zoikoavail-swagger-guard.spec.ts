import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { GatewayTelemetryController } from './gateway-telemetry.controller';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

/**
 * The explorer's specification route is guarded, not merely unadvertised.
 *
 * The console renders Swagger UI from this route because the backend's own
 * /api/docs is withheld in production — the full API surface, admin and auth
 * routes included, is not something to publish. That reasoning only holds if
 * the replacement is actually protected: a SUPER_ADMIN-only page fetching an
 * open endpoint would move the exposure rather than remove it.
 *
 * Guards are declared at class level, so these assert the metadata the runtime
 * reads rather than trusting that a new route inherited it.
 */

const reflector = new Reflector();

const guards = () =>
  (Reflect.getMetadata('__guards__', GatewayTelemetryController) ?? []) as unknown[];

const roles = () =>
  reflector.get<UserRole[]>('roles', GatewayTelemetryController) ??
  (Reflect.getMetadata('roles', GatewayTelemetryController) as UserRole[] | undefined);

describe('the OpenAPI routes are SUPER_ADMIN only', () => {
  it('requires a valid JWT', () => {
    // Unauthenticated callers are refused by this guard — a 401 — before any
    // role is considered.
    expect(guards()).toContain(JwtAuthGuard);
  });

  it('requires a role check', () => {
    // Authenticated but wrong role is refused here — a 403.
    expect(guards()).toContain(RolesGuard);
  });

  it('names SUPER_ADMIN as the only allowed role', () => {
    expect(roles()).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('covers every route on the controller, the spec included', () => {
    // Class-level guards, so a route added later cannot be born unguarded.
    const routes = Object.getOwnPropertyNames(GatewayTelemetryController.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(routes).toEqual(expect.arrayContaining(['contract', 'specification']));
    expect(guards()).toHaveLength(2);
  });
});
