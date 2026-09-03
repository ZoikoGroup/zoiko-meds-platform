import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeService } from './me.service';

/**
 * The per-medicine alerts switch surviving the round trip.
 *
 * Reported as "the toggle does nothing", so the write path is worth pinning
 * separately from the notification gate: a value that never reaches the row
 * and a value nothing reads look identical from the Saved Medicines page, and
 * they have different fixes.
 */

const USER = 'user_1';

function buildService(rowsUpdated = 1) {
  const prisma: any = {
    savedMedicine: {
      updateMany: jest.fn().mockResolvedValue({ count: rowsUpdated }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new MeService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('turning alerts off for one medicine', () => {
  it('writes false to that row', async () => {
    const { service, prisma } = buildService();

    await service.updateSavedMedicineAlerts(USER, 'med_1', false);

    const [args] = prisma.savedMedicine.updateMany.mock.calls[0];
    expect(args.data).toEqual({ alertsEnabled: false });
  });

  it('writes true when it is turned back on', async () => {
    const { service, prisma } = buildService();

    await service.updateSavedMedicineAlerts(USER, 'med_1', true);

    expect(prisma.savedMedicine.updateMany.mock.calls[0][0].data).toEqual({
      alertsEnabled: true,
    });
  });

  it('reports what was stored, so the page is not guessing', async () => {
    const { service } = buildService();

    await expect(service.updateSavedMedicineAlerts(USER, 'med_1', false)).resolves.toEqual({
      success: true,
      medicineId: 'med_1',
      alertsEnabled: false,
    });
  });
});

describe('the write is scoped to the patient and the medicine', () => {
  it('cannot touch another patient’s saved list', async () => {
    const { service, prisma } = buildService();

    await service.updateSavedMedicineAlerts(USER, 'med_1', false);

    expect(prisma.savedMedicine.updateMany.mock.calls[0][0].where.userId).toBe(USER);
  });

  it('matches by catalog id or by the name an off-catalog save was made under', async () => {
    const { service, prisma } = buildService();

    await service.updateSavedMedicineAlerts(USER, 'Dolo 650', false);

    const { where } = prisma.savedMedicine.updateMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { medicineId: 'Dolo 650' },
      { normalizedName: expect.any(String) },
    ]);
  });

  it('changes exactly one medicine, leaving the rest of the list alone', async () => {
    const { service, prisma } = buildService();

    await service.updateSavedMedicineAlerts(USER, 'med_1', false);

    // No blanket update: the only rows in scope are this patient's, for this
    // medicine. One switch cannot mute a saved list.
    expect(prisma.savedMedicine.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.savedMedicine.updateMany.mock.calls[0][0].where).toMatchObject({
      userId: USER,
    });
  });

  it('refuses when the patient has not saved that medicine', async () => {
    // Reporting success for a preference that was never stored is how a control
    // comes to look like it works when it does not.
    const { service } = buildService(0);

    await expect(service.updateSavedMedicineAlerts(USER, 'med_1', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
