import { UserRole } from '@prisma/client';
import { roleSatisfies, roleLabel } from './roles';

describe('roleSatisfies', () => {
  it('lets SUPER_ADMIN satisfy any requirement', () => {
    for (const required of Object.values(UserRole)) {
      expect(roleSatisfies(UserRole.SUPER_ADMIN, required)).toBe(true);
    }
  });

  it('passes when the role matches exactly', () => {
    expect(roleSatisfies(UserRole.PHARMACY_ADMIN, UserRole.PHARMACY_ADMIN)).toBe(true);
  });

  it('does not let a non-elevated role satisfy a different requirement', () => {
    expect(roleSatisfies(UserRole.PUBLIC, UserRole.PHARMACY_ADMIN)).toBe(false);
    expect(roleSatisfies(UserRole.PHARMACY_STAFF, UserRole.ADMIN)).toBe(false);
    // A patient must never satisfy pharmacy access — the core of the fixed IDOR.
    expect(roleSatisfies(UserRole.PUBLIC, UserRole.PHARMACY_STAFF)).toBe(false);
  });

  it('does not treat plain ADMIN as a global override', () => {
    expect(roleSatisfies(UserRole.ADMIN, UserRole.SUPER_ADMIN)).toBe(false);
  });
});

describe('roleLabel', () => {
  it('returns a human label for known roles', () => {
    expect(roleLabel(UserRole.PUBLIC)).toBe('Patient');
    expect(roleLabel(UserRole.SUPER_ADMIN)).toBe('Super Admin');
  });
});
