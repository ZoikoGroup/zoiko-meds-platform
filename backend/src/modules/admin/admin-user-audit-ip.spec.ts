import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from './audit.writer';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { AdminService } from './admin.service';
import { UserRole } from '@prisma/client';

/**
 * MSA-38 — the Audit Logs page showed a blank/wrong IP address for every
 * Users & Roles action (create, update, role change, password reset,
 * activate/deactivate, delete). The route handlers never captured @Ip(), and
 * AdminService's private `audit()` helper never forwarded one to
 * AuditWriter.write even when it had one — every row from this whole feature
 * was written with no ipAddress at all.
 */
describe('AdminService — audit IP capture for user management', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };
  let audit: { write: jest.Mock };
  let service: AdminService;

  // ADMIN, not a pharmacy role: PHARMACY_ADMIN/PHARMACY_STAFF trigger a
  // verification-request side effect this spec isn't testing and doesn't mock.
  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'member@zoikomeds.test',
    fullName: 'Member',
    role: UserRole.ADMIN,
    isActive: true,
    pharmacyId: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user()),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(user(data))),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(user(data))),
        delete: jest.fn().mockResolvedValue(user()),
        count: jest.fn().mockResolvedValue(2), // more than one active super admin
      },
    };
    audit = { write: jest.fn() };
    service = new AdminService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
      { sendInviteFor: jest.fn() } as unknown as AuthService,
      { sendAccountCredentials: jest.fn() } as unknown as MailService,
    );
  });

  it('forwards the caller IP when changing a role', async () => {
    await service.setRole('actor1', 'u1', UserRole.ENTERPRISE, '203.0.113.7');

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.role',
      'User',
      'u1',
      { from: UserRole.ADMIN, to: UserRole.ENTERPRISE },
      '203.0.113.7',
    );
  });

  it('forwards the caller IP when creating a user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null); // no email clash
    await service.createUser(
      'actor1',
      { email: 'new@zoikomeds.test', fullName: 'New', role: UserRole.ADMIN, password: 'x' } as any,
      '198.51.100.4',
    );

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.create',
      'User',
      'u1',
      expect.objectContaining({ email: 'new@zoikomeds.test' }),
      '198.51.100.4',
    );
  });

  it('forwards the caller IP when updating a user', async () => {
    await service.updateUser('actor1', 'u1', { fullName: 'Renamed' } as any, '198.51.100.9');

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.update',
      'User',
      'u1',
      expect.objectContaining({ changed: expect.arrayContaining(['fullName']) }),
      '198.51.100.9',
    );
  });

  it('forwards the caller IP when resetting a password, without logging the password', async () => {
    await service.resetPassword('actor1', 'u1', 'NewPassword123!', '198.51.100.11');

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.password_reset',
      'User',
      'u1',
      undefined,
      '198.51.100.11',
    );
  });

  it('forwards the caller IP when activating/deactivating a user', async () => {
    await service.setActive('actor1', 'u1', false, '198.51.100.20');

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.deactivate',
      'User',
      'u1',
      expect.objectContaining({ isActive: false }),
      '198.51.100.20',
    );
  });

  it('forwards the caller IP when deleting a user', async () => {
    await service.deleteUser('actor1', 'u1', '198.51.100.30');

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.delete',
      'User',
      'u1',
      expect.objectContaining({ email: 'member@zoikomeds.test' }),
      '198.51.100.30',
    );
  });

  it('still writes an entry when no IP is available, rather than throwing', async () => {
    await service.setRole('actor1', 'u1', UserRole.ENTERPRISE);

    expect(audit.write).toHaveBeenCalledWith(
      'actor1',
      'admin.user.role',
      'User',
      'u1',
      { from: UserRole.ADMIN, to: UserRole.ENTERPRISE },
      undefined,
    );
  });
});
