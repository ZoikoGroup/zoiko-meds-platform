import { CommercialClassification, UserRole, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { PUBLIC_PHARMACY_WHERE } from '../availability/availability.visibility';
import { AdminService } from './admin.service';
import { AuditWriter } from './audit.writer';

/**
 * What unlinking a pharmacy account does to the pharmacy's patient visibility.
 *
 * The reported defect: a Super Admin unlinks the last pharmacy account from a
 * branch, and patients keep finding it. Its medicines stay in search, its stock
 * levels keep being quoted, and nobody can sign in to correct any of it.
 *
 * The reason it survived is that visibility used to be decided by three stored
 * fields, and none of them can express an operator leaving.
 * `verificationStatus` records a licence a reviewer approved, which is still
 * true. `isParticipating` is derived from the coordinates, which have not
 * moved. `commercialClassification` records that somebody claimed the pharmacy
 * once — a fact about the past that stays true after they go.
 *
 * So the rule asks the linked accounts instead, and this runs the real
 * `AdminService` mutations against an in-memory database that honours the
 * relation filter, so the answer comes from the shipped code path rather than
 * from a predicate called by hand.
 *
 * The three routes an account can stop running a pharmacy are all covered:
 * `updateUser` clearing the link, `setRole` moving the account out of the
 * pharmacy roles, and `setActive` deactivating it.
 */

const PHARMACY_ID = 'ph_corner';
const ADMIN_ID = 'admin_1';

type Row = Record<string, any>;

/** A published pharmacy: approved, located, in the network, reporting stock. */
const publishedPharmacy = (): Row => ({
  id: PHARMACY_ID,
  name: 'Corner Chemist',
  licenseNumber: 'LIC-CORNER',
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
  latitude: 17.4,
  longitude: 78.5,
});

const manager = (over: Row = {}): Row => ({
  id: 'user_manager',
  email: 'manager@corner.test',
  fullName: 'Corner Manager',
  phone: null,
  role: UserRole.PHARMACY_ADMIN,
  isActive: true,
  pharmacyId: PHARMACY_ID,
  mustChangePassword: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const superAdmin = (): Row => ({
  ...manager({
    id: ADMIN_ID,
    email: 'admin@zoikomeds.test',
    fullName: 'Super Admin',
    role: UserRole.SUPER_ADMIN,
    pharmacyId: null,
  }),
});

function buildWorld({ users, signals = 3 }: { users: Row[]; signals?: number }) {
  const pharmacies: Row[] = [publishedPharmacy()];
  const accounts: Row[] = users.map((u) => ({ ...u }));
  // Stock the pharmacy reported while it was being run. Nothing below is
  // allowed to change this: unlinking an account is not a deletion.
  const availabilitySignals: Row[] = Array.from({ length: signals }, (_, index) => ({
    id: `sig_${index}`,
    pharmacyId: PHARMACY_ID,
    medicineId: `med_${index}`,
    confidence: 'HIGH',
  }));

  /**
   * The patient query, honestly evaluated.
   *
   * Only the clause forms `PUBLIC_PHARMACY_WHERE` actually uses — equality,
   * `{ in }` and the `users: { some }` relation filter — and a throw on
   * anything else, so a rule that grows a form this cannot read fails here
   * rather than being treated as satisfied.
   */
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([field, clause]) => {
      if (clause !== null && typeof clause === 'object') {
        if ('some' in clause) {
          const some = (clause as any).some as Row;
          return accounts.some(
            (account) =>
              account.pharmacyId === row.id &&
              Object.entries(some).every(([innerField, innerClause]) => {
                const actual = account[innerField];
                if (innerClause !== null && typeof innerClause === 'object') {
                  const allowed = (innerClause as any).in;
                  if (!Array.isArray(allowed)) {
                    throw new Error(`Unsupported clause on ${field}.some.${innerField}`);
                  }
                  return allowed.includes(actual);
                }
                return actual === innerClause;
              }),
          );
        }
        const allowed = (clause as any).in;
        if (!Array.isArray(allowed)) throw new Error(`Unsupported clause on ${field}`);
        return allowed.includes(row[field]);
      }
      return row[field] === clause;
    });

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const found = accounts.find((a) =>
          where.id !== undefined ? a.id === where.id : a.email === where.email,
        );
        return found ? { ...found } : null;
      }),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = accounts.find((a) => a.id === where.id);
        if (!row) throw new Error('no such user');
        for (const [field, value] of Object.entries(data as Row)) {
          // Prisma expresses a relation change as connect/disconnect; the
          // foreign key is what the query then filters on.
          if (field === 'pharmacy') {
            row.pharmacyId = (value as any)?.connect?.id ?? null;
          } else {
            row[field] = value;
          }
        }
        return { ...row };
      }),
      count: jest.fn(async ({ where }: any = {}) =>
        accounts.filter((a) => {
          if (where?.role !== undefined && a.role !== where.role) return false;
          if (where?.isActive !== undefined && a.isActive !== where.isActive) return false;
          if (where?.id?.not !== undefined && a.id === where.id.not) return false;
          return true;
        }).length,
      ),
    },
    pharmacy: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = pharmacies.find((p) => p.id === where.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        pharmacies.filter((p) => matches(p, where ?? {})).map((p) => ({ ...p })),
      ),
    },
    availabilitySignal: {
      findMany: jest.fn(async () => availabilitySignals.map((s) => ({ ...s }))),
    },
    verificationRequest: {
      // Unlinking a pharmacy account leaves it waiting to onboard again, and
      // AdminService files a placeholder request for it. Existing behaviour,
      // unrelated to visibility, but it runs on this path.
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'req_new', ...data })),
      update: jest.fn(),
    },
  };

  const service = new AdminService(
    prisma as unknown as PrismaService,
    { write: jest.fn() } as unknown as AuditWriter,
    {} as unknown as AuthService,
    {} as unknown as MailService,
  );

  return {
    service,
    prisma,
    /** Which pharmacies a patient search would return right now. */
    patientResults: () => prisma.pharmacy.findMany({ where: PUBLIC_PHARMACY_WHERE }),
    pharmacyRow: () => ({ ...pharmacies[0] }),
    inventory: () => availabilitySignals.map((s) => ({ ...s })),
  };
}

describe('F. unlinking the last pharmacy account', () => {
  const world = () => buildWorld({ users: [superAdmin(), manager()] });

  it('the pharmacy is in patient search to begin with', async () => {
    expect(await world().patientResults()).toHaveLength(1);
  });

  it('takes it out of patient search', async () => {
    const w = world();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(await w.patientResults()).toHaveLength(0);
  });

  it('does not delete the pharmacy', async () => {
    const w = world();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(w.pharmacyRow().name).toBe('Corner Chemist');
    expect(w.pharmacyRow().licenseNumber).toBe('LIC-CORNER');
  });

  it('does not delete the inventory', async () => {
    const w = world();
    const before = w.inventory();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(w.inventory()).toEqual(before);
  });

  it('does not change the verification history', async () => {
    // Losing an operator is not a rejection. The licence was approved and stays
    // approved; only the answer to "can patients find it today" changes.
    const w = world();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(w.pharmacyRow().verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('does not demote the commercial classification', async () => {
    const w = world();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(w.pharmacyRow().commercialClassification).toBe(
      CommercialClassification.VERIFIED_NETWORK_CORE,
    );
  });

  it('writes nothing to the pharmacy at all', async () => {
    // The rule is derived, so there is no flag to recompute — which is the
    // point. A stored flag would have to be updated on this path, on setRole,
    // on setActive, and on every path added later.
    const w = world();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(w.prisma.pharmacy.update).toBeUndefined();
  });
});

describe('F. the other ways an account stops running a pharmacy', () => {
  it('moving the account out of the pharmacy roles hides it', async () => {
    // setRole disconnects the pharmacy itself when the new role is not a
    // pharmacy one, so the branch is left unmanaged the same way.
    const w = buildWorld({ users: [superAdmin(), manager()] });

    await w.service.setRole(ADMIN_ID, 'user_manager', UserRole.PUBLIC);

    expect(await w.patientResults()).toHaveLength(0);
  });

  it('deactivating the last account hides it', async () => {
    // The account keeps its link and cannot sign in, so nobody is answering for
    // the stock either way.
    const w = buildWorld({ users: [superAdmin(), manager()] });

    await w.service.setActive(ADMIN_ID, 'user_manager', false);

    expect(await w.patientResults()).toHaveLength(0);
    expect(w.inventory()).toHaveLength(3);
  });
});

describe('a pharmacy that still has someone', () => {
  it('stays visible when one of two accounts is unlinked', async () => {
    const w = buildWorld({
      users: [
        superAdmin(),
        manager(),
        manager({ id: 'user_staff', email: 'staff@corner.test', role: UserRole.PHARMACY_STAFF }),
      ],
    });

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);

    expect(await w.patientResults()).toHaveLength(1);
  });

  it('stays visible on an edit that does not touch the link', async () => {
    const w = buildWorld({ users: [superAdmin(), manager()] });

    await w.service.updateUser(ADMIN_ID, 'user_manager', { fullName: 'New Name' } as never);

    expect(await w.patientResults()).toHaveLength(1);
  });
});

describe('G. relinking an account', () => {
  it('puts the pharmacy back in patient search, with no re-upload', async () => {
    const w = buildWorld({ users: [superAdmin(), manager()] });
    const before = w.inventory();

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);
    const whileUnlinked = await w.patientResults();
    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: PHARMACY_ID } as never);

    expect(whileUnlinked).toHaveLength(0);
    expect(await w.patientResults()).toHaveLength(1);
    // Untouched throughout: the same rows, the same quantities.
    expect(w.inventory()).toEqual(before);
  });

  it('needs no re-approval and no reclassification', async () => {
    const w = buildWorld({ users: [superAdmin(), manager()] });

    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: null } as never);
    await w.service.updateUser(ADMIN_ID, 'user_manager', { pharmacyId: PHARMACY_ID } as never);

    expect(w.pharmacyRow().verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(w.pharmacyRow().commercialClassification).toBe(
      CommercialClassification.VERIFIED_NETWORK_CORE,
    );
  });

  it('is restored by reactivating the account too', async () => {
    const w = buildWorld({ users: [superAdmin(), manager()] });

    await w.service.setActive(ADMIN_ID, 'user_manager', false);
    await w.service.setActive(ADMIN_ID, 'user_manager', true);

    expect(await w.patientResults()).toHaveLength(1);
  });
});
