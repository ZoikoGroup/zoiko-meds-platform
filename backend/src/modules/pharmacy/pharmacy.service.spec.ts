import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { PharmacyService } from './pharmacy.service';

describe('PharmacyService.resolvePharmacyId', () => {
  let service: PharmacyService;
  let prisma: { pharmacy: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { pharmacy: { findFirst: jest.fn() } };
    service = new PharmacyService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditWriter,
    );
  });

  it('returns the user pharmacy id when the account is linked to one', async () => {
    await expect(service.resolvePharmacyId('pharma_123')).resolves.toBe('pharma_123');
  });

  it('throws Forbidden when the account has no linked pharmacy (no fallback)', async () => {
    await expect(service.resolvePharmacyId(null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never queries for a fallback pharmacy when the link is missing', async () => {
    await expect(service.resolvePharmacyId(null)).rejects.toBeInstanceOf(ForbiddenException);
    // The old "first pharmacy in the DB" fallback is gone — no DB lookup at all.
    expect(prisma.pharmacy.findFirst).not.toHaveBeenCalled();
  });
});
