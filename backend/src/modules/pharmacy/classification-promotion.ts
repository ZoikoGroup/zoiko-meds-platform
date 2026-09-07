import { CommercialClassification, Prisma, VerificationStatus } from '@prisma/client';
import { VISIBLE_SIGNAL_WHERE } from '../availability/availability.visibility';

/**
 * Promoting a directory record to the network classification (MSA-54).
 *
 * A preloaded record stays DIRECTORY_UNCLAIMED through verification on purpose:
 * approving a licence says the pharmacy exists, not that anybody has taken
 * responsibility for what it reports. Three things together say somebody has —
 * the licence is approved, the record is listable, and stock a patient could be
 * shown has been reported — and the promotion is what turns that into the
 * classification the patient-visibility allowlist admits.
 *
 * It used to live as a private method on PharmacyService and was called from the
 * inventory writes alone, which quietly made *inventory* the trigger rather than
 * the third condition. A pharmacy that reported stock before it had a map pin
 * failed the `isParticipating` check, and nothing re-asked the question when the
 * pin arrived: the operator added their address, saw "listed to patients" on
 * their own profile, and stayed DIRECTORY_UNCLAIMED — invisible to every patient
 * search — until they happened to touch inventory again. The last condition to
 * be satisfied was whichever one came last, and only one of the three was
 * wired up.
 *
 * So it lives here, as a plain function over any Prisma client or transaction
 * client, and every path that can satisfy the last condition calls it:
 * inventory writes, a pharmacy saving its own profile, an admin editing or
 * approving a record. Sharing one function is also what keeps "promoted" and
 * "eligible to be shown" from drifting — the signal condition is
 * VISIBLE_SIGNAL_WHERE, the same predicate the patient surfaces filter on.
 *
 * Every precondition sits in the `where`, which is what makes it safe to call
 * after any of those writes:
 *
 *   - it can only ever match DIRECTORY_UNCLAIMED, so no higher classification
 *     is downgraded or overwritten, and nothing else is touched;
 *   - it requires a signal patients could actually be shown, so a failed
 *     upload, an empty CSV or a feed configured but never synced promotes
 *     nothing;
 *   - matching nothing on a second call makes it idempotent;
 *   - it is one statement, so two concurrent callers cannot race.
 */

/** Why the promotion fired, for the audit trail. */
export const PROMOTION_REASONS = {
  /** Stock was the last of the three to arrive. */
  REPORTED: 'First patient-visible availability signal reported.',
  /**
   * The pin was. The pharmacy had already reported stock and was waiting on a
   * map location, without which no distance-bounded patient search can return
   * it.
   */
  LISTABLE:
    'Pharmacy became listable (verified and located) with availability already reported.',
} as const;

/**
 * The three conditions, as a where-clause.
 *
 * Exported so the one-off backfill and the tests state eligibility by reading
 * it rather than by keeping a second copy in step.
 */
export const PROMOTABLE_WHERE: Prisma.PharmacyWhereInput = {
  // Approved: the licence is real.
  verificationStatus: VerificationStatus.VERIFIED,
  // Listable: verified and located, so a distance-bounded search can reach it.
  isParticipating: true,
  // Still nobody's: the one classification this may ever rewrite.
  commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
  // Reporting: a signal patients could actually be shown, not merely a write
  // that was attempted.
  availabilitySignals: { some: VISIBLE_SIGNAL_WHERE },
};

/** The same conditions, narrowed to one pharmacy. */
export function promotableWhere(pharmacyId: string): Prisma.PharmacyWhereInput {
  return { id: pharmacyId, ...PROMOTABLE_WHERE };
}

/**
 * As much of a Prisma client as this needs — which a `$transaction` client also
 * satisfies, so a caller inside a transaction can pass its `tx`.
 */
type PharmacyUpdater = {
  pharmacy: {
    updateMany(args: {
      where: Prisma.PharmacyWhereInput;
      data: Prisma.PharmacyUpdateManyMutationInput;
    }): Promise<{ count: number }>;
  };
};

/** The AuditWriter surface used here, structurally, so mocks and tx wrappers fit. */
type Auditor = {
  write(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Prisma.InputJsonValue,
    ipAddress?: string,
  ): Promise<unknown>;
};

/**
 * Attempt the promotion. Returns whether it actually changed anything, so a
 * caller can report it; a false is the ordinary case, not a failure.
 */
export async function promoteClaimedByReporting(
  db: PharmacyUpdater,
  audit: Auditor | null,
  pharmacyId: string,
  options: {
    actorId?: string | null;
    ipAddress?: string;
    reason?: string;
  } = {},
): Promise<boolean> {
  const { count } = await db.pharmacy.updateMany({
    where: promotableWhere(pharmacyId),
    data: {
      commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
    },
  });

  if (count === 0) return false;

  // A commercial classification changing on its own is worth being able to
  // account for later.
  await audit?.write(
    options.actorId ?? null,
    'pharmacy.classification.promote',
    'Pharmacy',
    pharmacyId,
    {
      pharmacyId,
      from: CommercialClassification.DIRECTORY_UNCLAIMED,
      to: CommercialClassification.VERIFIED_NETWORK_CORE,
      reason: options.reason ?? PROMOTION_REASONS.REPORTED,
      module: 'Pharmacy Management',
    },
    options.ipAddress,
  );
  return true;
}
