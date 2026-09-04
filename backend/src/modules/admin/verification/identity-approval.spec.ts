import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { VerificationService } from './verification.service';

/**
 * Approval is where a requested identity becomes the real one.
 *
 * It used to change a status and nothing else, because saving the pharmacy
 * profile had already written the new name and licence to the Pharmacy row. So
 * "Zoiko Meds Pharmacy" became "Zoiko Meds" everywhere the moment Save was
 * clicked, with the request still reading Pending — approving decided nothing
 * that had not already happened, and rejecting could not put it back.
 *
 * The pharmacy row now holds what a reviewer approved and the request holds
 * what is being asked for. These tests hold the three decisions apart: only
 * approval applies, and the other two leave the approved identity alone.
 */

/** The reported case: a verified pharmacy asking to shorten its name. */
const REQUEST = {
  id: 'req_1',
  pharmacyId: 'ph_1',
  // What is being asked for.
  pharmacyName: 'Zoiko Meds',
  licenseNumber: 'LIC-JHC951',
  submittedBy: 'Naveen (gdbdata3@gmail.com)',
  status: 'PENDING',
  notes: null,
};

/** What a reviewer previously approved, still standing on the pharmacy row. */
const APPROVED = {
  latitude: 17.5878,
  longitude: 78.4236,
  name: 'Zoiko Meds Pharmacy',
  licenseNumber: 'LIC-OLD',
};

function buildService(request = REQUEST, approved = APPROVED) {
  const tx: any = {
    verificationRequest: {
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
      findUnique: jest.fn().mockResolvedValue(request),
      // Has this pharmacy ever had a request approved? The mapper asks so it
      // can tell a first submission from a change to an approved identity.
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'admin_1', fullName: 'Super Admin' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'user_1', pharmacyId: 'ph_1' }),
      update: jest.fn(),
    },
    pharmacy: {
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(approved),
    },
    signalNotification: { create: jest.fn() },
    pharmacyNotificationPreference: {
      findUnique: jest.fn().mockResolvedValue({
        inventoryAlerts: true,
        verificationUpdates: true,
        uploadResults: true,
        systemMessages: true,
      }),
    },
  };

  const audit = { write: jest.fn() };
  const prisma = {
    verificationRequest: {
      findUnique: jest.fn().mockResolvedValue(request),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const service = new VerificationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
  );
  return { service, tx, audit, prisma };
}

/** Everything written to the pharmacy row by this decision. */
const pharmacyWrites = (tx: any) => tx.pharmacy.update.mock.calls.map((c: any[]) => c[0].data);

const decide = (service: VerificationService, status: string) =>
  service.update('admin_1', 'req_1', { status } as never, '10.0.0.1');

describe('3. approve applies the requested identity', () => {
  it('sets the pharmacy name to the requested one', async () => {
    const { service, tx } = buildService();

    await decide(service, 'APPROVED');

    expect(pharmacyWrites(tx)[0].name).toBe('Zoiko Meds');
  });

  it('sets the licence number to the requested one', async () => {
    const { service, tx } = buildService();

    await decide(service, 'APPROVED');

    expect(pharmacyWrites(tx)[0].licenseNumber).toBe('LIC-JHC951');
  });

  it('marks the pharmacy verified in the same write', async () => {
    // One write, inside the existing transaction, so a half-applied identity —
    // verified under the old name, or renamed but still pending — cannot exist.
    const { service, tx } = buildService();

    await decide(service, 'APPROVED');

    const write = pharmacyWrites(tx)[0];
    expect(write.verificationStatus).toBe('VERIFIED');
    expect(write.name).toBe('Zoiko Meds');
    expect(tx.pharmacy.update).toHaveBeenCalledTimes(1);
  });

  it('leaves a request that asks for nothing new alone', async () => {
    // A first-time approval whose request restates the current identity must
    // not be treated as a change; it simply writes the same values.
    const { service, tx } = buildService(
      { ...REQUEST, pharmacyName: 'Zoiko Meds Pharmacy', licenseNumber: 'LIC-OLD' },
    );

    await decide(service, 'APPROVED');

    expect(pharmacyWrites(tx)[0].name).toBe('Zoiko Meds Pharmacy');
  });

  it('does not blank a licence the request never carried', async () => {
    const { service, tx } = buildService({ ...REQUEST, licenseNumber: '' });

    await decide(service, 'APPROVED');

    expect(pharmacyWrites(tx)[0]).not.toHaveProperty('licenseNumber');
  });
});

describe('4. reject leaves the approved identity standing', () => {
  it('does not apply the requested name', async () => {
    const { service, tx } = buildService();

    await decide(service, 'REJECTED');

    for (const write of pharmacyWrites(tx)) {
      expect(write.name).toBeUndefined();
      expect(write.licenseNumber).toBeUndefined();
    }
  });

  it('still records the rejection against the pharmacy', async () => {
    const { service, tx } = buildService();

    await decide(service, 'REJECTED');

    expect(pharmacyWrites(tx)[0].verificationStatus).toBe('REJECTED');
  });

  it('keeps the requested values on the request for the record', async () => {
    // The submission is history: what was asked for and refused is exactly what
    // an audit of the decision needs.
    const { service, tx } = buildService();

    await decide(service, 'REJECTED');

    const [args] = tx.verificationRequest.update.mock.calls[0];
    expect(args.data.pharmacyName).toBeUndefined();
    expect(args.data.licenseNumber).toBeUndefined();
  });
});

describe('5. request info leaves the approved identity standing', () => {
  it('does not apply the requested name', async () => {
    const { service, tx } = buildService();

    await decide(service, 'REQUEST_INFO');

    for (const write of pharmacyWrites(tx)) {
      expect(write.name).toBeUndefined();
    }
  });

  it('keeps the request open for the pharmacy to correct', async () => {
    const { service, tx } = buildService();

    await decide(service, 'REQUEST_INFO');

    expect(pharmacyWrites(tx)[0].verificationStatus).toBe('INFO_REQUESTED');
  });
});

describe('12. the audit trail records what was applied', () => {
  it('names the field, the old value and the new one', async () => {
    const { service, audit } = buildService();

    await decide(service, 'APPROVED');

    const [, action, entity, entityId, meta] = audit.write.mock.calls[0];
    expect(action).toBe('admin.verification.approved');
    expect(entity).toBe('VerificationRequest');
    expect(entityId).toBe('req_1');
    expect(meta.appliedIdentity).toEqual({
      name: { from: 'Zoiko Meds Pharmacy', to: 'Zoiko Meds' },
      licenseNumber: { from: 'LIC-OLD', to: 'LIC-JHC951' },
    });
  });

  it('records nothing applied on a rejection', async () => {
    const { service, audit } = buildService();

    await decide(service, 'REJECTED');

    expect(audit.write.mock.calls[0][4].appliedIdentity).toEqual({});
  });

  it('carries no document bytes or secrets', async () => {
    const { service, audit } = buildService();

    await decide(service, 'APPROVED');

    const serialised = JSON.stringify(audit.write.mock.calls[0][4]);
    expect(serialised).not.toMatch(/base64|data:|content/i);
  });
});

describe('2 & 7. what the reviewer is shown', () => {
  const changesFor = async (request: Record<string, unknown>, pharmacy: Record<string, unknown>) => {
    const { service, prisma } = buildService(request as never);
    prisma.verificationRequest.findUnique = jest
      .fn()
      .mockResolvedValue({ ...request, pharmacy }) as never;
    const [dto] = await service.list();
    return dto;
  };

  it('lists the old and requested value for each changed field', async () => {
    const { service } = buildService();
    (service as never as { prisma: unknown }).prisma = {
      pharmacy: { updateMany: jest.fn() },
      verificationRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...REQUEST, pharmacy: { name: APPROVED.name, licenseNumber: APPROVED.licenseNumber } }]),
      },
    };

    const [dto] = await service.list();

    // previousValue/requestedValue, with a `kind`, so the console can tell a
    // comparison from a single submitted value without re-deriving which it is.
    expect(dto.changes).toEqual([
      {
        field: 'name',
        label: 'Pharmacy name',
        kind: 'CHANGED',
        previousValue: 'Zoiko Meds Pharmacy',
        requestedValue: 'Zoiko Meds',
      },
      {
        field: 'licenseNumber',
        label: 'Licence number',
        kind: 'CHANGED',
        previousValue: 'LIC-OLD',
        requestedValue: 'LIC-JHC951',
      },
    ]);
  });

  it('shows the approved identity as the headline, not the requested one', async () => {
    // Pharmacy Management and every other surface read this field.
    const { service } = buildService();
    (service as never as { prisma: unknown }).prisma = {
      pharmacy: { updateMany: jest.fn() },
      verificationRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...REQUEST, pharmacy: { name: APPROVED.name, licenseNumber: APPROVED.licenseNumber } }]),
      },
    };

    const [dto] = await service.list();

    expect(dto.pharmacy).toBe('Zoiko Meds Pharmacy');
    expect(dto.requestedName).toBe('Zoiko Meds');
  });

  it('lists nothing for a field that did not move', async () => {
    const { service } = buildService();
    (service as never as { prisma: unknown }).prisma = {
      pharmacy: { updateMany: jest.fn() },
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...REQUEST,
            licenseNumber: 'LIC-OLD',
            pharmacy: { name: APPROVED.name, licenseNumber: 'LIC-OLD' },
          },
        ]),
      },
    };

    const [dto] = await service.list();

    expect(dto.changes.map((c: { field: string }) => c.field)).toEqual(['name']);
  });

  it('gives a reason naming the fields, separate from reviewer notes', async () => {
    const { service } = buildService();
    (service as never as { prisma: unknown }).prisma = {
      pharmacy: { updateMany: jest.fn() },
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...REQUEST,
            notes: '[2026-09-03]: Called the branch, awaiting callback.',
            pharmacy: { name: APPROVED.name, licenseNumber: APPROVED.licenseNumber },
          },
        ]),
      },
    };

    const [dto] = await service.list();

    // Now led by the request's own type: the reason line used to be built from
    // the identity diff alone, so a submission that renamed nothing produced
    // null and the reviewer was shown no reason at all.
    expect(dto.reason).toBe(
      'Re-verification — pharmacy identity changed. Requires review: pharmacy name, licence number.',
    );
    // The human's words stay in their own field, unmixed.
    expect(dto.notes).toBe('[2026-09-03]: Called the branch, awaiting callback.');
    expect(dto.notes).not.toContain('Requires review');
  });

  it('treats a first-time request as new information, not a change', async () => {
    // No approved identity to differ from, so `current` is null rather than a
    // struck-through value that never existed.
    const { service } = buildService();
    (service as never as { prisma: unknown }).prisma = {
      pharmacy: { updateMany: jest.fn() },
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([{ ...REQUEST, pharmacyId: null, pharmacy: null }]),
      },
    };

    const [dto] = await service.list();

    expect(dto.changes[0]).toMatchObject({
      field: 'name',
      previousValue: null,
      requestedValue: 'Zoiko Meds',
    });
  });
});
