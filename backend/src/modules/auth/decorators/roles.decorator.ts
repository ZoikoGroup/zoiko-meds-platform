import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restrict a controller or handler to the listed roles (SUPER_ADMIN always allowed). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
