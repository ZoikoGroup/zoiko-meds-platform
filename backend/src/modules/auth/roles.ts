import { UserRole } from '@prisma/client';

/**
 * Privilege ranking for the ZoikoMeds role model. Higher rank = more privilege.
 * SUPER_ADMIN sits atop the hierarchy and satisfies every role requirement.
 *
 * Note: the mid-tier roles (pharmacy / enterprise) model distinct domains, so
 * access checks use explicit role membership (see `roleSatisfies`) rather than
 * a purely linear comparison — only SUPER_ADMIN is treated as a global override.
 */
export const ROLE_RANK: Record<UserRole, number> = {
  PUBLIC: 0,
  PHARMACY_STAFF: 1,
  PHARMACY_ADMIN: 2,
  ENTERPRISE: 3,
  GOVERNMENT: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
};

/** Roles that bypass per-endpoint role requirements entirely. */
export const ELEVATED_ROLES: UserRole[] = [UserRole.SUPER_ADMIN];

/** Human-readable labels — kept in sync with the frontend ROLE_LABELS map. */
export const ROLE_LABELS: Record<UserRole, string> = {
  PUBLIC: 'Patient',
  PHARMACY_STAFF: 'Pharmacist',
  PHARMACY_ADMIN: 'Pharmacy Manager',
  ENTERPRISE: 'Enterprise User',
  GOVERNMENT: 'Government User',
  ADMIN: 'Administrator',
  SUPER_ADMIN: 'Super Admin',
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * True if a user holding `actual` may access something requiring `required`.
 * SUPER_ADMIN always passes; otherwise the role must match exactly.
 */
export function roleSatisfies(actual: UserRole, required: UserRole): boolean {
  if (ELEVATED_ROLES.includes(actual)) return true;
  return actual === required;
}
