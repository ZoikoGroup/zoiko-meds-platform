import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(required: UserRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows the route when no roles are required', () => {
    const guard = guardRequiring(undefined);
    expect(guard.canActivate(contextWithUser({ role: UserRole.PUBLIC }))).toBe(true);
  });

  it('allows a user whose role is in the required set', () => {
    const guard = guardRequiring([UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.PHARMACY_STAFF }))).toBe(true);
  });

  it('allows SUPER_ADMIN regardless of the required set', () => {
    const guard = guardRequiring([UserRole.PHARMACY_ADMIN]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.SUPER_ADMIN }))).toBe(true);
  });

  it('rejects a PUBLIC user from a pharmacy-only route (the fixed IDOR)', () => {
    const guard = guardRequiring([UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_STAFF]);
    expect(() => guard.canActivate(contextWithUser({ role: UserRole.PUBLIC }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when there is no authenticated user', () => {
    const guard = guardRequiring([UserRole.PHARMACY_ADMIN]);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(ForbiddenException);
  });
});
