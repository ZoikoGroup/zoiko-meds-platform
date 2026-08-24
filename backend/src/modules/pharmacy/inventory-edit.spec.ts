import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyService } from './pharmacy.service';

/**
 * Editing an inventory item.
 *
 * The dialog previously posted only `status`, and the service only wrote
 * `confidence` — so name, generic, strength and dosage form silently never
 * persisted. These tests pin the fixed behaviour, and the boundary that makes
 * it safe: MedicineEntity is the shared MediBase catalog, so an edit re-points
 * this pharmacy's row at an identity instead of rewriting one other pharmacies
 * and patients depend on.
 */

const PHARMACY = 'ph_apollo';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'manager@zoikomeds.io',
  fullName: 'Keiko Tanaka',
  role: 'PHARMACY_ADMIN' as AuthenticatedUser['role'],
  pharmacyId: PHARMACY,
};

/** "Asthalin 100 mcg" as the catalog holds it. */
const asthalin100 = (over: Record<string, unknown> = {}) => ({
  id: 'med_asthalin_100',
  canonicalName: 'Asthalin',
  genericName: 'Salbutamol',
  strength: '100 mcg',
  dosageForm: 'Tablet',
  qualityState: 'NEEDS_REVIEW',
  ...over,
});

/** The pharmacy's inventory row pointing at it, currently out of stock. */
const signalRow = (medicine: Record<string, unknown> = asthalin100()) => ({
  id: 'sig_1',
  pharmacyId: PHARMACY,
  medicineId: medicine.id,
  confidence: 'LOW',
  medicine,
});

function buildService() {
  // The row being edited, and whether the pharmacy already lists the identity
  // an edit would re-point onto. Tests override these before calling.
  const state = {
    row: signalRow() as Record<string, any>,
    clash: null as { id: string } | null,
    catalogHit: null as Record<string, any> | null,
    created: null as Record<string, any> | null,
  };

  const prisma: any = {
    availabilitySignal: {
      // Two different lookups share this mock: `{ where: { id } }` fetches the
      // row, `{ where: { medicineId_pharmacyId } }` probes the unique index.
      findUnique: jest.fn(async ({ where }: any) =>
        where.medicineId_pharmacyId ? state.clash : state.row,
      ),
      findFirst: jest.fn().mockResolvedValue(null), // no other stockist
      update: jest.fn(),
    },
    medicineEntity: {
      findFirst: jest.fn(async () => state.catalogHit),
      create: jest.fn(async ({ data }: any) => {
        state.created = state.created ?? { id: 'med_created', ...data };
        return state.created;
      }),
      update: jest.fn(async ({ data }: any) => ({ ...state.catalogHit, ...data })),
    },
    pharmacy: { findUnique: jest.fn().mockResolvedValue({ name: 'Apollo Pharmacy' }) },
  };

  // Echo back the identity the signal ends up pointing at, as Prisma would.
  prisma.availabilitySignal.update.mockImplementation(async ({ data }: any) => {
    const resolved =
      [state.created, state.catalogHit, state.row.medicine].find(
        (m) => m && m.id === data.medicineId,
      ) ?? state.row.medicine;
    return {
      id: 'sig_1',
      medicineId: data.medicineId,
      medicine: {
        canonicalName: resolved.canonicalName,
        genericName: resolved.genericName,
        strength: resolved.strength,
        dosageForm: resolved.dosageForm,
      },
    };
  });

  const audit = { write: jest.fn() };
  const savedLink = { linkPendingSaves: jest.fn().mockResolvedValue(0) };
  const portalNotifications = {
    inventoryBecameAvailable: jest.fn(),
    inventoryBecameUnavailable: jest.fn(),
    bulkUploadCompleted: jest.fn(),
  };
  const service = new PharmacyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
    savedLink as unknown as SavedMedicineLinkService,
    portalNotifications as unknown as PharmacyNotificationService,
  );
  return { service, prisma, audit, savedLink, portalNotifications, state };
}

const edit = (service: PharmacyService, dto: Record<string, unknown>) =>
  service.updateInventoryItem(PHARMACY, 'sig_1', dto as never, USER, '10.0.0.1');

describe('editing an inventory item', () => {
  it('persists a strength change by re-pointing at the 200 mcg identity', async () => {
    const { service, prisma } = buildService();

    const result = await edit(service, {
      name: 'Asthalin',
      generic: 'Salbutamol',
      strength: '200 mcg',
      dosageForm: 'Tablet',
      status: 'out-of-stock',
    });

    // The catalog holds no 200 mcg Asthalin, so one is created...
    expect(prisma.medicineEntity.create).toHaveBeenCalledWith({
      data: {
        canonicalName: 'Asthalin',
        genericName: 'Salbutamol',
        strength: '200 mcg',
        dosageForm: 'Tablet',
      },
    });
    // ...and the row now points at it. Previously only `confidence` was written,
    // so the strength silently reverted on refresh.
    expect(prisma.availabilitySignal.update.mock.calls[0][0].data).toMatchObject({
      medicineId: 'med_created',
    });
    expect(result.strength).toBe('200 mcg');
    expect(result.status).toBe('out-of-stock');
  });

  it('leaves the 100 mcg identity alone for the pharmacies still stocking it', async () => {
    const { service, prisma } = buildService();

    await edit(service, { name: 'Asthalin', strength: '200 mcg' });

    expect(prisma.medicineEntity.update).not.toHaveBeenCalled();
  });

  it('reuses an existing identity rather than duplicating the catalog', async () => {
    const { service, prisma, state } = buildService();
    state.catalogHit = asthalin100({ id: 'med_asthalin_200', strength: '200 mcg' });

    await edit(service, { name: 'Asthalin', strength: '200 mcg' });

    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
    expect(prisma.availabilitySignal.update.mock.calls[0][0].data.medicineId).toBe(
      'med_asthalin_200',
    );
  });

  it('fixes generic and dosage form in place when this pharmacy is the sole stockist', async () => {
    const { service, prisma, state } = buildService();
    state.catalogHit = asthalin100();

    await edit(service, { generic: 'Salbutamol sulphate', dosageForm: 'Inhaler' });

    expect(prisma.medicineEntity.update).toHaveBeenCalledWith({
      where: { id: 'med_asthalin_100' },
      data: { genericName: 'Salbutamol sulphate', dosageForm: 'Inhaler' },
    });
  });

  it('refuses to change the generic of an identity another pharmacy stocks', async () => {
    const { service, prisma, state } = buildService();
    state.catalogHit = asthalin100();
    prisma.availabilitySignal.findFirst.mockResolvedValue({ id: 'sig_other' });

    await expect(edit(service, { generic: 'Something else' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.medicineEntity.update).not.toHaveBeenCalled();
    // Nothing is half-saved: the pharmacist is told, rather than the edit
    // quietly dropping the field it could not apply.
    expect(prisma.availabilitySignal.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a curated MediBase identity even when solely stocked', async () => {
    const { service, state } = buildService();
    state.catalogHit = asthalin100({ qualityState: 'VERIFIED' });

    await expect(edit(service, { dosageForm: 'Syrup' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to re-point onto a medicine already in this inventory', async () => {
    const { service, state } = buildService();
    state.catalogHit = asthalin100({ id: 'med_asthalin_200', strength: '200 mcg' });
    state.clash = { id: 'sig_existing' };

    await expect(edit(service, { name: 'Asthalin', strength: '200 mcg' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps the current status when only identity fields are edited', async () => {
    const { service, prisma, state } = buildService();
    state.catalogHit = asthalin100();

    const result = await edit(service, { name: 'Asthalin' });

    // The row was LOW (out of stock). Correcting a name must not restock it —
    // the old code defaulted a missing status to 'available'.
    expect(result.status).toBe('out-of-stock');
    expect(prisma.availabilitySignal.update.mock.calls[0][0].data.confidence).toBe('LOW');
  });

  it('still handles a status-only toggle without touching the identity', async () => {
    const { service, prisma } = buildService();

    const result = await edit(service, { status: 'available' });

    expect(prisma.medicineEntity.findFirst).not.toHaveBeenCalled();
    expect(prisma.medicineEntity.create).not.toHaveBeenCalled();
    expect(prisma.availabilitySignal.update.mock.calls[0][0].data).toMatchObject({
      medicineId: 'med_asthalin_100',
      confidence: 'HIGH',
    });
    expect(result.status).toBe('available');
  });

  it('links patients following a newly introduced medicine off-catalog', async () => {
    const { service, savedLink, state } = buildService();

    await edit(service, { name: 'Volini Gel', strength: '', status: 'available' });

    expect(savedLink.linkPendingSaves).toHaveBeenCalledWith(state.created);
    expect(state.created).toMatchObject({ canonicalName: 'Volini Gel' });
  });

  it('does not raise an availability alert when the edit reports out of stock', async () => {
    const { service, savedLink } = buildService();

    await edit(service, { name: 'Volini Gel', status: 'out-of-stock' });

    expect(savedLink.linkPendingSaves).not.toHaveBeenCalled();
  });

  it('links patients when a medicine the pharmacy already held is restocked', async () => {
    const { service, savedLink } = buildService();

    // The row starts out of stock (LOW). A status-only edit back to available is
    // the other way a saved medicine becomes available, and it used to raise
    // nothing: the link hook fired only when the edit re-pointed the row at a
    // different identity, so a patient waiting on this exact medicine heard
    // nothing when the only pharmacy stocking it flipped it back.
    await edit(service, { status: 'available' });

    expect(savedLink.linkPendingSaves).toHaveBeenCalledWith({
      id: 'med_asthalin_100',
      canonicalName: 'Asthalin',
    });
  });

  it('tells the pharmacy portal when its own row becomes available', async () => {
    const { service, portalNotifications } = buildService();

    await edit(service, { status: 'available' });

    expect(portalNotifications.inventoryBecameAvailable).toHaveBeenCalledTimes(1);
    const [pharmacyId, medicine] = portalNotifications.inventoryBecameAvailable.mock.calls[0];
    expect(pharmacyId).toBe(PHARMACY);
    expect(medicine).toMatchObject({ id: 'med_asthalin_100', canonicalName: 'Asthalin' });
  });

  it('raises nothing for an edit that leaves the row out of stock', async () => {
    const { service, portalNotifications } = buildService();

    // Correcting a descriptive field on a row nobody can buy from takes nothing
    // away from patients and gives them nothing. Reporting it would fill the
    // Inventory tab with rows saying only that someone pressed Save, burying the
    // transitions that matter.
    await edit(service, { generic: 'Salbutamol sulfate' });

    expect(portalNotifications.inventoryBecameAvailable).not.toHaveBeenCalled();
    expect(portalNotifications.inventoryBecameUnavailable).not.toHaveBeenCalled();
  });

  it('reports losing availability the pharmacy actually had', async () => {
    const { service, portalNotifications, state } = buildService();
    state.row = { ...signalRow(), confidence: 'HIGH' };

    await edit(service, { status: 'out-of-stock' });

    expect(portalNotifications.inventoryBecameUnavailable).toHaveBeenCalledTimes(1);
    expect(portalNotifications.inventoryBecameUnavailable.mock.calls[0][2]).toBe('out-of-stock');
  });

  it('records both the old and the new identity in the audit trail', async () => {
    const { service, audit, state } = buildService();
    state.catalogHit = asthalin100({ id: 'med_asthalin_200', strength: '200 mcg' });

    await edit(service, { name: 'Asthalin', strength: '200 mcg' });

    const details = audit.write.mock.calls[0][4];
    expect(details.previousValues).toMatchObject({
      medicineId: 'med_asthalin_100',
      strength: '100 mcg',
    });
    expect(details.newValues).toMatchObject({
      medicineId: 'med_asthalin_200',
      strength: '200 mcg',
    });
  });

  it('rejects an edit to an item belonging to another pharmacy', async () => {
    const { service, state } = buildService();
    state.row = { ...signalRow(), pharmacyId: 'ph_other' };

    await expect(edit(service, { name: 'Asthalin' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a blank medicine name instead of storing one', async () => {
    const { service } = buildService();

    await expect(edit(service, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
