import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { PharmacyAdminService } from './pharmacy-admin.service';

/**
 * MSA-32 — the Pharmacy Management location filter was built from each
 * pharmacy's raw `country` text ("India" / "india" / "IN" all describe the
 * same place here), so the dropdown listed the same country more than once
 * and picking one only matched pharmacies spelled exactly that way. The DTO
 * now also carries the canonical Jurisdiction a pharmacy's country already
 * resolves to on save, so the frontend can group and filter by that instead.
 */
describe('PharmacyAdminService — jurisdiction on the pharmacy DTO', () => {
  function buildService(rows: any[]) {
    const prisma: any = {
      pharmacy: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(rows.length),
      },
    };
    const service = new PharmacyAdminService(
      prisma as unknown as PrismaService,
      { write: jest.fn() } as unknown as AuditWriter,
      {} as unknown as NearbyPharmacyService,
    );
    return { service, prisma };
  }

  it('requests the jurisdiction relation alongside the raw country text', async () => {
    const { service, prisma } = buildService([]);

    await service.list({});

    expect(prisma.pharmacy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { jurisdiction: { select: { code: true, name: true } } },
      }),
    );
  });

  it('maps the jurisdiction onto each pharmacy in the list', async () => {
    const { service } = buildService([
      {
        id: 'ph_1',
        name: 'Balaji Hospital Pharmacy',
        country: 'india',
        jurisdiction: { code: 'IN', name: 'India' },
        reliabilityScore: 0.8,
      },
      {
        id: 'ph_2',
        name: 'Not Yet Located',
        country: null,
        jurisdiction: null,
        reliabilityScore: 0,
      },
    ]);

    const { items } = await service.list({});

    expect(items[0]).toMatchObject({ country: 'india', jurisdiction: { code: 'IN', name: 'India' } });
    expect(items[1]).toMatchObject({ country: null, jurisdiction: null });
  });
});
