import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';
import { roleSatisfies } from '../roles';

/**
 * Enforces @Roles(...) metadata. Must run after JwtAuthGuard so req.user is set.
 * SUPER_ADMIN satisfies any requirement; otherwise the user's role must be
 * among those listed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const allowed = required.some((role) => roleSatisfies(user.role, role));
    if (!allowed) {
      throw new ForbiddenException(
        'Your role does not have access to this resource',
      );
    }
    return true;
  }
}
