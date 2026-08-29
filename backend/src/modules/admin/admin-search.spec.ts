import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from './audit.writer';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { AdminService } from './admin.service';

/**
 * MSA-31 — the console search bar advertised "pages, actions, and
 * intelligence" but only ever matched the static nav labels: a real pharmacy,
 * user, or medicine name always came back "No results found." globalSearch is
 * the "intelligence" half the palette now calls.
 */
describe('AdminService.globalSearch', () => {
  let prisma: {
    user: { findMany: jest.Mock };
    pharmacy: { findMany: jest.Mock };
    medicineEntity: { findMany: jest.Mock };
  };
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      pharmacy: { findMany: jest.fn().mockResolvedValue([]) },
      medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AdminService(
      prisma as unknown as PrismaService,
      { write: jest.fn() } as unknown as AuditWriter,
      {} as unknown as AuthService,
      {} as unknown as MailService,
    );
  });

  it('returns nothing for a query too short to be useful, without hitting the database', async () => {
    const result = await service.globalSearch('a');

    expect(result).toEqual({ users: [], pharmacies: [], medicines: [] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.pharmacy.findMany).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.findMany).not.toHaveBeenCalled();
  });

  it('treats a blank or whitespace-only query the same as too short', async () => {
    const result = await service.globalSearch('   ');
    expect(result).toEqual({ users: [], pharmacies: [], medicines: [] });
  });

  it('matches a pharmacy by name, case-insensitively', async () => {
    prisma.pharmacy.findMany.mockResolvedValue([
      { id: 'ph_1', name: 'Balaji Hospital Pharmacy', city: 'Hyderabad', country: 'India' },
    ]);

    const result = await service.globalSearch('balaji');

    expect(prisma.pharmacy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'balaji', mode: 'insensitive' } },
            { licenseNumber: { contains: 'balaji', mode: 'insensitive' } },
          ],
        },
        take: 5,
      }),
    );
    expect(result.pharmacies).toEqual([
      { id: 'ph_1', label: 'Balaji Hospital Pharmacy', sublabel: 'Hyderabad, India' },
    ]);
  });

  it('matches a medicine by canonical name and excludes suppressed identities', async () => {
    prisma.medicineEntity.findMany.mockResolvedValue([
      { id: 'med_1', canonicalName: 'Paracetamol', genericName: 'Paracetamol', strength: '650 mg' },
    ]);

    const result = await service.globalSearch('paracetamol');

    expect(prisma.medicineEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isSuppressed: false }) }),
    );
    expect(result.medicines).toEqual([
      { id: 'med_1', label: 'Paracetamol', sublabel: 'Paracetamol · 650 mg' },
    ]);
  });

  it('matches a user by full name or email', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'user_1', fullName: 'Asha Rao', email: 'owner@apollo.in', role: 'PHARMACY_ADMIN' },
    ]);

    const result = await service.globalSearch('asha');

    expect(result.users).toEqual([
      { id: 'user_1', label: 'Asha Rao', sublabel: 'owner@apollo.in', role: 'PHARMACY_ADMIN' },
    ]);
  });
});
