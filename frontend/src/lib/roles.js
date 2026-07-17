// Role vocabulary shared with the backend Prisma `UserRole` enum.
// SUPER_ADMIN sits atop the hierarchy and is treated as a global override.

export const ROLES = {
  PUBLIC: 'PUBLIC',
  PHARMACY_STAFF: 'PHARMACY_STAFF',
  PHARMACY_ADMIN: 'PHARMACY_ADMIN',
  ENTERPRISE: 'ENTERPRISE',
  GOVERNMENT: 'GOVERNMENT',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
}

// Backend enum → human label used across the admin UI.
export const ROLE_LABELS = {
  PUBLIC: 'Patient',
  PHARMACY_STAFF: 'Pharmacist',
  PHARMACY_ADMIN: 'Pharmacy Manager',
  ENTERPRISE: 'Enterprise User',
  GOVERNMENT: 'Government User',
  ADMIN: 'Administrator',
  SUPER_ADMIN: 'Super Admin',
}

// Badge variant per role (matches components/ui/badge variants).
export const ROLE_BADGE = {
  PUBLIC: 'outline',
  PHARMACY_STAFF: 'secondary',
  PHARMACY_ADMIN: 'info',
  ENTERPRISE: 'warning',
  GOVERNMENT: 'success',
  ADMIN: 'teal',
  SUPER_ADMIN: 'default',
}

// Ordered options for role <select> dropdowns.
export const ROLE_OPTIONS = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.PHARMACY_ADMIN,
  ROLES.PHARMACY_STAFF,
  ROLES.ENTERPRISE,
  ROLES.GOVERNMENT,
  ROLES.PUBLIC,
].map((value) => ({ value, label: ROLE_LABELS[value] }))

const LABEL_TO_ROLE = Object.fromEntries(
  Object.entries(ROLE_LABELS).map(([role, label]) => [label, role])
)

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role ?? 'Unknown'
}

/** Convert a display label back to the backend enum (best-effort). */
export function roleFromLabel(label) {
  return LABEL_TO_ROLE[label] ?? label
}

export function isSuperAdmin(role) {
  return role === ROLES.SUPER_ADMIN
}

/** True for pharmacy staff/manager roles (the Pharmacy Portal audience). */
export function isPharmacy(role) {
  return role === ROLES.PHARMACY_ADMIN || role === ROLES.PHARMACY_STAFF
}

/** The landing path for a role's portal — used for post-login + guard redirects. */
export function portalHome(role) {
  if (role === ROLES.SUPER_ADMIN) return '/admin'
  if (isPharmacy(role)) return '/pharmacy'
  return '/dashboard'
}

/**
 * True if `role` may access something restricted to `allowed`.
 * SUPER_ADMIN always passes; otherwise the role must be listed.
 */
export function hasRole(role, allowed = []) {
  if (role === ROLES.SUPER_ADMIN) return true
  return allowed.includes(role)
}
